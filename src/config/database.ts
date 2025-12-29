import { Pool, PoolConfig, PoolClient } from 'pg';
import * as fs from 'fs';
import * as tls from 'tls';

/**
 * SSL configuration options for secure database connections
 */
export interface SSLConfig {
  /** Enable SSL (default: true in production) */
  enabled: boolean;
  /**
   * Reject unauthorized certificates (default: true)
   * WARNING: Setting to false disables certificate verification and exposes
   * the connection to man-in-the-middle attacks. Only use for development.
   */
  rejectUnauthorized?: boolean;
  /** Path to CA certificate file */
  ca?: string;
  /** Path to client certificate file */
  cert?: string;
  /** Path to client key file */
  key?: string;
  /** Server name for SNI (Server Name Indication) */
  serverName?: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** SSL configuration - boolean for simple on/off or object for detailed config */
  ssl?: boolean | SSLConfig;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  max?: number;
}

/**
 * Enhanced connection pool configuration
 */
export interface EnhancedPoolConfig extends DatabaseConfig {
  /** Minimum pool size */
  min?: number;
  /** Maximum pool size */
  max?: number;
  /** Acquire timeout in ms */
  acquireTimeoutMs?: number;
  /** Idle timeout in ms (connections idle longer than this are closed) */
  idleTimeoutMs?: number;
  /** Connection timeout in ms */
  connectionTimeoutMs?: number;
  /** Whether to enable statement caching */
  statementCaching?: boolean;
  /** Max cached statements per connection */
  maxCachedStatements?: number;
  /** Enable connection health checks */
  healthCheckEnabled?: boolean;
  /** Health check interval (ms) */
  healthCheckIntervalMs?: number;
}

/**
 * Connection pool statistics
 */
export interface PoolStats {
  /** Total connections in pool */
  total: number;
  /** Idle connections */
  idle: number;
  /** Waiting requests */
  waiting: number;
  /** Active connections (checked out) */
  active: number;
  /** Total queries executed */
  totalQueries: number;
  /** Average query time (ms) */
  avgQueryTimeMs: number;
  /** Total connection errors */
  connectionErrors: number;
  /** Pool uptime (ms) */
  uptimeMs: number;
}

/**
 * Default enhanced pool configuration
 */
export const DEFAULT_POOL_CONFIG: Readonly<Partial<EnhancedPoolConfig>> =
  Object.freeze({
    min: 2,
    max: 10,
    acquireTimeoutMs: 30000,
    idleTimeoutMs: 30000,
    connectionTimeoutMs: 10000,
    statementCaching: true,
    maxCachedStatements: 100,
    healthCheckEnabled: true,
    healthCheckIntervalMs: 30000,
  });

export class DatabaseConnection {
  private pool: Pool;
  private config: EnhancedPoolConfig;
  private stats: {
    totalQueries: number;
    totalQueryTimeMs: number;
    connectionErrors: number;
    startTime: number;
  };
  private healthCheckInterval: NodeJS.Timeout | null;
  private statementCache: Map<string, boolean>;

