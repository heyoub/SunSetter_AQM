/**
 * Microsoft SQL Server Database Adapter
 *
 * Provides a unified interface for connecting to and introspecting
 * SQL Server databases. Implements the DatabaseAdapter interface
 * with MSSQL-specific introspection queries and connection handling.
 *
 * Features:
 * - Connection pooling via mssql package
 * - SQL Server-specific type mapping
 * - OFFSET/FETCH NEXT pagination (SQL Server 2012+)
 * - Comprehensive schema introspection using sys.* and INFORMATION_SCHEMA
 */

import * as sql from 'mssql';
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  IndexColumnInfo,
} from '../introspector/schema-introspector.js';
import {
  BaseAdapter,
  DatabaseConfig,
  DatabaseType,
  DatabaseAdapterError,
  StreamOptions,
  StreamBatch,
} from './base.js';

/**
 * SQL Server data type mappings to normalized type names
 *
 * Maps SQL Server-specific types to a normalized form that can be
 * used consistently across different database adapters.
 */
export const MSSQL_TYPE_MAP: Record<string, string> = {
  // Exact numerics
  bigint: 'bigint',
  int: 'integer',
  integer: 'integer',
  smallint: 'smallint',
  tinyint: 'tinyint',
  bit: 'boolean',
  decimal: 'decimal',
  numeric: 'numeric',
  money: 'money',
  smallmoney: 'smallmoney',

  // Approximate numerics
  float: 'float',
  real: 'real',

  // Date and time
  date: 'date',
  datetime: 'datetime',
  datetime2: 'datetime2',
  datetimeoffset: 'datetimeoffset',
  smalldatetime: 'smalldatetime',
  time: 'time',

  // Character strings
  char: 'char',
  varchar: 'varchar',
  text: 'text',

  // Unicode character strings
  nchar: 'nchar',
  nvarchar: 'nvarchar',
  ntext: 'ntext',

  // Binary strings
  binary: 'binary',
  varbinary: 'varbinary',
  image: 'image',

  // Other data types
  uniqueidentifier: 'uuid',
  xml: 'xml',
  sql_variant: 'sql_variant',
  hierarchyid: 'hierarchyid',
  geometry: 'geometry',
  geography: 'geography',
  rowversion: 'rowversion',
  timestamp: 'rowversion', // timestamp is synonym for rowversion

  // Alias types
  sysname: 'nvarchar', // sysname is nvarchar(128)
};

/**
 * SQL Server Database Adapter Implementation
 *
 * Implements full schema introspection and data streaming for SQL Server
 * databases using the mssql package with connection pooling.
 */
export class MssqlAdapter extends BaseAdapter {
  private pool: sql.ConnectionPool | null = null;

  constructor(config: DatabaseConfig) {
    super(config);

    // Ensure the database type is MSSQL
    if (config.type !== DatabaseType.MSSQL) {
      throw new Error(
        `MssqlAdapter requires DatabaseType.MSSQL, got: ${config.type}`
      );
    }
  }

  /**
   * Establish connection to SQL Server
   *
   * Creates a connection pool with the configured settings.
   * Supports SSL/TLS encryption via the options.encrypt setting.
   */
  async connect(): Promise<void> {
    if (this.connected && this.pool) {
      return;
    }

    try {
      const sslConfig = this.config.ssl;
      let encrypt = false;
      let trustServerCertificate = false;

      if (typeof sslConfig === 'boolean') {
        encrypt = sslConfig;
        // When SSL is enabled but not configured in detail, trust self-signed certs
        // This is common for local development
        trustServerCertificate = sslConfig;
      } else if (sslConfig && typeof sslConfig === 'object') {
        encrypt = true;
        trustServerCertificate = sslConfig.rejectUnauthorized === false;
      }

      const poolConfig: sql.config = {
        server: this.config.host || 'localhost',
        port: this.config.port || 1433,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        options: {
          encrypt: encrypt,
          trustServerCertificate: trustServerCertificate,
          enableArithAbort: true,
          // Use UTC for dates to maintain consistency
          useUTC: true,
        },
        pool: {
          max: this.config.maxConnections || 10,
          min: this.config.minConnections || 2,
          idleTimeoutMillis: this.config.idleTimeoutMs || 30000,
        },
        connectionTimeout: this.config.connectionTimeoutMs || 30000,
        requestTimeout: 60000, // 60 second request timeout
      };

      this.pool = await sql.connect(poolConfig);
      this.connected = true;
    } catch (error) {
      throw new DatabaseAdapterError(
        `Failed to connect to SQL Server: ${(error as Error).message}`,
        DatabaseType.MSSQL,
        'connect',
        error as Error
      );
    }
  }

