/**
 * MySQL Database Adapter
 *
 * Implements the DatabaseAdapter interface for MySQL databases.
 * Uses mysql2/promise for async connection pooling and query execution.
 */

import mysql, {
  Pool,
  PoolOptions,
  PoolConnection,
  RowDataPacket,
} from 'mysql2/promise';
import * as fs from 'fs';
import {
  BaseAdapter,
  DatabaseConfig,
  DatabaseType,
  StreamOptions,
  StreamBatch,
  DatabaseAdapterError,
} from './base.js';
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  IndexColumnInfo,
} from '../introspector/schema-introspector.js';

/**
 * MySQL-specific column type mapping
 *
 * Maps MySQL column types to a normalized format compatible with
 * the migration tool's type system.
 */
const MYSQL_TYPE_MAPPINGS: Record<string, string> = {
  // Integer types
  tinyint: 'tinyint',
  smallint: 'smallint',
  mediumint: 'mediumint',
  int: 'integer',
  integer: 'integer',
  bigint: 'bigint',

  // Floating point types
  float: 'real',
  double: 'double precision',
  'double precision': 'double precision',
  decimal: 'numeric',
  numeric: 'numeric',

  // String types
  char: 'character',
  varchar: 'character varying',
  tinytext: 'text',
  text: 'text',
  mediumtext: 'text',
  longtext: 'text',

  // Binary types
  binary: 'bytea',
  varbinary: 'bytea',
  tinyblob: 'bytea',
  blob: 'bytea',
  mediumblob: 'bytea',
  longblob: 'bytea',

  // Date/Time types
  date: 'date',
  datetime: 'timestamp without time zone',
  timestamp: 'timestamp with time zone',
  time: 'time without time zone',
  year: 'smallint',

  // Boolean (MySQL uses TINYINT(1))
  boolean: 'boolean',
  bool: 'boolean',

  // JSON
  json: 'json',

  // Spatial types
  geometry: 'geometry',
  point: 'point',
  linestring: 'linestring',
  polygon: 'polygon',

  // Other types
  enum: 'text',
  set: 'text',
  bit: 'bit',
};

/**
 * MySQL system schemas to exclude from introspection
 */
const MYSQL_SYSTEM_SCHEMAS = [
  'mysql',
  'information_schema',
  'performance_schema',
  'sys',
];

/**
 * MySQL Database Adapter
 *
 * Provides connection management and schema introspection for MySQL databases.
 * Supports MySQL 5.7+ and MariaDB 10.2+.
 */
export class MySQLAdapter extends BaseAdapter {
  private pool: Pool | null = null;
  private queryStats = {
    totalQueries: 0,
    totalTimeMs: 0,
  };

  constructor(config: DatabaseConfig) {
    super({ ...config, type: DatabaseType.MYSQL });
  }

  /**
   * Establish connection to MySQL database
   *
   * Creates a connection pool with the configured options.
   */
  async connect(): Promise<void> {
    if (this.pool) {
      // Already connected
      return;
    }

    const poolOptions: PoolOptions = {
      host: this.config.host,
      port: this.config.port ?? 3306,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      waitForConnections: true,
      connectionLimit: this.config.maxConnections ?? 10,
      queueLimit: 0,
      connectTimeout: this.config.connectionTimeoutMs ?? 10000,
      // Enable multipleStatements for batch operations if needed
      multipleStatements: false,
      // Enable named placeholders for easier parameterized queries
      namedPlaceholders: false,
      // Date handling
      dateStrings: false,
      // Timezone handling
      timezone: 'local',
    };

    // Configure SSL if specified
    if (this.config.ssl) {
      if (typeof this.config.ssl === 'boolean') {
        // Simple SSL enable - MySQL will use default CA bundle
        poolOptions.ssl = {};
      } else {
        // Detailed SSL configuration
        poolOptions.ssl = {
          rejectUnauthorized: this.config.ssl.rejectUnauthorized ?? true,
        };

        // Load certificates from files if paths provided
        if (this.config.ssl.ca) {
          try {
            poolOptions.ssl.ca = fs.readFileSync(this.config.ssl.ca);
          } catch (error) {
            throw new DatabaseAdapterError(
              `Failed to load CA certificate from ${this.config.ssl.ca}`,
              DatabaseType.MYSQL,
              'connect',
              error as Error
            );
          }
        }

        if (this.config.ssl.cert) {
          try {
            poolOptions.ssl.cert = fs.readFileSync(this.config.ssl.cert);
          } catch (error) {
            throw new DatabaseAdapterError(
              `Failed to load client certificate from ${this.config.ssl.cert}`,
              DatabaseType.MYSQL,
              'connect',
              error as Error
            );
          }
        }

        if (this.config.ssl.key) {
          try {
            poolOptions.ssl.key = fs.readFileSync(this.config.ssl.key);
          } catch (error) {
            throw new DatabaseAdapterError(
              `Failed to load client key from ${this.config.ssl.key}`,
              DatabaseType.MYSQL,
              'connect',
              error as Error
            );
          }
        }
      }
    }

    try {
      this.pool = mysql.createPool(poolOptions);

      // Test the connection
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();

      this.connected = true;
    } catch (error) {
      this.pool = null;
      throw new DatabaseAdapterError(
        `Failed to connect to MySQL database: ${(error as Error).message}`,
        DatabaseType.MYSQL,
        'connect',
        error as Error
      );
    }
  }

