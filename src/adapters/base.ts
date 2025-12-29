/**
 * Database Adapter Abstraction Layer
 *
 * Provides a unified interface for connecting to and introspecting
 * different database systems (PostgreSQL, MySQL, SQLite, MSSQL).
 *
 * This abstraction enables the migration tool to support multiple
 * source database types with a consistent API.
 */

import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
} from '../introspector/schema-introspector.js';

/**
 * Supported database types for migration
 */
export enum DatabaseType {
  POSTGRESQL = 'postgresql',
  MYSQL = 'mysql',
  SQLITE = 'sqlite',
  MSSQL = 'mssql',
}

/**
 * Configuration options for database connections
 *
 * Supports both server-based databases (PostgreSQL, MySQL, MSSQL)
 * and file-based databases (SQLite)
 */
export interface DatabaseConfig {
  /** The type of database to connect to */
  type: DatabaseType;

  /** Database server hostname (not used for SQLite) */
  host?: string;

  /** Database server port (not used for SQLite) */
  port?: number;

  /** Database name (for server-based DBs) or identifier */
  database: string;

  /** Username for authentication (not used for SQLite) */
  user?: string;

  /** Password for authentication (not used for SQLite) */
  password?: string;

  /**
   * SSL configuration
   * - boolean: true enables SSL with default settings, false disables
   * - object: detailed SSL/TLS configuration options
   */
  ssl?: boolean | SSLOptions;

  /** Path to SQLite database file (SQLite only) */
  filename?: string;

  /** Connection timeout in milliseconds */
  connectionTimeoutMs?: number;

  /** Idle connection timeout in milliseconds */
  idleTimeoutMs?: number;

  /** Maximum number of connections in pool */
  maxConnections?: number;

  /** Minimum number of connections in pool */
  minConnections?: number;
}

/**
 * SSL/TLS configuration options for secure connections
 */
export interface SSLOptions {
  /** Reject connections with invalid/self-signed certificates */
  rejectUnauthorized?: boolean;

  /** Path to CA certificate file */
  ca?: string;

  /** Path to client certificate file */
  cert?: string;

  /** Path to client private key file */
  key?: string;

  /** Server name for SNI (Server Name Indication) */
  serverName?: string;
}

/**
 * Options for streaming rows from a table
 */
export interface StreamOptions {
  /** Number of rows to fetch per batch */
  batchSize: number;

  /**
   * Cursor position for pagination
   * Can be a primary key value (string/number) for keyset pagination
   */
  cursor?: string | number;

  /**
   * Column to order results by for consistent pagination
   * Should typically be the primary key or a unique indexed column
   */
  orderBy?: string;

  /**
   * Direction of ordering
   */
  orderDirection?: 'ASC' | 'DESC';

  /**
   * Additional WHERE clause conditions (parameterized)
   */
  whereClause?: string;

  /**
   * Parameters for the WHERE clause
   */
  whereParams?: unknown[];
}

/**
 * Result of a streaming operation containing batch metadata
 */
export interface StreamBatch<T = Record<string, unknown>> {
  /** The rows in this batch */
  rows: T[];

  /** The cursor value for the next batch (last row's orderBy column value) */
  nextCursor?: string | number;

  /** Whether this is the last batch */
  isLastBatch: boolean;

  /** Total rows fetched so far */
  totalFetched: number;
}

/**
 * Database adapter interface
 *
 * Defines the contract for all database adapters, providing a unified
 * API for connection management, querying, and schema introspection.
 */
export interface DatabaseAdapter {
  /**
   * Establish connection to the database
   *
   * Initializes connection pool and validates connectivity.
   * Should be called before any other operations.
   *
   * @throws Error if connection cannot be established
   */
  connect(): Promise<void>;

  /**
   * Close all connections and clean up resources
   *
   * Gracefully closes the connection pool and releases all resources.
   * Should be called when done with the adapter.
   */
  disconnect(): Promise<void>;

  /**
   * Execute a raw SQL query
   *
   * @param sql - The SQL query to execute
   * @param params - Optional parameterized query values
   * @returns Array of result rows
   *
   * @example
   * const users = await adapter.query<User>('SELECT * FROM users WHERE active = $1', [true]);
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>;

  /**
   * Get all schema names in the database
   *
   * @returns Array of schema names (excluding system schemas)
   *
   * @example
   * const schemas = await adapter.getSchemas();
   * // Returns: ['public', 'app', 'audit']
   */
  getSchemas(): Promise<string[]>;

  /**
   * Get all table names in a schema
   *
   * @param schema - The schema to query
   * @returns Array of table names
   *
   * @example
   * const tables = await adapter.getTables('public');
   * // Returns: ['users', 'posts', 'comments']
   */
  getTables(schema: string): Promise<string[]>;

  /**
   * Get column information for a table
   *
   * @param schema - The schema containing the table
   * @param table - The table name
   * @returns Array of column metadata
   */
  getColumns(schema: string, table: string): Promise<ColumnInfo[]>;

  /**
   * Get primary key column names for a table
   *
   * @param schema - The schema containing the table
   * @param table - The table name
   * @returns Array of primary key column names (supports composite keys)
   */
  getPrimaryKeys(schema: string, table: string): Promise<string[]>;

