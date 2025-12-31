/**
 * SQLite Database Adapter
 *
 * Implements the DatabaseAdapter interface for SQLite databases using better-sqlite3.
 * better-sqlite3 is synchronous, but we wrap all methods in async for interface compatibility.
 *
 * SQLite-specific behaviors:
 * - No schemas: SQLite uses a single "main" schema (schema parameter is ignored)
 * - Flexible typing: SQLite uses type affinity (TEXT, INTEGER, REAL, BLOB, NUMERIC)
 * - ROWID ordering: Uses implicit ROWID for consistent pagination
 * - PRAGMA introspection: Uses PRAGMA commands for metadata queries
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  BaseAdapter,
  DatabaseType as DbType,
  StreamBatch,
  type DatabaseConfig,
  type StreamOptions,
} from './base.js';
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  IndexColumnInfo,
} from '../introspector/schema-introspector.js';

// ============================================================================
// SQLite PRAGMA Result Types
// ============================================================================

interface PragmaTableInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface PragmaForeignKeyInfo {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

interface PragmaIndexList {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface PragmaIndexInfo {
  seqno: number;
  cid: number;
  name: string | null;
}

interface PragmaIndexXInfo {
  seqno: number;
  cid: number;
  name: string | null;
  desc: number;
  coll: string;
  key: number;
}

// ============================================================================
// SQLite Adapter Configuration
// ============================================================================

/**
 * Extended configuration for SQLite adapter
 */
export interface SQLiteConfig extends DatabaseConfig {
  /** Open in read-only mode */
  readonly?: boolean;
  /** Create file if it doesn't exist (default: true) */
  fileMustExist?: boolean;
  /** Enable WAL mode for better concurrency */
  wal?: boolean;
  /** Busy timeout in milliseconds (default: 5000) */
  timeout?: number;
}

// ============================================================================
// SQLite Adapter Implementation
// ============================================================================

/**
 * SQLite database adapter using better-sqlite3
 *
 * This adapter provides a unified interface for reading SQLite databases
 * for migration to Convex. It wraps the synchronous better-sqlite3 API
 * in async methods for interface compatibility.
 *
 * @example
 * ```typescript
 * const adapter = new SQLiteAdapter({
 *   type: DatabaseType.SQLITE,
 *   database: 'mydb',
 *   filename: './data/mydb.sqlite'
 * });
 *
 * await adapter.connect();
 * const tables = await adapter.getTables('main');
 * ```
 */
export class SQLiteAdapter extends BaseAdapter {
  private db: DatabaseType | null = null;
  private sqliteConfig: SQLiteConfig;