  /**
   * Close all connections and release the pool
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }

  /**
   * Execute a SQL query with optional parameters
   *
   * @param sql - SQL query string (uses ? for placeholders)
   * @param params - Optional query parameters
   * @returns Array of result rows
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]> {
    this.ensureConnected();

    const startTime = Date.now();

    try {
      const [rows] = await this.pool!.execute<RowDataPacket[]>(
        sql,
        params ?? []
      );
      this.queryStats.totalQueries++;
      this.queryStats.totalTimeMs += Date.now() - startTime;
      return rows as T[];
    } catch (error) {
      throw new DatabaseAdapterError(
        `Query execution failed: ${(error as Error).message}`,
        DatabaseType.MYSQL,
        'query',
        error as Error
      );
    }
  }

  /**
   * Get all schema (database) names
   *
   * In MySQL, schemas are equivalent to databases.
   */
  async getSchemas(): Promise<string[]> {
    this.ensureConnected();

    const result = await this.query<{ SCHEMA_NAME: string }>(
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME NOT IN (${MYSQL_SYSTEM_SCHEMAS.map(() => '?').join(', ')})
       ORDER BY SCHEMA_NAME`,
      MYSQL_SYSTEM_SCHEMAS
    );

    return result.map((row) => row.SCHEMA_NAME);
  }

  /**
   * Get all table names in a schema
   */
  async getTables(schema: string): Promise<string[]> {
    this.ensureConnected();

    const result = await this.query<{ TABLE_NAME: string }>(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [schema]
    );

    return result.map((row) => row.TABLE_NAME);
  }

  /**
   * Get column information for a table
   */
  async getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    // Query column information
    const result = await this.query<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      COLUMN_TYPE: string;
      IS_NULLABLE: string;
      COLUMN_DEFAULT: string | null;
      CHARACTER_MAXIMUM_LENGTH: number | null;
      NUMERIC_PRECISION: number | null;
      NUMERIC_SCALE: number | null;
      ORDINAL_POSITION: number;
      EXTRA: string;
      COLUMN_KEY: string;
      COLUMN_COMMENT: string;
      GENERATION_EXPRESSION: string;
    }>(
      `SELECT
         c.COLUMN_NAME,
         c.DATA_TYPE,
         c.COLUMN_TYPE,
         c.IS_NULLABLE,
         c.COLUMN_DEFAULT,
         c.CHARACTER_MAXIMUM_LENGTH,
         c.NUMERIC_PRECISION,
         c.NUMERIC_SCALE,
         c.ORDINAL_POSITION,
         c.EXTRA,
         c.COLUMN_KEY,
         c.COLUMN_COMMENT,
         COALESCE(c.GENERATION_EXPRESSION, '') AS GENERATION_EXPRESSION
       FROM information_schema.COLUMNS c
       WHERE c.TABLE_SCHEMA = ?
         AND c.TABLE_NAME = ?
       ORDER BY c.ORDINAL_POSITION`,
      [schema, table]
    );

    // Get primary keys for this table
    const primaryKeys = await this.getPrimaryKeys(schema, table);

    // Get foreign keys for this table
    const foreignKeys = await this.getForeignKeys(schema, table);
    const fkMap = new Map(foreignKeys.map((fk) => [fk.columnName, fk]));

    return result.map((row) => {
      const fk = fkMap.get(row.COLUMN_NAME);
      const isPrimaryKey =
        primaryKeys.includes(row.COLUMN_NAME) || row.COLUMN_KEY === 'PRI';
      const isForeignKey = fk !== undefined || row.COLUMN_KEY === 'MUL';

      // Determine if this is an auto_increment identity column
      const isIdentity = row.EXTRA.toLowerCase().includes('auto_increment');

      // Determine if this is a generated column
      const isGenerated =
        row.EXTRA.toLowerCase().includes('generated') ||
        row.EXTRA.toLowerCase().includes('virtual') ||
        row.EXTRA.toLowerCase().includes('stored');

      // Detect boolean type (TINYINT(1) is commonly used for boolean in MySQL)
      const isBoolean =
        row.COLUMN_TYPE.toLowerCase() === 'tinyint(1)' ||
        row.DATA_TYPE.toLowerCase() === 'boolean' ||
        row.DATA_TYPE.toLowerCase() === 'bool';

      // Normalize the data type
      let normalizedType = this.normalizeDataType(
        row.DATA_TYPE,
        row.COLUMN_TYPE
      );
      if (isBoolean) {
        normalizedType = 'boolean';
      }

      return {
        columnName: row.COLUMN_NAME,
        dataType: normalizedType,
        isNullable: row.IS_NULLABLE === 'YES',
        columnDefault: row.COLUMN_DEFAULT,
        characterMaximumLength: row.CHARACTER_MAXIMUM_LENGTH,
        numericPrecision: row.NUMERIC_PRECISION,
        numericScale: row.NUMERIC_SCALE,
        ordinalPosition: row.ORDINAL_POSITION,
        isIdentity,
        isPrimaryKey,
        isForeignKey,
        foreignKeyTable: fk?.referencedTable ?? null,
        foreignKeyColumn: fk?.referencedColumn ?? null,
        description: row.COLUMN_COMMENT || null,
        isGenerated,
        generationExpression: isGenerated ? row.GENERATION_EXPRESSION : null,
        generationType: isGenerated
          ? row.EXTRA.toLowerCase().includes('virtual')
            ? 'VIRTUAL'
            : 'STORED'
          : null,
        domainName: null, // MySQL doesn't have domain types
        domainBaseType: null,
      };
    });
  }

  /**
   * Get primary key columns for a table
   */
  async getPrimaryKeys(schema: string, table: string): Promise<string[]> {
    this.ensureConnected();

    const result = await this.query<{ COLUMN_NAME: string }>(
      `SELECT kcu.COLUMN_NAME
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
         AND tc.TABLE_NAME = kcu.TABLE_NAME
       WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
         AND tc.TABLE_SCHEMA = ?
         AND tc.TABLE_NAME = ?
       ORDER BY kcu.ORDINAL_POSITION`,
      [schema, table]
    );

    return result.map((row) => row.COLUMN_NAME);
  }

  /**
   * Get foreign key relationships for a table
   */
  async getForeignKeys(
    schema: string,
    table: string
  ): Promise<ForeignKeyInfo[]> {
    this.ensureConnected();

    const result = await this.query<{
      CONSTRAINT_NAME: string;
      COLUMN_NAME: string;
      REFERENCED_TABLE_SCHEMA: string;
      REFERENCED_TABLE_NAME: string;
      REFERENCED_COLUMN_NAME: string;
    }>(
      `SELECT
         kcu.CONSTRAINT_NAME,
         kcu.COLUMN_NAME,
         kcu.REFERENCED_TABLE_SCHEMA,
         kcu.REFERENCED_TABLE_NAME,
         kcu.REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = ?
         AND kcu.TABLE_NAME = ?
         AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      [schema, table]
    );

    return result.map((row) => ({
      constraintName: row.CONSTRAINT_NAME,
      columnName: row.COLUMN_NAME,
      referencedTable: row.REFERENCED_TABLE_NAME,
      referencedColumn: row.REFERENCED_COLUMN_NAME,
      referencedSchema: row.REFERENCED_TABLE_SCHEMA,
    }));
  }

