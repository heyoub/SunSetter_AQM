/**
 * PostgreSQL Database Adapter
 *
 * Implements the DatabaseAdapter interface for PostgreSQL databases.
 * Uses the 'pg' package for connection pooling and query execution.
 *
 * Features:
 * - Connection pooling with configurable pool size
 * - SSL/TLS support with certificate configuration
 * - Cursor-based streaming for large tables
 * - Full schema introspection via information_schema
 */

import { Pool, PoolConfig, PoolClient } from 'pg';
import * as fs from 'fs';
import * as tls from 'tls';

import {
  BaseAdapter,
  DatabaseConfig,
  DatabaseType,
  StreamOptions,
  StreamBatch,
  DatabaseAdapterError,
  type SSLOptions,
} from './base.js';

import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  IndexColumnInfo,
} from '../introspector/schema-introspector.js';

/**
 * PostgreSQL-specific configuration options
 */
export interface PostgreSQLConfig extends DatabaseConfig {
  type: DatabaseType.POSTGRESQL;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** Application name for connection identification in pg_stat_activity */
  applicationName?: string;
  /** Statement timeout in milliseconds (0 = no timeout) */
  statementTimeoutMs?: number;
  /** Lock timeout in milliseconds (0 = no timeout) */
  lockTimeoutMs?: number;
}

/**
 * PostgreSQL database adapter implementation
 */
export class PostgreSQLAdapter extends BaseAdapter {
  private pool: Pool | null = null;
  private poolConfig: PoolConfig;

  constructor(config: PostgreSQLConfig) {
    super({ ...config, type: DatabaseType.POSTGRESQL });

    this.poolConfig = this.buildPoolConfig(config);
  }

  /**
   * Build pg Pool configuration from our config
   */
  private buildPoolConfig(config: PostgreSQLConfig): PoolConfig {
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port ?? 5432,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: this.buildSSLConfig(config.ssl),
      connectionTimeoutMillis: config.connectionTimeoutMs ?? 10000,
      idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
      min: config.minConnections ?? 2,
      max: config.maxConnections ?? 10,
      application_name: config.applicationName ?? 'conVconV-migration',
    };