  constructor(config: DatabaseConfig) {
    // Ensure type is set to SQLITE
    super({ ...config, type: DbType.SQLITE });
    this.sqliteConfig = config as SQLiteConfig;
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Connect to the SQLite database
   * Opens the database file with configured options
   */
  async connect(): Promise<void> {
    if (this.connected && this.db) {
      return;
    }

    const filename = this.sqliteConfig.filename || this.config.database;
    if (!filename) {
      throw new Error('SQLite adapter requires a filename or database path');
    }

    try {
      // better-sqlite3 options
      const options: Database.Options = {
        readonly: this.sqliteConfig.readonly ?? false,
        fileMustExist: this.sqliteConfig.fileMustExist ?? false,
        timeout: this.sqliteConfig.timeout ?? 5000,
      };

      this.db = new Database(filename, options);

      // Enable WAL mode if configured (better concurrency)
      if (this.sqliteConfig.wal) {
        this.db.pragma('journal_mode = WAL');
      }

      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');

      this.connected = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to SQLite database: ${message}`);
    }
  }

  /**
   * Disconnect from the SQLite database
   */
  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.connected = false;
    }
  }

  /**
   * Test if the connection is valid
   */
  async testConnection(): Promise<boolean> {
    try {
      this.ensureConnected();
      // Simple query to verify connection
      this.db!.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Schema Introspection
  // ============================================================================

  /**
   * Get all available schemas
   * SQLite doesn't have schemas in the traditional sense - returns ['main']
   */
  async getSchemas(): Promise<string[]> {
    this.ensureConnected();
    // SQLite always has a 'main' schema, and possibly 'temp' for temporary objects
    // For migration purposes, we only care about 'main'
    return ['main'];
  }

  /**
   * Get all tables in the database
   * SQLite ignores schema parameter since it only has 'main'
   *
   * @param _schema - Ignored for SQLite (always uses 'main')
   */
  async getTables(_schema: string): Promise<string[]> {
    this.ensureConnected();

    const query = `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `;

    const rows = this.db!.prepare(query).all() as { name: string }[];
    return rows.map((row) => row.name);
  }

  /**
   * Get column information for a table
   * Uses PRAGMA table_info to retrieve column metadata
   *
   * @param _schema - Ignored for SQLite
   * @param table - The table name
   */
  async getColumns(_schema: string, table: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    const escapedTable = this.escapeIdentifier(table);
    const columns = this.db!.pragma(
      `table_info(${escapedTable})`
    ) as PragmaTableInfo[];

    // Get foreign key info to mark FK columns
    const foreignKeys = await this.getForeignKeys('main', table);
    const fkColumns = new Map(foreignKeys.map((fk) => [fk.columnName, fk]));

    return columns.map((col) => {
      const fkInfo = fkColumns.get(col.name);
      const mappedType = this.mapSQLiteType(col.type);

      return {
        columnName: col.name,
        dataType: mappedType.type,
        isNullable: col.notnull === 0,
        columnDefault: col.dflt_value,
        characterMaximumLength: mappedType.maxLength,
        numericPrecision: mappedType.precision,
        numericScale: mappedType.scale,
        ordinalPosition: col.cid + 1, // SQLite cid is 0-based
        isIdentity: col.pk === 1 && col.type.toUpperCase() === 'INTEGER',
        isPrimaryKey: col.pk > 0,
        isForeignKey: fkInfo !== undefined,
        foreignKeyTable: fkInfo?.referencedTable ?? null,
        foreignKeyColumn: fkInfo?.referencedColumn ?? null,
        description: null, // SQLite doesn't support column comments
        isGenerated: false, // SQLite doesn't have generated columns in older versions
        generationExpression: null,
        generationType: null,
        domainName: null,
        domainBaseType: null,
      };
    });
  }

  /**
   * Get primary key columns for a table
   * Uses PRAGMA table_info where pk > 0
   *
   * @param _schema - Ignored for SQLite
   * @param table - The table name
   */
  async getPrimaryKeys(_schema: string, table: string): Promise<string[]> {
    this.ensureConnected();

    const escapedTable = this.escapeIdentifier(table);
    const columns = this.db!.pragma(
      `table_info(${escapedTable})`
    ) as PragmaTableInfo[];

    // Filter and sort by pk value (for composite keys, pk indicates the order)
    return columns
      .filter((col) => col.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((col) => col.name);
  }

  /**
   * Get foreign key information for a table
   * Uses PRAGMA foreign_key_list
   *
   * @param _schema - Ignored for SQLite
   * @param table - The table name
   */
  async getForeignKeys(
    _schema: string,
    table: string
  ): Promise<ForeignKeyInfo[]> {
    this.ensureConnected();

    const escapedTable = this.escapeIdentifier(table);
    const fks = this.db!.pragma(
      `foreign_key_list(${escapedTable})`
    ) as PragmaForeignKeyInfo[];

    return fks.map((fk) => ({
      constraintName: `fk_${table}_${fk.from}_${fk.id}`,
      columnName: fk.from,
      referencedTable: fk.table,
      referencedColumn: fk.to,
      referencedSchema: 'main',
    }));
  }

  /**
   * Get index information for a table
   * Uses PRAGMA index_list and PRAGMA index_info/index_xinfo
   *
   * @param _schema - Ignored for SQLite
   * @param table - The table name
   */
  async getIndexes(_schema: string, table: string): Promise<IndexInfo[]> {
    this.ensureConnected();

    const escapedTable = this.escapeIdentifier(table);
    const indexList = this.db!.pragma(
      `index_list(${escapedTable})`
    ) as PragmaIndexList[];

    const indexes: IndexInfo[] = [];

    for (const idx of indexList) {
      // Skip auto-created indexes for PRIMARY KEY constraints
      // These are handled elsewhere
      if (idx.origin === 'pk') {
        continue;
      }

      const indexColumns = this.getIndexColumns(idx.name);

      // Get the index SQL to check for partial indexes
      const indexSql = this.getIndexSql(idx.name);
      const partialPredicate = this.extractPartialPredicate(indexSql);

      indexes.push({
        indexName: idx.name,
        columnName: indexColumns.length > 0 ? indexColumns[0].columnName : '',
        columns: indexColumns,
        isUnique: idx.unique === 1,
        ordinalPosition: idx.seq + 1,
        isExpression: indexColumns.some((c) => c.isExpression),
        expressionDefinition: indexColumns.some((c) => c.isExpression)
          ? (indexSql ?? undefined)
          : undefined,
        indexMethod: 'btree', // SQLite only supports B-tree indexes
        isPartial: idx.partial === 1,
        partialPredicate: partialPredicate ?? undefined,
      });
    }

    return indexes;
  }

  /**
   * Get row count for a table
   *
   * @param _schema - Ignored for SQLite
   * @param table - The table name
   */
  async getTableRowCount(_schema: string, table: string): Promise<number> {
    this.ensureConnected();

    const escapedTable = this.escapeIdentifier(table);
    const result = this.db!.prepare(
      `SELECT COUNT(*) as count FROM ${escapedTable}`
    ).get() as {
      count: number;
    };

    return result.count;
  }

  // ============================================================================
  // Data Reading
  // ============================================================================

  /**
   * Stream rows from a table in batches
   * Uses LIMIT/OFFSET with ROWID ordering for consistent pagination
   *
   * @param _schema - Ignored for SQLite
   * @param table - The table name
   * @param options - Streaming options
   */
  async *streamRows(
    _schema: string,
    table: string,
    options: StreamOptions
  ): AsyncGenerator<StreamBatch, void, unknown> {
    this.ensureConnected();

    const {
      batchSize,
      cursor,
      orderBy,
      orderDirection = 'ASC',
      whereClause,
      whereParams,
    } = options;

    const escapedTable = this.escapeIdentifier(table);

    // Build ORDER BY clause - use ROWID for consistent ordering if not specified
    const orderColumn = orderBy ? this.escapeIdentifier(orderBy) : 'rowid';
    const orderByClause = `ORDER BY ${orderColumn} ${orderDirection}`;

    let hasMore = true;
    let lastCursor: string | number | undefined = cursor;
    let totalFetched = 0;

    while (hasMore) {
      // Build query with current cursor
      const cursorConditions: string[] = [];
      const queryParams: unknown[] = [];

      if (whereClause) {
        cursorConditions.push(`(${whereClause})`);
        if (whereParams) {
          queryParams.push(...whereParams);
        }
      }

      if (lastCursor !== undefined) {
        const op = orderDirection === 'ASC' ? '>' : '<';
        cursorConditions.push(`${orderColumn} ${op} ?`);
        queryParams.push(lastCursor);
      }

      const currentWhereClause =
        cursorConditions.length > 0
          ? `WHERE ${cursorConditions.join(' AND ')}`
          : '';

      // Fetch one extra row to determine if there are more
      const query = `
        SELECT *
        FROM ${escapedTable}
        ${currentWhereClause}
        ${orderByClause}
        LIMIT ${batchSize + 1}
      `;

      let rows: Record<string, unknown>[];
      if (queryParams.length > 0) {
        rows = this.db!.prepare(query).all(...queryParams) as Record<
          string,
          unknown
        >[];
      } else {
        rows = this.db!.prepare(query).all() as Record<string, unknown>[];
      }

      // Check if there are more rows
      hasMore = rows.length > batchSize;
      const batchRows = hasMore ? rows.slice(0, batchSize) : rows;

      if (batchRows.length === 0) {
        break;
      }

      // Track total fetched
      totalFetched += batchRows.length;

      // Update cursor for next iteration
      const lastRow = batchRows[batchRows.length - 1];
      const cursorColumn = orderBy || 'rowid';
      lastCursor = lastRow[cursorColumn] as string | number;

      // Yield StreamBatch with full metadata
      yield {
        rows: batchRows,
        nextCursor: lastCursor,
        isLastBatch: !hasMore,
        totalFetched,
      };

      if (!hasMore) {
        break;
      }
    }
  }

  /**
   * Execute a raw query and return results
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]> {
    this.ensureConnected();

    const stmt = this.db!.prepare(sql);

    // Determine if this is a SELECT-like query (returns results)
    // better-sqlite3 requires using .all() for SELECT and .run() for INSERT/UPDATE/DELETE
    const isSelect = /^\s*(SELECT|PRAGMA|WITH)/i.test(sql.trim());

    if (isSelect) {
      if (params && params.length > 0) {
        return stmt.all(...params) as T[];
      }
      return stmt.all() as T[];
    } else {
      // For non-SELECT queries, run and return empty array
      if (params && params.length > 0) {
        stmt.run(...params);
      } else {
        stmt.run();
      }
      return [];
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Escape an identifier for safe use in SQL
   * SQLite uses double quotes for identifier quoting
   */
  escapeIdentifier(identifier: string): string {
    // Replace any double quotes with escaped double quotes
    const escaped = identifier.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  /**
   * Get NULL-safe ORDER BY clause for SQLite
   */
  getNullSafeOrderBy(column: string, direction: 'asc' | 'desc'): string {
    const escapedColumn = this.escapeIdentifier(column);
    // SQLite puts NULLs at the end for ASC and at the beginning for DESC by default
    // To make it consistent, we can use NULLS FIRST/LAST (SQLite 3.30+)
    if (direction === 'asc') {
      return `${escapedColumn} ASC NULLS FIRST`;
    }
    return `${escapedColumn} DESC NULLS LAST`;
  }

  /**
   * Get the underlying database connection for advanced use cases
   */
  getDb(): DatabaseType | null {
    return this.db;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Get index column information using PRAGMA index_xinfo
   */
  private getIndexColumns(indexName: string): IndexColumnInfo[] {
    const escapedIndex = this.escapeIdentifier(indexName);

    // Try index_xinfo first (has more details)
    try {
      const xinfo = this.db!.pragma(
        `index_xinfo(${escapedIndex})`
      ) as PragmaIndexXInfo[];

      // Filter to only key columns (key = 1) and not the internal rowid (cid = -1 or -2)
      return xinfo
        .filter((col) => col.key === 1 && col.cid >= 0)
        .map((col) => ({
          columnName: col.name || `expr_${col.seqno}`,
          ordinalPosition: col.seqno + 1,
          sortOrder: col.desc === 1 ? ('desc' as const) : ('asc' as const),
          nullsPosition: 'last' as const, // SQLite default
          isExpression: col.cid < 0 || col.name === null,
          expression: col.cid < 0 ? undefined : undefined,
        }));
    } catch {
      // Fall back to index_info if index_xinfo is not available
      const info = this.db!.pragma(
        `index_info(${escapedIndex})`
      ) as PragmaIndexInfo[];

      return info.map((col) => ({
        columnName: col.name || `expr_${col.seqno}`,
        ordinalPosition: col.seqno + 1,
        sortOrder: 'asc' as const, // index_info doesn't provide direction
        nullsPosition: 'last' as const,
        isExpression: col.name === null,
        expression: undefined,
      }));
    }
  }

  /**
   * Get the SQL definition of an index
   */
  private getIndexSql(indexName: string): string | null {
    const row = this.db!.prepare(
      `
      SELECT sql
      FROM sqlite_master
      WHERE type = 'index' AND name = ?
    `
    ).get(indexName) as { sql: string | null } | undefined;

    return row?.sql ?? null;
  }

  /**
   * Extract the WHERE clause (partial predicate) from an index SQL
   */
  private extractPartialPredicate(sql: string | null): string | null {
    if (!sql) {
      return null;
    }

    const match = sql.match(/WHERE\s+(.+)$/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Map SQLite type to standardized type info
   * SQLite has type affinity rather than strict types
   */
  private mapSQLiteType(type: string): {
    type: string;
    maxLength: number | null;
    precision: number | null;
    scale: number | null;
  } {
    const upperType = type.toUpperCase().trim();

    // Extract precision/scale from types like DECIMAL(10,2) or VARCHAR(255)
    const match = upperType.match(
      /^(\w+)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?/
    );
    const baseType = match?.[1] || upperType;
    const param1 = match?.[2] ? parseInt(match[2], 10) : null;
    const param2 = match?.[3] ? parseInt(match[3], 10) : null;

    // SQLite type affinity rules
    // INTEGER affinity
    if (
      baseType.includes('INT') ||
      baseType === 'INTEGER' ||
      baseType === 'TINYINT' ||
      baseType === 'SMALLINT' ||
      baseType === 'MEDIUMINT' ||
      baseType === 'BIGINT'
    ) {
      return { type: 'integer', maxLength: null, precision: null, scale: null };
    }

    // TEXT affinity
    if (
      baseType.includes('CHAR') ||
      baseType.includes('TEXT') ||
      baseType === 'CLOB' ||
      baseType === 'VARCHAR' ||
      baseType === 'NVARCHAR' ||
      baseType === 'NCHAR'
    ) {
      return { type: 'text', maxLength: param1, precision: null, scale: null };
    }

    // REAL affinity
    if (
      baseType === 'REAL' ||
      baseType === 'DOUBLE' ||
      baseType === 'FLOAT' ||
      baseType.includes('DOUBLE')
    ) {
      return { type: 'real', maxLength: null, precision: null, scale: null };
    }

    // NUMERIC affinity
    if (
      baseType === 'NUMERIC' ||
      baseType === 'DECIMAL' ||
      baseType === 'BOOLEAN' ||
      baseType === 'DATE' ||
      baseType === 'DATETIME' ||
      baseType === 'TIMESTAMP'
    ) {
      return {
        type: baseType.toLowerCase(),
        maxLength: null,
        precision: param1,
        scale: param2,
      };
    }

    // BLOB affinity
    if (baseType === 'BLOB' || baseType === '' || baseType === 'NONE') {
      return { type: 'blob', maxLength: null, precision: null, scale: null };
    }

    // Default to the original type
    return {
      type: type.toLowerCase() || 'blob',
      maxLength: param1,
      precision: param2 !== null ? param1 : null,
      scale: param2,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new SQLite adapter instance
 *
 * @example
 * ```typescript
 * const adapter = createSQLiteAdapter({
 *   type: DatabaseType.SQLITE,
 *   database: 'mydb',
 *   filename: './data/mydb.sqlite',
 *   wal: true
 * });
 * ```
 */
export function createSQLiteAdapter(config: SQLiteConfig): SQLiteAdapter {
  return new SQLiteAdapter(config);
}
