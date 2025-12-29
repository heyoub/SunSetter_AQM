/**
 * Database Adapters Module
 *
 * Provides a unified interface for connecting to different database systems.
 * Use the createAdapter factory function to instantiate the appropriate adapter
 * based on the database configuration.
 *
 * @example
 * import { createAdapter, DatabaseType } from './adapters';
 *
 * const adapter = createAdapter({
 *   type: DatabaseType.POSTGRESQL,
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'mydb',
 *   user: 'postgres',
 *   password: 'secret',
 * });
 *
 * await adapter.connect();
 * const schemas = await adapter.getSchemas();
 * await adapter.disconnect();
 */

// Export all types and interfaces
export {
  DatabaseType,
  BaseAdapter,
  DatabaseAdapterError,
  UnsupportedDatabaseError,
} from './base.js';

export type {
  DatabaseConfig,
  SSLOptions,
  StreamOptions,
  StreamBatch,
  DatabaseAdapter,
} from './base.js';

// Export MSSQL adapter
export {
  MssqlAdapter,
  createMssqlAdapter,
  connectMssql,
  MSSQL_TYPE_MAP,
} from './mssql.js';

// Export MySQL adapter
export { MySQLAdapter, createMySQLAdapter } from './mysql.js';

// Export SQLite adapter
export {
  SQLiteAdapter,
  createSQLiteAdapter,
  type SQLiteConfig,
} from './sqlite.js';

// Export PostgreSQL adapter
export {
  PostgreSQLAdapter,
  createPostgreSQLAdapter,
  createPostgreSQLAdapterFromConnectionString,
  type PostgreSQLConfig,
} from './postgresql.js';

// Re-export schema types for convenience
export type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  IndexColumnInfo,
} from '../introspector/schema-introspector.js';

import {
  DatabaseType,
  DatabaseConfig,
  DatabaseAdapter,
  UnsupportedDatabaseError,
} from './base.js';
import { MssqlAdapter } from './mssql.js';
import { MySQLAdapter } from './mysql.js';
import { PostgreSQLAdapter } from './postgresql.js';
import { SQLiteAdapter } from './sqlite.js';

/**
 * Registry of adapter constructors by database type
 *
 * This allows for lazy loading of adapters - they're only imported
 * when actually needed, reducing initial bundle size.
 *
 * Note: We use `unknown` for the constructor type to allow different
 * specific config types per adapter (PostgreSQLConfig, MySQLConfig, etc.)
 * The factory function ensures type safety at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdapterClass = new (config: any) => DatabaseAdapter;

const adapterRegistry: Partial<Record<DatabaseType, AdapterClass>> = {
  // Register MSSQL adapter
  [DatabaseType.MSSQL]: MssqlAdapter,
  // Register MySQL adapter
  [DatabaseType.MYSQL]: MySQLAdapter,
  // Register PostgreSQL adapter
  [DatabaseType.POSTGRESQL]: PostgreSQLAdapter,
  // Register SQLite adapter
  [DatabaseType.SQLITE]: SQLiteAdapter,
};

/**
 * Register a database adapter implementation
 *
 * This function allows adapter implementations to register themselves
 * with the factory. Useful for plugin architectures or lazy loading.
 *
 * @param type - The database type this adapter handles
 * @param constructor - The adapter class constructor
 *
 * @example
 * import { PostgreSQLAdapter } from './postgresql';
 * registerAdapter(DatabaseType.POSTGRESQL, PostgreSQLAdapter);
 */
export function registerAdapter(
  type: DatabaseType,
  constructor: AdapterClass
): void {
  adapterRegistry[type] = constructor;
}

/**
 * Check if an adapter is registered for a database type
 *
 * @param type - The database type to check
 * @returns true if an adapter is registered
 */
export function hasAdapter(type: DatabaseType): boolean {
  return type in adapterRegistry;
}

/**
 * Get list of registered adapter types
 *
 * @returns Array of database types with registered adapters
 */
export function getRegisteredAdapters(): DatabaseType[] {
  return Object.keys(adapterRegistry) as DatabaseType[];
}

/**
 * Create a database adapter based on configuration
 *
 * Factory function that instantiates the appropriate adapter
 * based on the database type specified in the configuration.
 *
 * @param config - Database connection configuration
 * @returns A DatabaseAdapter instance for the specified database type
 * @throws UnsupportedDatabaseError if no adapter is registered for the type
 *
 * @example
 * // PostgreSQL connection
 * const pgAdapter = createAdapter({
 *   type: DatabaseType.POSTGRESQL,
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'myapp',
 *   user: 'postgres',
 *   password: 'secret',
 *   ssl: true,
 * });
 *
 * @example
 * // SQLite connection
 * const sqliteAdapter = createAdapter({
 *   type: DatabaseType.SQLITE,
 *   database: 'myapp',
 *   filename: './data/myapp.db',
 * });
 *
 * @example
 * // MySQL connection
 * const mysqlAdapter = createAdapter({
 *   type: DatabaseType.MYSQL,
 *   host: 'localhost',
 *   port: 3306,
 *   database: 'myapp',
 *   user: 'root',
 *   password: 'secret',
 * });
 */
export function createAdapter(config: DatabaseConfig): DatabaseAdapter {
  const AdapterClass = adapterRegistry[config.type];

  if (!AdapterClass) {
    // Check if the type is a valid DatabaseType but just not registered
    if (Object.values(DatabaseType).includes(config.type)) {
      throw new UnsupportedDatabaseError(
        `${config.type} (adapter not yet implemented or not registered)`
      );
    }
    throw new UnsupportedDatabaseError(config.type);
  }

  return new AdapterClass(config);
}