    return poolConfig;
  }

  /**
   * Build secure SSL configuration from config options
   *
   * SECURITY: By default, certificate verification is ENABLED.
   * Only disable rejectUnauthorized for development/testing with explicit config.
   */
  private buildSSLConfig(
    sslConfig: boolean | SSLOptions | undefined
  ): boolean | tls.ConnectionOptions {
    // If SSL is explicitly disabled
    if (sslConfig === false) {
      return false;
    }

    // If SSL is not configured, default based on environment
    if (sslConfig === undefined) {
      const isProduction = process.env.NODE_ENV === 'production';
      return isProduction ? { rejectUnauthorized: true } : false;
    }

    // Simple boolean true - enable with verification
    if (sslConfig === true) {
      return { rejectUnauthorized: true };
    }

    // Detailed SSL config object
    const tlsOptions: tls.ConnectionOptions = {};

    // SECURITY: Default to rejecting unauthorized certs
    if (sslConfig.rejectUnauthorized === false) {
      console.warn(
        '\x1b[33m[SECURITY WARNING]\x1b[0m SSL certificate verification is disabled. ' +
          'This exposes the connection to man-in-the-middle attacks. ' +
          'Only use this setting for development/testing environments.'
      );
      tlsOptions.rejectUnauthorized = false;
    } else {
      tlsOptions.rejectUnauthorized = true;
    }

    // Load CA certificate if provided
    if (sslConfig.ca) {
      try {
        tlsOptions.ca = fs.readFileSync(sslConfig.ca);
      } catch (error) {
        throw new DatabaseAdapterError(
          `Failed to load CA certificate from ${sslConfig.ca}: ${(error as Error).message}`,
          DatabaseType.POSTGRESQL,
          'ssl-config',
          error as Error
        );
      }
    }

    // Load client certificate if provided
    if (sslConfig.cert) {
      try {
        tlsOptions.cert = fs.readFileSync(sslConfig.cert);
      } catch (error) {
        throw new DatabaseAdapterError(
          `Failed to load client certificate from ${sslConfig.cert}: ${(error as Error).message}`,
          DatabaseType.POSTGRESQL,
          'ssl-config',
          error as Error
        );
      }
    }

    // Load client key if provided
    if (sslConfig.key) {
      try {
        tlsOptions.key = fs.readFileSync(sslConfig.key);
      } catch (error) {
        throw new DatabaseAdapterError(
          `Failed to load client key from ${sslConfig.key}: ${(error as Error).message}`,
          DatabaseType.POSTGRESQL,
          'ssl-config',
          error as Error
        );
      }
    }

    // Set server name for SNI
    if (sslConfig.serverName) {
      tlsOptions.servername = sslConfig.serverName;
    }

    return tlsOptions;
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(): Promise<void> {
    if (this.connected && this.pool) {
      return;
    }

    try {
      this.pool = new Pool(this.poolConfig);

      // Set up error handler for pool-level errors
      this.pool.on('error', (err) => {
        console.error('[PostgreSQL Pool Error]', err.message);
      });

      // Test connection by acquiring and releasing a client
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();

      this.connected = true;
    } catch (error) {
      this.pool = null;
      this.connected = false;
      throw new DatabaseAdapterError(
        `Failed to connect to PostgreSQL: ${(error as Error).message}`,
        DatabaseType.POSTGRESQL,
        'connect',
        error as Error
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.connected = false;
  }

  // ============================================================================
  // Query Execution
  // ============================================================================

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]> {
    this.ensureConnected();

    const client = await this.pool!.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows as T[];
    } catch (error) {
      throw new DatabaseAdapterError(
        `Query failed: ${(error as Error).message}`,
        DatabaseType.POSTGRESQL,
        'query',
        error as Error
      );
    } finally {
      client.release();
    }
  }

  /**
   * Execute a query within a transaction
   */
  async queryInTransaction<T = Record<string, unknown>>(
    queries: Array<{ sql: string; params?: unknown[] }>
  ): Promise<T[][]> {
    this.ensureConnected();

    const client = await this.pool!.connect();
    const results: T[][] = [];

    try {
      await client.query('BEGIN');

      for (const query of queries) {
        const result = await client.query(query.sql, query.params);
        results.push(result.rows as T[]);
      }

      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new DatabaseAdapterError(
        `Transaction failed: ${(error as Error).message}`,
        DatabaseType.POSTGRESQL,
        'transaction',
        error as Error
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get a client for manual transaction control
   */
  async getClient(): Promise<PoolClient> {
    this.ensureConnected();
    return this.pool!.connect();
  }

  // ============================================================================
  // Schema Introspection
  // ============================================================================

  async getSchemas(): Promise<string[]> {
    const query = `
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
      ORDER BY schema_name;
    `;

    const result = await this.query<{ schema_name: string }>(query);
    return result.map((row) => row.schema_name);
  }

  async getTables(schema: string): Promise<string[]> {
    const query = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;

    const result = await this.query<{ table_name: string }>(query, [schema]);
    return result.map((row) => row.table_name);
  }

  async getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const query = `
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.ordinal_position,
        c.is_identity,
        c.is_generated,
        c.generation_expression,
        c.domain_name,
        c.domain_schema,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
        CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
        fk.foreign_table_name,
        fk.foreign_column_name,
        col_description(pgc.oid, c.ordinal_position) as column_comment,
        dom.data_type as domain_base_type
      FROM information_schema.columns c
      LEFT JOIN pg_class pgc ON pgc.relname = c.table_name
      LEFT JOIN pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = c.table_schema
      LEFT JOIN (
        SELECT kcu.column_name, kcu.table_name, kcu.table_schema
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
      ) pk ON pk.column_name = c.column_name
        AND pk.table_name = c.table_name
        AND pk.table_schema = c.table_schema
      LEFT JOIN (
        SELECT
          kcu.column_name,
          kcu.table_name,
          kcu.table_schema,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
      ) fk ON fk.column_name = c.column_name
        AND fk.table_name = c.table_name
        AND fk.table_schema = c.table_schema
      LEFT JOIN information_schema.domains dom
        ON dom.domain_name = c.domain_name
        AND dom.domain_schema = c.domain_schema
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position;
    `;

    const result = await this.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
      ordinal_position: number;
      is_identity: string;
      is_generated: string;
      generation_expression: string | null;
      domain_name: string | null;
      domain_schema: string | null;
      is_primary_key: boolean;
      is_foreign_key: boolean;
      foreign_table_name: string | null;
      foreign_column_name: string | null;
      column_comment: string | null;
      domain_base_type: string | null;
    }>(query, [schema, table]);

    return result.map((row) => ({
      columnName: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable === 'YES',
      columnDefault: row.column_default,
      characterMaximumLength: row.character_maximum_length,
      numericPrecision: row.numeric_precision,
      numericScale: row.numeric_scale,
      ordinalPosition: row.ordinal_position,
      isIdentity: row.is_identity === 'YES',
      isPrimaryKey: row.is_primary_key,
      isForeignKey: row.is_foreign_key,
      foreignKeyTable: row.foreign_table_name,
      foreignKeyColumn: row.foreign_column_name,
      description: row.column_comment,
      isGenerated: row.is_generated === 'ALWAYS',
      generationExpression: row.generation_expression,
      generationType: row.is_generated === 'ALWAYS' ? 'STORED' : null,
      domainName: row.domain_name,
      domainBaseType: row.domain_base_type,
    }));
  }

  async getPrimaryKeys(schema: string, table: string): Promise<string[]> {
    const query = `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY kcu.ordinal_position;
    `;

    const result = await this.query<{ column_name: string }>(query, [
      schema,
      table,
    ]);
    return result.map((row) => row.column_name);
  }

  async getForeignKeys(
    schema: string,
    table: string
  ): Promise<ForeignKeyInfo[]> {
    const query = `
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        ccu.table_schema AS foreign_schema_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2;
    `;

    const result = await this.query<{
      constraint_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
      foreign_schema_name: string;
    }>(query, [schema, table]);

    return result.map((row) => ({
      constraintName: row.constraint_name,
      columnName: row.column_name,
      referencedTable: row.foreign_table_name,
      referencedColumn: row.foreign_column_name,
      referencedSchema: row.foreign_schema_name,
    }));
  }

  async getIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    // First get all indexes with their metadata
    const indexQuery = `
      SELECT
        i.relname as index_name,
        ix.indisunique as is_unique,
        am.amname as index_method,
        pg_get_expr(ix.indpred, ix.indrelid) as partial_predicate,
        pg_get_indexdef(ix.indexrelid) as index_definition,
        ix.indexprs IS NOT NULL as has_expressions,
        ix.indkey as column_positions
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON i.relam = am.oid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1
        AND t.relname = $2
        AND t.relkind = 'r'
        AND NOT ix.indisprimary
      ORDER BY i.relname;
    `;

    const indexes = await this.query<{
      index_name: string;
      is_unique: boolean;
      index_method: string;
      partial_predicate: string | null;
      index_definition: string;
      has_expressions: boolean;
      column_positions: number[];
    }>(indexQuery, [schema, table]);

    const result: IndexInfo[] = [];

    for (const idx of indexes) {
      const columns = await this.getIndexColumns(schema, table, idx.index_name);

      // Determine if this is an expression-only index
      const isExpressionIndex =
        idx.has_expressions && columns.every((c) => c.isExpression);

      result.push({
        indexName: idx.index_name,
        columnName: columns.length > 0 ? columns[0].columnName : '',
        columns,
        isUnique: idx.is_unique,
        ordinalPosition: 1,
        isExpression: isExpressionIndex,
        expressionDefinition: isExpressionIndex
          ? idx.index_definition
          : undefined,
        indexMethod: idx.index_method,
        isPartial: idx.partial_predicate !== null,
        partialPredicate: idx.partial_predicate || undefined,
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
        COALESCE(a.attname, 'expr_' || array_position(ix.indkey, 0)) as column_name,
        array_position(ix.indkey, COALESCE(a.attnum, 0)) as ordinal_position,
        CASE
          WHEN ix.indoption[array_position(ix.indkey, COALESCE(a.attnum, 0)) - 1] & 1 = 1 THEN 'desc'
          ELSE 'asc'
        END as sort_order,
        CASE
          WHEN ix.indoption[array_position(ix.indkey, COALESCE(a.attnum, 0)) - 1] & 2 = 2 THEN 'first'
          ELSE 'last'
        END as nulls_position,
        a.attnum = 0 OR a.attnum IS NULL as is_expression,
        pg_get_indexdef(ix.indexrelid, array_position(ix.indkey, COALESCE(a.attnum, 0)), true) as expression
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = $1
        AND t.relname = $2
        AND i.relname = $3
      ORDER BY array_position(ix.indkey, COALESCE(a.attnum, 0));
    `;

    const result = await this.query<{
      column_name: string;
      ordinal_position: number;
      sort_order: string;
      nulls_position: string;
      is_expression: boolean;
      expression: string | null;
    }>(query, [schema, table, indexName]);

    return result.map((row) => ({
      columnName: row.column_name,
      ordinalPosition: row.ordinal_position || 1,
      sortOrder: row.sort_order === 'desc' ? 'desc' : 'asc',
      nullsPosition: row.nulls_position === 'first' ? 'first' : 'last',
      isExpression: row.is_expression,
      expression: row.is_expression ? row.expression || undefined : undefined,
    }));
  }

  async getTableRowCount(schema: string, table: string): Promise<number> {
    // Use a fast approximate count for large tables, exact count for small ones
    // First try the statistics-based approach
    const approxQuery = `
      SELECT reltuples::bigint AS approximate_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2;
    `;

    const approxResult = await this.query<{ approximate_count: string }>(
      approxQuery,
      [schema, table]
    );

    const approxCount = parseInt(approxResult[0]?.approximate_count ?? '0', 10);

    // If approximate count is small or zero, get exact count
    if (approxCount < 10000) {
      const exactQuery = `SELECT COUNT(*) as count FROM ${this.qualifyTable(schema, table)}`;
      const exactResult = await this.query<{ count: string }>(exactQuery);
      return parseInt(exactResult[0]?.count ?? '0', 10);
    }

    return approxCount;
  }

  // ============================================================================
  // Data Streaming
  // ============================================================================

  /**
   * Stream rows from a table using cursor-based (keyset) pagination.
   *
   * This is memory-efficient for large tables as it doesn't load all rows at once.
   * Uses LIMIT/OFFSET with a WHERE clause for keyset pagination when a cursor
   * column is specified, or simple LIMIT/OFFSET otherwise.
   */
  async *streamRows(
    schema: string,
    table: string,
    options: StreamOptions
  ): AsyncGenerator<StreamBatch, void, unknown> {
    this.ensureConnected();

    const {
      batchSize,
      cursor: startCursor,
      orderBy,
      orderDirection = 'ASC',
      whereClause,
      whereParams = [],
    } = options;

    const qualifiedTable = this.qualifyTable(schema, table);

    // Determine the order by column
    const orderColumn =
      orderBy || (await this.getDefaultOrderColumn(schema, table));

    if (!orderColumn) {
      throw new DatabaseAdapterError(
        `Cannot stream rows: table ${schema}.${table} has no primary key or specified orderBy column`,
        DatabaseType.POSTGRESQL,
        'streamRows'
      );
    }

    let currentCursor = startCursor;
    let hasMore = true;
    let totalFetched = 0;

    while (hasMore) {
      // Build the query with keyset pagination
      const params: unknown[] = [...whereParams];
      let paramIndex = params.length + 1;

      let sql = `SELECT * FROM ${qualifiedTable}`;

      // Build WHERE clause
      const conditions: string[] = [];

      if (whereClause) {
        conditions.push(`(${whereClause})`);
      }

      if (currentCursor !== undefined) {
        // Keyset pagination: WHERE orderColumn > cursor (or < for DESC)
        const operator = orderDirection === 'ASC' ? '>' : '<';
        conditions.push(
          `${this.escapeIdentifier(orderColumn)} ${operator} $${paramIndex}`
        );
        params.push(currentCursor);
        paramIndex++;
      }

      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      sql += ` ORDER BY ${this.escapeIdentifier(orderColumn)} ${orderDirection}`;
      sql += ` LIMIT $${paramIndex}`;
      params.push(batchSize);

      const rows = await this.query<Record<string, unknown>>(sql, params);

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      // Track total fetched
      totalFetched += rows.length;

      // Get the last cursor value for next iteration
      const lastRow = rows[rows.length - 1];
      currentCursor = lastRow[orderColumn] as string | number;

      // Check if we've reached the end
      const isLastBatch = rows.length < batchSize;
      hasMore = !isLastBatch;

      // Yield StreamBatch with full metadata
      yield {
        rows,
        nextCursor: currentCursor,
        isLastBatch,
        totalFetched,
      };
    }
  }

  /**
   * Get the default column to use for ordering (primary key or first column)
   */
  private async getDefaultOrderColumn(
    schema: string,
    table: string
  ): Promise<string | null> {
    // Try to get primary key first
    const pks = await this.getPrimaryKeys(schema, table);
    if (pks.length > 0) {
      return pks[0]; // Use first PK column for simple keyset pagination
    }

    // Fall back to first column
    const columns = await this.getColumns(schema, table);
    if (columns.length > 0) {
      return columns[0].columnName;
    }

    return null;
  }

  // ============================================================================
  // Identifier Handling
  // ============================================================================

  /**
   * Escape an identifier using PostgreSQL double-quote syntax
   *
   * PostgreSQL identifiers are quoted with double quotes: "table_name"
   * Any embedded double quotes are escaped by doubling them: "table""name"
   */
  escapeIdentifier(name: string): string {
    // Escape any embedded double quotes by doubling them
    const escaped = name.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  // ============================================================================
  // Pool Statistics
  // ============================================================================

  /**
   * Get current connection pool statistics
   */
  getPoolStats(): {
    total: number;
    idle: number;
    waiting: number;
    active: number;
  } {
    if (!this.pool) {
      return { total: 0, idle: 0, waiting: 0, active: 0 };
    }

    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      active: this.pool.totalCount - this.pool.idleCount,
    };
  }

  /**
   * Warm up the connection pool by pre-creating minimum connections
   */
  async warmUp(): Promise<void> {
    this.ensureConnected();

    const minConnections = this.poolConfig.min ?? 2;
    const clients: PoolClient[] = [];

    try {
      // Acquire minimum connections
      for (let i = 0; i < minConnections; i++) {
        clients.push(await this.pool!.connect());
      }

      // Test each connection
      await Promise.all(clients.map((client) => client.query('SELECT 1')));
    } finally {
      // Release all connections back to pool
      for (const client of clients) {
        client.release();
      }
    }
  }

  /**
   * Get the raw pg Pool instance (for advanced use cases)
   */
  getPool(): Pool | null {
    return this.pool;
  }

  /**
   * Get connection string representation (masks password)
   */
  getConnectionString(): string {
    const config = this.config as PostgreSQLConfig;
    return `postgresql://${config.user}:***@${config.host}:${config.port}/${config.database}`;
  }
}

/**
 * Factory function to create a PostgreSQL adapter
 */
export function createPostgreSQLAdapter(
  config: Omit<PostgreSQLConfig, 'type'>
): PostgreSQLAdapter {
  return new PostgreSQLAdapter({
    ...config,
    type: DatabaseType.POSTGRESQL,
  });
}

/**
 * Create a PostgreSQL adapter from a connection string
 *
 * @param connectionString PostgreSQL connection string (postgresql://user:pass@host:port/db)
 * @param options Additional configuration options
 */
export function createPostgreSQLAdapterFromConnectionString(
  connectionString: string,
  options: Partial<PostgreSQLConfig> = {}
): PostgreSQLAdapter {
  const url = new URL(connectionString);

  const config: PostgreSQLConfig = {
    type: DatabaseType.POSTGRESQL,
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1), // Remove leading '/'
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: url.searchParams.get('sslmode') !== 'disable',
    ...options,
  };

  return new PostgreSQLAdapter(config);
}