  /**
   * Get index information for a table
   */
  async getIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    this.ensureConnected();

    // Query index information from STATISTICS
    const result = await this.query<{
      INDEX_NAME: string;
      COLUMN_NAME: string;
      SEQ_IN_INDEX: number;
      NON_UNIQUE: number;
      INDEX_TYPE: string;
      COLLATION: string | null;
      NULLABLE: string;
      SUB_PART: number | null;
      EXPRESSION: string | null;
    }>(
      `SELECT
         s.INDEX_NAME,
         s.COLUMN_NAME,
         s.SEQ_IN_INDEX,
         s.NON_UNIQUE,
         s.INDEX_TYPE,
         s.COLLATION,
         s.NULLABLE,
         s.SUB_PART,
         NULL AS EXPRESSION
       FROM information_schema.STATISTICS s
       WHERE s.TABLE_SCHEMA = ?
         AND s.TABLE_NAME = ?
         AND s.INDEX_NAME != 'PRIMARY'
       ORDER BY s.INDEX_NAME, s.SEQ_IN_INDEX`,
      [schema, table]
    );

    // Group by index name
    const indexMap = new Map<
      string,
      {
        isUnique: boolean;
        indexMethod: string;
        columns: IndexColumnInfo[];
      }
    >();

    for (const row of result) {
      if (!indexMap.has(row.INDEX_NAME)) {
        indexMap.set(row.INDEX_NAME, {
          isUnique: row.NON_UNIQUE === 0,
          indexMethod: row.INDEX_TYPE.toLowerCase(),
          columns: [],
        });
      }

      const indexInfo = indexMap.get(row.INDEX_NAME)!;

      // Determine sort order from COLLATION
      // 'A' = ascending, 'D' = descending, NULL = not sorted
      const sortOrder = row.COLLATION === 'D' ? 'desc' : 'asc';

      // Check if this is an expression-based index column (MySQL 8.0+)
      const isExpression = row.EXPRESSION !== null;

      indexInfo.columns.push({
        columnName: isExpression ? `(${row.EXPRESSION})` : row.COLUMN_NAME,
        ordinalPosition: row.SEQ_IN_INDEX,
        sortOrder: sortOrder as 'asc' | 'desc',
        nullsPosition: row.NULLABLE === 'YES' ? 'last' : 'last', // MySQL doesn't support NULLS FIRST/LAST
        isExpression,
        expression: row.EXPRESSION ?? undefined,
      });
    }