/**
 * Create a database adapter with automatic connection
 *
 * Convenience function that creates an adapter and connects to the database.
 * Useful for simple scripts where you don't need fine-grained control.
 *
 * @param config - Database connection configuration
 * @returns A connected DatabaseAdapter instance
 * @throws Error if connection fails
 *
 * @example
 * const adapter = await createConnectedAdapter({
 *   type: DatabaseType.POSTGRESQL,
 *   host: 'localhost',
 *   database: 'mydb',
 *   user: 'postgres',
 *   password: 'secret',
 * });
 *
 * try {
 *   const schemas = await adapter.getSchemas();
 *   console.log(schemas);
 * } finally {
 *   await adapter.disconnect();
 * }
 */
export async function createConnectedAdapter(
  config: DatabaseConfig
): Promise<DatabaseAdapter> {
  const adapter = createAdapter(config);
  await adapter.connect();
  return adapter;
}

/**
 * Helper to run operations with automatic connection management
 *
 * Creates an adapter, connects, executes the callback, and disconnects.
 * Ensures proper cleanup even if an error occurs.
 *
 * @param config - Database connection configuration
 * @param callback - Function to execute with the connected adapter
 * @returns The result of the callback function
 *
 * @example
 * const tables = await withAdapter(config, async (adapter) => {
 *   const schemas = await adapter.getSchemas();
 *   const allTables: string[] = [];
 *   for (const schema of schemas) {
 *     allTables.push(...await adapter.getTables(schema));
 *   }
 *   return allTables;
 * });
 */
export async function withAdapter<T>(
  config: DatabaseConfig,
  callback: (adapter: DatabaseAdapter) => Promise<T>
): Promise<T> {
  const adapter = createAdapter(config);

  try {
    await adapter.connect();
    return await callback(adapter);
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Validate database configuration
 *
 * Checks that the configuration contains all required fields
 * for the specified database type.
 *
 * @param config - Configuration to validate
 * @returns Object with isValid boolean and error messages if invalid
 */
export function validateConfig(config: DatabaseConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check database type
  if (!config.type) {
    errors.push('Database type is required');
  } else if (!Object.values(DatabaseType).includes(config.type)) {
    errors.push(
      `Invalid database type: ${config.type}. ` +
        `Valid types: ${Object.values(DatabaseType).join(', ')}`
    );
  }

  // Check database name
  if (!config.database) {
    errors.push('Database name is required');
  }

  // Type-specific validation
  if (config.type === DatabaseType.SQLITE) {
    if (!config.filename) {
      errors.push('Filename is required for SQLite databases');
    }
  } else {
    // Server-based databases require host and credentials
    if (!config.host) {
      errors.push(`Host is required for ${config.type} databases`);
    }
    if (!config.user) {
      errors.push(`User is required for ${config.type} databases`);
    }
    // Password can be empty for some configurations, so we don't require it
  }

  // Validate port if provided
  if (config.port !== undefined) {
    if (
      typeof config.port !== 'number' ||
      config.port < 1 ||
      config.port > 65535
    ) {
      errors.push('Port must be a number between 1 and 65535');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get default port for a database type
 *
 * @param type - The database type
 * @returns The default port number, or undefined for file-based databases
 */
export function getDefaultPort(type: DatabaseType): number | undefined {
  const defaultPorts: Record<DatabaseType, number | undefined> = {
    [DatabaseType.POSTGRESQL]: 5432,
    [DatabaseType.MYSQL]: 3306,
    [DatabaseType.SQLITE]: undefined,
    [DatabaseType.MSSQL]: 1433,
  };

  return defaultPorts[type];
}

/**
 * Parse a database connection string into a DatabaseConfig
 *
 * Supports common connection string formats for different databases.
 *
 * @param connectionString - The connection string to parse
 * @returns Parsed DatabaseConfig
 * @throws Error if the connection string format is not recognized
 *
 * @example
 * const config = parseConnectionString('postgresql://user:pass@localhost:5432/mydb');
 * // Returns: { type: POSTGRESQL, host: 'localhost', port: 5432, database: 'mydb', ... }
 */
export function parseConnectionString(
  connectionString: string
): DatabaseConfig {
  const url = new URL(connectionString);
  const protocol = url.protocol.replace(':', '').toLowerCase();

  // Map protocol to database type
  const protocolMap: Record<string, DatabaseType> = {
    postgresql: DatabaseType.POSTGRESQL,
    postgres: DatabaseType.POSTGRESQL,
    pg: DatabaseType.POSTGRESQL,
    mysql: DatabaseType.MYSQL,
    mariadb: DatabaseType.MYSQL,
    sqlite: DatabaseType.SQLITE,
    sqlite3: DatabaseType.SQLITE,
    mssql: DatabaseType.MSSQL,
    sqlserver: DatabaseType.MSSQL,
  };

  const type = protocolMap[protocol];
  if (!type) {
    throw new Error(
      `Unknown database protocol: ${protocol}. ` +
        `Supported protocols: ${Object.keys(protocolMap).join(', ')}`
    );
  }

  const config: DatabaseConfig = {
    type,
    database: url.pathname.replace(/^\//, ''),
  };

  if (type === DatabaseType.SQLITE) {
    config.filename = url.pathname;
  } else {
    config.host = url.hostname || 'localhost';
    config.port = url.port ? parseInt(url.port, 10) : getDefaultPort(type);
    config.user = url.username || undefined;
    config.password = url.password || undefined;

    // Parse SSL from query string
    const sslParam = url.searchParams.get('ssl');
    if (sslParam !== null) {
      config.ssl = sslParam === 'true' || sslParam === '1';
    }

    const sslModeParam = url.searchParams.get('sslmode');
    if (sslModeParam) {
      config.ssl = sslModeParam !== 'disable';
    }
  }

  return config;
}