  constructor(config: DatabaseConfig | EnhancedPoolConfig) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config } as EnhancedPoolConfig;

    const poolConfig: PoolConfig = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      ssl: this.buildSSLConfig(this.config.ssl),
      connectionTimeoutMillis: this.config.connectionTimeoutMs || 10000,
      idleTimeoutMillis: this.config.idleTimeoutMs || 30000,
      min: this.config.min || 2,
      max: this.config.max || 10,
    };

    this.pool = new Pool(poolConfig);
    this.healthCheckInterval = null;
    this.statementCache = new Map();

    // Initialize stats
    this.stats = {
      totalQueries: 0,
      totalQueryTimeMs: 0,
      connectionErrors: 0,
      startTime: Date.now(),
    };

    // Set up pool event listeners
    this.pool.on('error', (err) => {
      console.error('Unexpected pool error:', err);
      this.stats.connectionErrors++;
    });

    this.pool.on('connect', () => {
      // Connection established
    });

    // Start health checks if enabled
    if (this.config.healthCheckEnabled) {
      this.startHealthChecks();
    }
  }

  /**
   * Execute a query with timing and stats tracking
   */
  async query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
    const startTime = Date.now();
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      this.stats.totalQueries++;
      this.stats.totalQueryTimeMs += Date.now() - startTime;
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a query within a transaction
   */
  async queryInTransaction<T = unknown>(
    queries: Array<{ text: string; params?: unknown[] }>
  ): Promise<T[][]> {
    const client = await this.pool.connect();
    const results: T[][] = [];

    try {
      await client.query('BEGIN');

      for (const query of queries) {
        const startTime = Date.now();
        const result = await client.query(query.text, query.params);
        results.push(result.rows);
        this.stats.totalQueries++;
        this.stats.totalQueryTimeMs += Date.now() - startTime;
      }

      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get a client for manual transaction control
   */
  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Execute a batch of queries in parallel (where order doesn't matter)
   */
  async queryBatch<T = unknown>(
    queries: Array<{ text: string; params?: unknown[] }>
  ): Promise<T[][]> {
    const promises = queries.map(async (query) => {
      const startTime = Date.now();
      const result = await this.query<T>(query.text, query.params);
      this.stats.totalQueryTimeMs += Date.now() - startTime;
      return result;
    });

    return Promise.all(promises);
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch (error) {
      console.error('Database connection test failed:', error);
      this.stats.connectionErrors++;
      return false;
    }
  }

  /**
   * Get current pool statistics
   */
  getPoolStats(): PoolStats {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      active: this.pool.totalCount - this.pool.idleCount,
      totalQueries: this.stats.totalQueries,
      avgQueryTimeMs:
        this.stats.totalQueries > 0
          ? this.stats.totalQueryTimeMs / this.stats.totalQueries
          : 0,
      connectionErrors: this.stats.connectionErrors,
      uptimeMs: Date.now() - this.stats.startTime,
    };
  }

  /**
   * Get the raw pool (for advanced use cases)
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * Warm up the connection pool by creating minimum connections
   */
  async warmUp(): Promise<void> {
    const minConnections = this.config.min || 2;
    const clients: PoolClient[] = [];

    try {
      // Acquire minimum connections
      for (let i = 0; i < minConnections; i++) {
        clients.push(await this.pool.connect());
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
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    if (this.healthCheckInterval) {
      return;
    }

    const intervalMs = this.config.healthCheckIntervalMs || 30000;

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.query('SELECT 1');
      } catch {
        // Silently track connection errors - don't spam console
        this.stats.connectionErrors++;
      }
    }, intervalMs);
  }

  /**
   * Stop health checks
   */
  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Build secure SSL configuration from config options
   *
   * SECURITY: By default, certificate verification is ENABLED.
   * Only disable rejectUnauthorized for development/testing with explicit config.
   */
  private buildSSLConfig(
    sslConfig: boolean | SSLConfig | undefined
  ): boolean | tls.ConnectionOptions {
    // If SSL is explicitly disabled
    if (sslConfig === false) {
      return false;
    }

    // If SSL is not configured, default based on environment
    if (sslConfig === undefined) {
      // Enable SSL with certificate verification in production
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
    // Only set false if explicitly configured (for development only)
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
        console.error(
          `Failed to load CA certificate from ${sslConfig.ca}:`,
          error
        );
        throw new Error(
          `Failed to load CA certificate: ${(error as Error).message}`
        );
      }
    }

    // Load client certificate if provided
    if (sslConfig.cert) {
      try {
        tlsOptions.cert = fs.readFileSync(sslConfig.cert);
      } catch (error) {
        console.error(
          `Failed to load client certificate from ${sslConfig.cert}:`,
          error
        );
        throw new Error(
          `Failed to load client certificate: ${(error as Error).message}`
        );
      }
    }

    // Load client key if provided
    if (sslConfig.key) {
      try {
        tlsOptions.key = fs.readFileSync(sslConfig.key);
      } catch (error) {
        console.error(
          `Failed to load client key from ${sslConfig.key}:`,
          error
        );
        throw new Error(
          `Failed to load client key: ${(error as Error).message}`
        );
      }
    }

    // Set server name for SNI
    if (sslConfig.serverName) {
      tlsOptions.servername = sslConfig.serverName;
    }

    return tlsOptions;
  }

  /**
   * Resize the pool dynamically
   */
  async resizePool(newMax: number): Promise<void> {
    // Note: pg pool doesn't support dynamic resizing
    // This would require recreating the pool
    console.warn(
      `Pool resizing to ${newMax} requested. ` +
        'Dynamic pool resizing is not supported - restart with new config.'
    );
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    this.stopHealthChecks();
    await this.pool.end();
  }

  /**
   * Get the database configuration (without password)
   */
  getConfig(): Omit<EnhancedPoolConfig, 'password'> {
    // Destructure to exclude password from returned config (security pattern)
    const { password: _excluded, ...configWithoutPassword } = this.config;
    return configWithoutPassword;
  }

  /**
   * Get connection string (for debugging, masks password)
   */
  getConnectionString(): string {
    return `postgresql://${this.config.username}:***@${this.config.host}:${this.config.port}/${this.config.database}`;
  }
}

/**
 * Create a database connection with optimized pool settings
 */
export function createOptimizedConnection(
  config: DatabaseConfig,
  options: {
    forMigration?: boolean;
    maxParallelTables?: number;
  } = {}
): DatabaseConnection {
  const { forMigration = false, maxParallelTables = 4 } = options;

  // Calculate optimal pool size based on use case
  let maxConnections = config.max || 10;

  if (forMigration) {
    // For migration, we need more connections for parallel table operations
    // But not too many to overwhelm the database
    maxConnections = Math.min(
      Math.max(maxParallelTables * 2, 10),
      50 // Hard upper limit
    );
  }

  const enhancedConfig: EnhancedPoolConfig = {
    ...config,
    min: Math.min(2, maxConnections),
    max: maxConnections,
    acquireTimeoutMs: forMigration ? 60000 : 30000, // Longer timeout for migrations
    idleTimeoutMs: forMigration ? 60000 : 30000,
    connectionTimeoutMs: 10000,
    statementCaching: true,
    healthCheckEnabled: true,
    healthCheckIntervalMs: forMigration ? 60000 : 30000,
  };

  return new DatabaseConnection(enhancedConfig);
}