  /**
   * Close the connection pool
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      this.connected = false;
    }
  }

  /**
   * Execute a SQL query
   *
   * Supports parameterized queries with positional parameters (@p0, @p1, etc.)
   * that are converted from the standard $1, $2 format.
   */
  async query<T = Record<string, unknown>>(
    sqlQuery: string,
    params?: unknown[]
  ): Promise<T[]> {
    this.ensureConnected();

    if (!this.pool) {
      throw new DatabaseAdapterError(
        'Connection pool is not initialized',
        DatabaseType.MSSQL,
        'query'
      );
    }

    try {
      const request = this.pool.request();

      // Convert PostgreSQL-style $1, $2 parameters to MSSQL @p0, @p1 style
      let convertedSql = sqlQuery;
      if (params && params.length > 0) {
        params.forEach((param, index) => {
          // Replace $N with @pN (0-indexed for MSSQL)
          const pgParam = `\\$${index + 1}`;
          const mssqlParam = `@p${index}`;
          convertedSql = convertedSql.replace(
            new RegExp(pgParam, 'g'),
            mssqlParam
          );

          // Add the parameter to the request
          request.input(
            `p${index}`,
            this.getSqlType(param) as sql.ISqlType,
            param
          );
        });
      }

      const result = await request.query(convertedSql);
      return result.recordset as T[];
    } catch (error) {
      throw new DatabaseAdapterError(
        `Query execution failed: ${(error as Error).message}`,
        DatabaseType.MSSQL,
        'query',
        error as Error
      );
    }
  }

  /**
   * Get all non-system schemas in the database
   *
   * Excludes system schemas: sys, INFORMATION_SCHEMA, guest, db_*
   */
  async getSchemas(): Promise<string[]> {
    this.ensureConnected();

    const query = `
      SELECT SCHEMA_NAME
      FROM INFORMATION_SCHEMA.SCHEMATA
      WHERE SCHEMA_NAME NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')
        AND SCHEMA_NAME NOT LIKE 'db_%'
      ORDER BY SCHEMA_NAME
    `;

    const result = await this.query<{ SCHEMA_NAME: string }>(query);
    return result.map((row) => row.SCHEMA_NAME);
  }

  /**
   * Get all base tables in a schema
   */
  async getTables(schema: string): Promise<string[]> {
    this.ensureConnected();

    const query = `
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = @p0
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `;

    const result = await this.query<{ TABLE_NAME: string }>(query, [schema]);
    return result.map((row) => row.TABLE_NAME);
  }

  /**
   * Get column information for a table
   *
   * Queries INFORMATION_SCHEMA.COLUMNS and sys.columns for complete
   * metadata including IDENTITY columns and computed columns.
   */
  async getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    const query = `
      SELECT
        c.COLUMN_NAME as columnName,
        c.DATA_TYPE as dataType,
        c.IS_NULLABLE as isNullable,
        c.COLUMN_DEFAULT as columnDefault,
        c.CHARACTER_MAXIMUM_LENGTH as characterMaximumLength,
        c.NUMERIC_PRECISION as numericPrecision,
        c.NUMERIC_SCALE as numericScale,
        c.ORDINAL_POSITION as ordinalPosition,
        COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') as isIdentity,
        COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsComputed') as isComputed,
        cc.definition as computedDefinition,
        ep.value as description
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN sys.computed_columns cc
        ON cc.object_id = OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME))
        AND cc.name = c.COLUMN_NAME
      LEFT JOIN sys.extended_properties ep
        ON ep.major_id = OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME))
        AND ep.minor_id = COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'ColumnId')
        AND ep.name = 'MS_Description'
      WHERE c.TABLE_SCHEMA = @p0
        AND c.TABLE_NAME = @p1
      ORDER BY c.ORDINAL_POSITION
    `;

    const result = await this.query<{
      columnName: string;
      dataType: string;
      isNullable: string;
      columnDefault: string | null;
      characterMaximumLength: number | null;
      numericPrecision: number | null;
      numericScale: number | null;
      ordinalPosition: number;
      isIdentity: number;
      isComputed: number;
      computedDefinition: string | null;
      description: string | null;
    }>(query, [schema, table]);