    // Convert map to array of IndexInfo
    const indexes: IndexInfo[] = [];
    for (const [indexName, info] of indexMap) {
      indexes.push({
        indexName,
        columnName: info.columns[0]?.columnName ?? '',
        columns: info.columns,
        isUnique: info.isUnique,
        ordinalPosition: 1,
        isExpression: info.columns.some((c) => c.isExpression),
        expressionDefinition: undefined, // MySQL doesn't expose full index definition easily
        indexMethod: info.indexMethod,
        isPartial: false, // MySQL doesn't support partial indexes
        partialPredicate: undefined,
      });
    }

    return indexes;
  }

  /**
   * Get the total row count for a table
   *
   * Uses table statistics for large tables when available,
   * falls back to COUNT(*) for accuracy.
   */
  async getTableRowCount(schema: string, table: string): Promise<number> {
    this.ensureConnected();

    // Try to get approximate count from table statistics (much faster for large tables)
    const statsResult = await this.query<{ TABLE_ROWS: number }>(
      `SELECT TABLE_ROWS
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?`,
      [schema, table]
    );

    if (statsResult.length > 0 && statsResult[0].TABLE_ROWS !== null) {
      // For InnoDB, this is an approximation. For exact count, use COUNT(*)
      // Return the stats-based count for efficiency
      return statsResult[0].TABLE_ROWS;
    }

    // Fall back to exact count
    const countResult = await this.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${this.escapeIdentifier(schema)}.${this.escapeIdentifier(table)}`
    );

    return countResult[0]?.count ?? 0;
  }

  /**
   * Stream rows from a table in batches using LIMIT/OFFSET pagination
   *
   * For very large tables, consider using keyset pagination based on
   * primary key for better performance.
   */
  async *streamRows(
    schema: string,
    table: string,
    options: StreamOptions
  ): AsyncGenerator<StreamBatch, void, unknown> {
    this.ensureConnected();

    const {
      batchSize,
      orderBy,
      orderDirection = 'ASC',
      whereClause,
      whereParams = [],
    } = options;
    let { cursor } = options;

    // Determine the order column (prefer primary key for keyset pagination)
    let orderColumn = orderBy;
    if (!orderColumn) {
      const primaryKeys = await this.getPrimaryKeys(schema, table);
      orderColumn = primaryKeys[0];
    }

    if (!orderColumn) {
      throw new DatabaseAdapterError(
        `Cannot stream rows without an order column. Table ${schema}.${table} has no primary key and no orderBy specified.`,
        DatabaseType.MYSQL,
        'streamRows'
      );
    }

    const qualifiedTable = this.qualifyTable(schema, table);
    const escapedOrderColumn = this.escapeIdentifier(orderColumn);
    const direction = orderDirection.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const comparisonOp = direction === 'DESC' ? '<' : '>';

    let hasMore = true;
    let totalFetched = 0;

    while (hasMore) {
      // Build the query with keyset pagination
      let sql = `SELECT * FROM ${qualifiedTable}`;
      const params: unknown[] = [];

      // Build WHERE clause
      const conditions: string[] = [];

      // Cursor condition for keyset pagination
      if (cursor !== undefined && cursor !== null) {
        conditions.push(`${escapedOrderColumn} ${comparisonOp} ?`);
        params.push(cursor);
      }

      // User-provided WHERE clause
      if (whereClause) {
        conditions.push(`(${whereClause})`);
        params.push(...whereParams);
      }

      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      sql += ` ORDER BY ${escapedOrderColumn} ${direction}`;
      sql += ` LIMIT ?`;
      params.push(batchSize);

      // Execute the query
      const rows = await this.query<Record<string, unknown>>(sql, params);

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      // Track total fetched
      totalFetched += rows.length;

      // Update cursor for next batch
      const lastRow = rows[rows.length - 1];
      cursor = lastRow[orderColumn] as string | number | undefined;

      // Check if this is the last batch
      const isLastBatch = rows.length < batchSize;
      hasMore = !isLastBatch;

      // Yield StreamBatch with full metadata
      yield {
        rows,
        nextCursor: cursor,
        isLastBatch,
        totalFetched,
      };
    }
  }

  /**
   * Escape an identifier (table name, column name) using backticks
   */
  escapeIdentifier(name: string): string {
    // Replace any existing backticks with escaped backticks
    const escaped = name.replace(/`/g, '``');
    return `\`${escaped}\``;
  }

  /**
   * Test the database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.query('SELECT 1 AS test');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingRequests: number;
  } {
    if (!this.pool) {
      return {
        totalConnections: 0,
        activeConnections: 0,
        idleConnections: 0,
        waitingRequests: 0,
      };
    }

    // mysql2 pool exposes these properties
    const pool = this.pool as any;
    return {
      totalConnections: pool._allConnections?.length ?? 0,
      activeConnections:
        (pool._allConnections?.length ?? 0) -
        (pool._freeConnections?.length ?? 0),
      idleConnections: pool._freeConnections?.length ?? 0,
      waitingRequests: pool._connectionQueue?.length ?? 0,
    };
  }

  /**
   * Get a connection from the pool for transaction use
   */
  async getConnection(): Promise<PoolConnection> {
    this.ensureConnected();
    return this.pool!.getConnection();
  }

  /**
   * Execute multiple queries within a transaction
   */
  async transaction<T>(
    callback: (connection: PoolConnection) => Promise<T>
  ): Promise<T> {
    this.ensureConnected();

    const connection = await this.pool!.getConnection();

    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Normalize MySQL data type to a standard format
   */
  private normalizeDataType(dataType: string, columnType: string): string {
    const lowerType = dataType.toLowerCase();

    // Check for specific column type patterns
    if (columnType.toLowerCase() === 'tinyint(1)') {
      return 'boolean';
    }

    // Handle enum and set specially - extract the values
    if (lowerType === 'enum' || lowerType === 'set') {
      return lowerType;
    }

    // Check our mapping table
    const mapped = MYSQL_TYPE_MAPPINGS[lowerType];
    if (mapped) {
      return mapped;
    }

    // Handle unsigned integers
    if (columnType.toLowerCase().includes('unsigned')) {
      return `${lowerType} unsigned`;
    }

    // Return the original type if not in mapping
    return lowerType;
  }
}

/**
 * Create a MySQL adapter with the given configuration
 */
export function createMySQLAdapter(
  config: Omit<DatabaseConfig, 'type'>
): MySQLAdapter {
  return new MySQLAdapter({
    ...config,
    type: DatabaseType.MYSQL,
  });
}