  /**
   * Get foreign key relationships for a table
   *
   * @param schema - The schema containing the table
   * @param table - The table name
   * @returns Array of foreign key metadata
   */
  getForeignKeys(schema: string, table: string): Promise<ForeignKeyInfo[]>;

  /**
   * Get index information for a table
   *
   * @param schema - The schema containing the table
   * @param table - The table name
   * @returns Array of index metadata
   */
  getIndexes(schema: string, table: string): Promise<IndexInfo[]>;

  /**
   * Get the total row count for a table
   *
   * Uses the most efficient method available for the database type.
   * For large tables, may use approximate counts if available.
   *
   * @param schema - The schema containing the table
   * @param table - The table name
   * @returns Total number of rows
   */
  getTableRowCount(schema: string, table: string): Promise<number>;

  /**
   * Stream rows from a table in batches
   *
   * Provides memory-efficient iteration over large tables using
   * cursor-based pagination. Each yielded batch contains multiple rows.
   *
   * @param schema - The schema containing the table
   * @param table - The table name
   * @param options - Streaming configuration options
   * @returns AsyncGenerator yielding batches of rows
   *
   * @example
   * for await (const batch of adapter.streamRows('public', 'users', { batchSize: 1000 })) {
   *   console.log(`Fetched ${batch.totalFetched} rows so far`);
   *   await processBatch(batch.rows);
   * }
   */
  streamRows(
    schema: string,
    table: string,
    options: StreamOptions
  ): AsyncGenerator<StreamBatch, void, unknown>;

  /**
   * Get the database type this adapter supports
   *
   * @returns The DatabaseType enum value
   */
  getDatabaseType(): DatabaseType;

  /**
   * Escape an identifier (table name, column name, etc.) for safe SQL use
   *
   * Different databases use different quoting mechanisms:
   * - PostgreSQL: "identifier"
   * - MySQL: `identifier`
   * - SQLite: "identifier" or [identifier]
   * - MSSQL: [identifier]
   *
   * @param name - The identifier to escape
   * @returns The escaped identifier safe for SQL inclusion
   *
   * @example
   * const safeName = adapter.escapeIdentifier('user-table');
   * // PostgreSQL: "user-table"
   * // MySQL: `user-table`
   */
  escapeIdentifier(name: string): string;

  /**
   * Check if the adapter is currently connected
   *
   * @returns true if connected and ready for queries
   */
  isConnected(): boolean;

  /**
   * Get the current database name
   *
   * @returns The database name from the configuration
   */
  getDatabaseName(): string;

  /**
   * Test the database connection
   *
   * Executes a simple query to verify connectivity.
   *
   * @returns true if connection is healthy
   */
  testConnection(): Promise<boolean>;
}

/**
 * Abstract base class for database adapters
 *
 * Provides common functionality and enforces the DatabaseAdapter contract.
 * Concrete implementations should extend this class.
 */
export abstract class BaseAdapter implements DatabaseAdapter {
  protected config: DatabaseConfig;
  protected connected: boolean = false;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>;
  abstract getSchemas(): Promise<string[]>;
  abstract getTables(schema: string): Promise<string[]>;
  abstract getColumns(schema: string, table: string): Promise<ColumnInfo[]>;
  abstract getPrimaryKeys(schema: string, table: string): Promise<string[]>;
  abstract getForeignKeys(
    schema: string,
    table: string
  ): Promise<ForeignKeyInfo[]>;
  abstract getIndexes(schema: string, table: string): Promise<IndexInfo[]>;
  abstract getTableRowCount(schema: string, table: string): Promise<number>;
  abstract streamRows(
    schema: string,
    table: string,
    options: StreamOptions
  ): AsyncGenerator<StreamBatch, void, unknown>;
  abstract escapeIdentifier(name: string): string;

  getDatabaseType(): DatabaseType {
    return this.config.type;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getDatabaseName(): string {
    return this.config.database;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate that the adapter is connected before executing operations
   *
   * @throws Error if not connected
   */
  protected ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        `Database adapter is not connected. Call connect() first.`
      );
    }
  }

  /**
   * Build a fully qualified table name with schema
   *
   * @param schema - The schema name
   * @param table - The table name
   * @returns Escaped fully-qualified table reference
   */
  protected qualifyTable(schema: string, table: string): string {
    return `${this.escapeIdentifier(schema)}.${this.escapeIdentifier(table)}`;
  }
}

/**
 * Error thrown when database adapter operations fail
 */
export class DatabaseAdapterError extends Error {
  constructor(
    message: string,
    public readonly databaseType: DatabaseType,
    public readonly operation: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DatabaseAdapterError';

    // Maintain proper stack trace in V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DatabaseAdapterError);
    }
  }
}

/**
 * Error thrown when an unsupported database type is requested
 */
export class UnsupportedDatabaseError extends Error {
  constructor(databaseType: string) {
    super(
      `Unsupported database type: "${databaseType}". ` +
        `Supported types: ${Object.values(DatabaseType).join(', ')}`
    );
    this.name = 'UnsupportedDatabaseError';
  }
}