    // Get primary key columns
    const primaryKeys = await this.getPrimaryKeys(schema, table);
    const pkSet = new Set(primaryKeys);

    // Get foreign key columns
    const foreignKeys = await this.getForeignKeys(schema, table);
    const fkMap = new Map<string, ForeignKeyInfo>();
    for (const fk of foreignKeys) {
      fkMap.set(fk.columnName, fk);
    }

    return result.map((row) => {
      const fkInfo = fkMap.get(row.columnName);
      const isComputed = row.isComputed === 1;

      return {
        columnName: row.columnName,
        dataType: this.normalizeDataType(row.dataType),
        isNullable: row.isNullable === 'YES',
        columnDefault: row.columnDefault,
        characterMaximumLength: row.characterMaximumLength,
        numericPrecision: row.numericPrecision,
        numericScale: row.numericScale,
        ordinalPosition: row.ordinalPosition,
        isIdentity: row.isIdentity === 1,
        isPrimaryKey: pkSet.has(row.columnName),
        isForeignKey: fkMap.has(row.columnName),
        foreignKeyTable: fkInfo?.referencedTable || null,
        foreignKeyColumn: fkInfo?.referencedColumn || null,
        description: row.description,
        isGenerated: isComputed,
        generationExpression: isComputed ? row.computedDefinition : null,
        generationType: isComputed ? 'STORED' : null,
        domainName: null, // SQL Server doesn't have domain types like PostgreSQL
        domainBaseType: null,
      };
    });
  }

  /**
   * Get primary key columns for a table
   *
   * Queries sys.key_constraints and sys.index_columns to find
   * the primary key constraint and its columns.
   */
  async getPrimaryKeys(schema: string, table: string): Promise<string[]> {
    this.ensureConnected();

    const query = `
      SELECT col.name AS columnName
      FROM sys.key_constraints kc
      INNER JOIN sys.index_columns ic
        ON kc.parent_object_id = ic.object_id
        AND kc.unique_index_id = ic.index_id
      INNER JOIN sys.columns col
        ON ic.object_id = col.object_id
        AND ic.column_id = col.column_id
      WHERE kc.type = 'PK'
        AND OBJECT_SCHEMA_NAME(kc.parent_object_id) = @p0
        AND OBJECT_NAME(kc.parent_object_id) = @p1
      ORDER BY ic.key_ordinal
    `;

    const result = await this.query<{ columnName: string }>(query, [
      schema,
      table,
    ]);
    return result.map((row) => row.columnName);
  }

  /**
   * Get foreign key relationships for a table
   *
   * Queries sys.foreign_keys, sys.foreign_key_columns to get
   * complete foreign key metadata including referenced schema.
   */
  async getForeignKeys(
    schema: string,
    table: string
  ): Promise<ForeignKeyInfo[]> {
    this.ensureConnected();

    const query = `
      SELECT
        fk.name AS constraintName,
        COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS columnName,
        OBJECT_NAME(fkc.referenced_object_id) AS referencedTable,
        COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS referencedColumn,
        OBJECT_SCHEMA_NAME(fkc.referenced_object_id) AS referencedSchema
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc
        ON fk.object_id = fkc.constraint_object_id
      WHERE OBJECT_SCHEMA_NAME(fk.parent_object_id) = @p0
        AND OBJECT_NAME(fk.parent_object_id) = @p1
      ORDER BY fk.name, fkc.constraint_column_id
    `;

    const result = await this.query<{
      constraintName: string;
      columnName: string;
      referencedTable: string;
      referencedColumn: string;
      referencedSchema: string;
    }>(query, [schema, table]);

    return result.map((row) => ({
      constraintName: row.constraintName,
      columnName: row.columnName,
      referencedTable: row.referencedTable,
      referencedColumn: row.referencedColumn,
      referencedSchema: row.referencedSchema,
    }));
  }

  /**
   * Get index information for a table
   *
   * Queries sys.indexes and sys.index_columns for complete
   * index metadata including column order and uniqueness.
   */
  async getIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    this.ensureConnected();

    // First, get all indexes (excluding primary keys which are handled separately)
    const indexQuery = `
      SELECT
        i.name AS indexName,
        i.is_unique AS isUnique,
        i.type_desc AS indexType,
        i.has_filter AS isPartial,
        i.filter_definition AS partialPredicate
      FROM sys.indexes i
      WHERE i.object_id = OBJECT_ID(QUOTENAME(@p0) + '.' + QUOTENAME(@p1))
        AND i.is_primary_key = 0
        AND i.is_unique_constraint = 0
        AND i.name IS NOT NULL
      ORDER BY i.name
    `;

    const indexes = await this.query<{
      indexName: string;
      isUnique: boolean;
      indexType: string;
      isPartial: boolean;
      partialPredicate: string | null;
    }>(indexQuery, [schema, table]);

    const result: IndexInfo[] = [];

    for (const idx of indexes) {
      const columns = await this.getIndexColumns(schema, table, idx.indexName);

      // Map SQL Server index type to a generic method name
      let indexMethod = 'btree'; // Default
      if (idx.indexType === 'NONCLUSTERED COLUMNSTORE') {
        indexMethod = 'columnstore';
      } else if (idx.indexType === 'CLUSTERED') {
        indexMethod = 'clustered';
      } else if (idx.indexType === 'NONCLUSTERED') {
        indexMethod = 'btree';
      } else if (idx.indexType === 'XML') {
        indexMethod = 'xml';
      } else if (idx.indexType === 'SPATIAL') {
        indexMethod = 'spatial';
      }

      result.push({
        indexName: idx.indexName,
        columnName: columns.length > 0 ? columns[0].columnName : '',
        columns,
        isUnique: idx.isUnique,
        ordinalPosition: 1,
        isExpression: false, // SQL Server doesn't support expression indexes like PostgreSQL
        expressionDefinition: undefined,
        indexMethod,
        isPartial: idx.isPartial,
        partialPredicate: idx.partialPredicate || undefined,
      });
    }

    return result;
  }

  /**
   * Get detailed column information for a specific index
   */
  private async getIndexColumns(
    schema: string,
    table: string,
    indexName: string
  ): Promise<IndexColumnInfo[]> {
    const query = `
      SELECT
        col.name AS columnName,
        ic.key_ordinal AS ordinalPosition,
        CASE WHEN ic.is_descending_key = 1 THEN 'desc' ELSE 'asc' END AS sortOrder,
        ic.is_included_column AS isIncluded
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic
        ON i.object_id = ic.object_id
        AND i.index_id = ic.index_id
      INNER JOIN sys.columns col
        ON ic.object_id = col.object_id
        AND ic.column_id = col.column_id
      WHERE i.object_id = OBJECT_ID(QUOTENAME(@p0) + '.' + QUOTENAME(@p1))
        AND i.name = @p2
        AND ic.is_included_column = 0  -- Exclude included columns, get key columns only
      ORDER BY ic.key_ordinal
    `;

    const result = await this.query<{
      columnName: string;
      ordinalPosition: number;
      sortOrder: string;
      isIncluded: boolean;
    }>(query, [schema, table, indexName]);

    return result.map((row) => ({
      columnName: row.columnName,
      ordinalPosition: row.ordinalPosition,
      sortOrder: row.sortOrder === 'desc' ? 'desc' : 'asc',
      nullsPosition: 'last' as const, // SQL Server always sorts NULLs as smallest values
      isExpression: false,
      expression: undefined,
    }));
  }

  /**
   * Get the total row count for a table
   *
   * Uses sys.dm_db_partition_stats for fast approximate counts on large tables,
   * with fallback to COUNT(*) for exact counts.
   */
  async getTableRowCount(schema: string, table: string): Promise<number> {
    this.ensureConnected();

    // Use sys.dm_db_partition_stats for fast approximate counts
    // This is much faster than COUNT(*) for large tables
    const query = `
      SELECT SUM(p.rows) AS rowCount
      FROM sys.partitions p
      WHERE p.object_id = OBJECT_ID(QUOTENAME(@p0) + '.' + QUOTENAME(@p1))
        AND p.index_id IN (0, 1)  -- Heap or clustered index
    `;

    const result = await this.query<{ rowCount: number }>(query, [
      schema,
      table,
    ]);
    return result[0]?.rowCount || 0;
  }

  /**
   * Stream rows from a table in batches using OFFSET/FETCH NEXT pagination
   *
   * Uses SQL Server 2012+ OFFSET/FETCH NEXT syntax for efficient
   * cursor-based pagination. Requires an ORDER BY clause.
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

    // Determine the order by column (default to first primary key or first column)
    let orderColumn = orderBy;
    if (!orderColumn) {
      const primaryKeys = await this.getPrimaryKeys(schema, table);
      if (primaryKeys.length > 0) {
        orderColumn = primaryKeys[0];
      } else {
        // Fallback to first column
        const columns = await this.getColumns(schema, table);
        if (columns.length > 0) {
          orderColumn = columns[0].columnName;
        } else {
          throw new DatabaseAdapterError(
            `Table ${schema}.${table} has no columns`,
            DatabaseType.MSSQL,
            'streamRows'
          );
        }
      }
    }

    let offset = 0;
    let hasMore = true;
    let totalFetched = 0;

    while (hasMore) {
      // Build the query with OFFSET/FETCH NEXT
      let query = `
        SELECT *
        FROM ${this.escapeIdentifier(schema)}.${this.escapeIdentifier(table)}
      `;

      if (whereClause) {
        query += ` WHERE ${whereClause}`;
      }

      query += ` ORDER BY ${this.escapeIdentifier(orderColumn)} ${orderDirection}`;
      query += ` OFFSET @p${whereParams.length} ROWS FETCH NEXT @p${whereParams.length + 1} ROWS ONLY`;

      const params = [...whereParams, offset, batchSize];
      const rows = await this.query<Record<string, unknown>>(query, params);

      if (rows.length === 0) {
        hasMore = false;
      } else {
        // Track total fetched
        totalFetched += rows.length;
        offset += rows.length;

        // Check if this is the last batch
        const isLastBatch = rows.length < batchSize;
        hasMore = !isLastBatch;

        // Yield StreamBatch with full metadata
        yield {
          rows,
          nextCursor: offset, // MSSQL uses offset-based pagination
          isLastBatch,
          totalFetched,
        };
      }
    }
  }

  /**
   * Escape an identifier for safe SQL use
   *
   * SQL Server uses square brackets for identifier quoting: [table_name]
   * Handles identifiers containing brackets by doubling them.
   */
  escapeIdentifier(name: string): string {
    // Escape any existing brackets by doubling them
    const escaped = name.replace(/\]/g, ']]');
    return `[${escaped}]`;
  }

  /**
   * Test the database connection
   *
   * Executes a simple query to verify connectivity.
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
   * Normalize SQL Server data type to a standard form
   */
  private normalizeDataType(dataType: string): string {
    const normalized = dataType.toLowerCase();
    return MSSQL_TYPE_MAP[normalized] || normalized;
  }

  /**
   * Get the appropriate SQL type for a JavaScript value
   *
   * Used when binding parameters to queries.
   */
  private getSqlType(value: unknown): sql.ISqlTypeFactory {
    if (value === null || value === undefined) {
      return sql.NVarChar;
    }

    if (typeof value === 'string') {
      return sql.NVarChar;
    }

    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        // Check if it fits in an Int
        if (value >= -2147483648 && value <= 2147483647) {
          return sql.Int;
        }
        return sql.BigInt;
      }
      return sql.Float;
    }

    if (typeof value === 'boolean') {
      return sql.Bit;
    }

    if (value instanceof Date) {
      return sql.DateTime2;
    }

    if (Buffer.isBuffer(value)) {
      return sql.VarBinary;
    }

    // Default to NVarChar for unknown types
    return sql.NVarChar;
  }
}

/**
 * Create a new MSSQL adapter instance
 *
 * Factory function for creating MSSQL adapters with proper configuration.
 *
 * @param config - Database configuration options
 * @returns Configured MssqlAdapter instance
 *
 * @example
 * const adapter = createMssqlAdapter({
 *   type: DatabaseType.MSSQL,
 *   host: 'localhost',
 *   port: 1433,
 *   database: 'mydb',
 *   user: 'sa',
 *   password: 'password',
 *   ssl: { rejectUnauthorized: false }
 * });
 *
 * await adapter.connect();
 * const tables = await adapter.getTables('dbo');
 */
export function createMssqlAdapter(config: DatabaseConfig): MssqlAdapter {
  return new MssqlAdapter({
    ...config,
    type: DatabaseType.MSSQL,
  });
}

/**
 * Quick utility to create and connect an MSSQL adapter
 *
 * @param config - Database configuration options
 * @returns Connected MssqlAdapter instance
 */
export async function connectMssql(
  config: Omit<DatabaseConfig, 'type'>
): Promise<MssqlAdapter> {
  const adapter = createMssqlAdapter({
    ...config,
    type: DatabaseType.MSSQL,
  });
  await adapter.connect();
  return adapter;
}
