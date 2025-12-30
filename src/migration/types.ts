/**
 * Migration Types
 *
 * Type definitions specific to the data migration process.
 * Core shared types are imported from ../shared/types.js
 */

import type { TableInfo } from '../introspector/schema-introspector.js';

// Re-export all shared types for convenience
export type {
  PostgresId,
  ConvexId,
  IdMapping,
  TableMigrationStatus,
  MigrationPhase,
  MigrationErrorCode,
  MigrationError,
  MigrationEventType,
  MigrationEvent,
  MigrationEventHandler,
  DependencyNode,
  CircularDependency,
  DependencyResolutionResult,
  IIdMapper,
  IConvexClient,
  TableProgress,
  MigrationStats,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  MigrationReport,
  TableMigrationSummary,
  LogLevel,
  ProgressStats,
  PostgresRow,
  ConvexDocument,
  TokenBucket,
  Checkpoint,
} from '../shared/types.js';

export {
  JS_RESERVED_WORDS,
  CONVEX_RESERVED_FIELDS,
  isReservedWord,
  escapeFieldName,
  escapeString,
  toCamelCase,
  toPascalCase,
  isValidIdentifier,
  toValidIdentifier,
} from '../shared/types.js';

// Import types we need for local interfaces
import type {
  PostgresId,
  ConvexId,
  MigrationError,
  MigrationStats,
  TableProgress,
  IIdMapper,
  PostgresRow,
  ConvexDocument,
  ValidationResult,
} from '../shared/types.js';

// ============================================================================
// Migration-Specific Types (not shared)
// ============================================================================

/**
 * Overall migration state (persisted to disk)
 */
export interface MigrationState {
  /** Unique migration run identifier */
  migrationId: string;
  /** When the migration started */
  startedAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** When the migration completed (if finished) */
  completedAt?: Date;
  /** Overall status */
  status: 'running' | 'completed' | 'failed' | 'paused';
  /** Per-table progress */
  tables: Map<string, TableProgress>;
  /** ID mappings for foreign key resolution */
  idMappings: Map<string, Map<PostgresId, ConvexId>>;
  /** Tables in dependency order */
  migrationOrder: string[];
  /** Current table being processed */
  currentTable?: string;
  /** Error message if failed */
  error?: string;
  /** Statistics */
  stats: MigrationStats;
}

/**
 * Configuration for the migration engine
 */
export interface MigrationConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Convex deployment URL */
  convexUrl: string;
  /** Convex deploy key */
  convexDeployKey: string;
  /** Output directory for state files */
  stateDir: string;
  /** Batch size for inserts */
  batchSize: number;
  /** Maximum retries per batch */
  maxRetries: number;
  /** Retry delay in ms (base for exponential backoff) */
  retryDelayMs: number;
  /** Maximum concurrent operations */
  concurrency: number;
  /** Rate limit (requests per second) */
  rateLimit: number;
  /** Enable dry run mode */
  dryRun: boolean;
  /** Tables to include (empty = all) */
  includeTables: string[];
  /** Tables to exclude */
  excludeTables: string[];
  /** Whether to continue from previous state */
  resume: boolean;
  /** Whether to truncate existing Convex data */
  truncateExisting: boolean;
  /** Log level */
  logLevel: 'quiet' | 'normal' | 'verbose';
  /** Parallel migration config (partial - missing fields use defaults) */
  parallel?: Partial<ParallelMigrationConfig>;
  /** 110% ENHANCEMENTS */
  /** Pre/post migration hooks */
  hooks?: import('./hooks.js').MigrationHooks;
  /** Slack notification configuration */
  slackNotifications?: import('./notifications.js').SlackNotificationConfig;
  /** Memory monitoring configuration */
  memoryMonitoring?: Partial<import('./memory-monitor.js').MemoryMonitorConfig>;
  /** Auto-enable streaming mode for large tables (default: 100000 rows) */
  autoStreamingThreshold?: number;
  /** Data masking configuration */
  dataMasking?: import('./data-masking.js').DataMaskingConfig;
  /** Timestamp-based incremental sync */
  incrementalSync?: {
    enabled: boolean;
    timestampColumn: string;
    lastSyncTime?: Date;
  };
  /** Circuit breaker configuration */
  circuitBreaker?: {
    enabled: boolean;
    failureThreshold: number;
    resetTimeoutMs: number;
  };
}

/**
 * Default migration configuration
 */
export const DEFAULT_MIGRATION_CONFIG: Readonly<Partial<MigrationConfig>> =
  Object.freeze({
    stateDir: './.migration',
    batchSize: 100,
    maxRetries: 3,
    retryDelayMs: 1000,
    concurrency: 5,
    rateLimit: 100,
    dryRun: false,
    includeTables: [],
    excludeTables: [],
    resume: false,
    truncateExisting: false,
    logLevel: 'normal',
  });

/**
 * Options for table migration
 */
export interface TableMigrationOptions {
  /** Batch size for this table */
  batchSize?: number;
  /** Custom transform function */
  transform?: RowTransformFn;
  /** Fields to skip */
  skipFields?: string[];
  /** Field name mappings (postgres -> convex) */
  fieldMappings?: Record<string, string>;
  /** Primary key field name */
  primaryKey?: string;
  /** Cursor field for pagination */
  cursorField?: string;
  /** Checkpoint callback - called periodically for resumability */
  checkpointCallback?: (tableName: string, batchNumber: number) => void;
  /** Custom row validation function - return false to skip row */
  validateRow?: (row: Record<string, unknown>) => boolean;
  /** Custom error handler for individual row failures */
  onRowError?: (row: Record<string, unknown>, error: Error) => void;
}

/**
 * Custom row transformation function
 */
export type RowTransformFn = (
  row: PostgresRow,
  table: TableInfo,
  idMapper: IIdMapper
) => ConvexDocument | null;

/**
 * Interface for state persistence
 */
export interface IStateManager {
  /** Save current state */
  save(state: MigrationState): Promise<void>;
  /** Load existing state */
  load(migrationId?: string): Promise<MigrationState | null>;
  /** Get latest migration ID */
  getLatestMigrationId(): Promise<string | null>;
  /** Check if migration exists */
  exists(migrationId: string): Promise<boolean>;
  /** Delete migration state */
  delete(migrationId: string): Promise<void>;
  /** List all migrations */
  list(): Promise<string[]>;
}

/**
 * Batch insert result with proper row tracking
 */
export interface BatchInsertResult {
  success: boolean;
  /** All inserted IDs (for batch inserts, indices match input order) */
  insertedIds: ConvexId[];
  /** Map of original row index -> Convex ID (handles partial failures) */
  insertedIdsByIndex: Map<number, ConvexId>;
  /** Indices of rows that failed */
  failedRows: number[];
  errors: MigrationError[];
}

// ============================================================================
// Multi-Schema Types
// ============================================================================

/**
 * Configuration for multi-schema migration
 */
export interface MultiSchemaConfig {
  /** Schemas to include (empty = all non-system schemas) */
  schemas: string[];
  /** Whether to prefix table names with schema name */
  prefixTableNames: boolean;
  /** Separator for schema-qualified names (default: '__') */
  schemaSeparator: string;
  /** How to handle cross-schema foreign keys */
  crossSchemaFkHandling: 'resolve' | 'ignore' | 'error';
}

/**
 * Default multi-schema configuration
 */
export const DEFAULT_MULTI_SCHEMA_CONFIG: Readonly<MultiSchemaConfig> =
  Object.freeze({
    schemas: ['public'],
    prefixTableNames: false,
    schemaSeparator: '__',
    crossSchemaFkHandling: 'resolve',
  });

/**
 * Schema-qualified table reference
 */
export interface SchemaQualifiedTable {
  schemaName: string;
  tableName: string;
  /** Full qualified name (schema.table or schema__table for Convex) */
  qualifiedName: string;
  /** Convex-safe table name */
  convexTableName: string;
}

/**
 * Cross-schema foreign key reference
 */
export interface CrossSchemaForeignKey {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  constraintName: string;
}

// ============================================================================
// Rollback Types
// ============================================================================

/**
 * Configuration for rollback capability
 */
export interface RollbackConfig {
  /** Enable rollback capability */
  enabled: boolean;
  /** Maximum rows to track per table (0 = unlimited, but may use lots of memory) */
  maxRowsPerTable: number;
  /** Auto-save interval for rollback state (ms) */
  autoSaveIntervalMs: number;
  /** Whether to track pre-existing Convex documents */
  trackExistingDocuments: boolean;
}

/**
 * Default rollback configuration
 */
export const DEFAULT_ROLLBACK_CONFIG: Readonly<RollbackConfig> = Object.freeze({
  enabled: true,
  maxRowsPerTable: 100000,
  autoSaveIntervalMs: 10000,
  trackExistingDocuments: false,
});

// ============================================================================
// Parallel Migration Types
// ============================================================================

/**
 * Configuration for parallel migration
 */
export interface ParallelMigrationConfig {
  /** Enable parallel migration */
  enabled: boolean;
  /** Maximum number of tables to migrate in parallel */
  maxParallelTables: number;
  /** Whether to auto-detect optimal parallelism */
  autoOptimize: boolean;
  /** Data masker instance (110% enhancement) */
  dataMasker?: import('./data-masking.js').DataMasker;
  /** Auto-streaming threshold for large tables */
  autoStreamingThreshold?: number;
  /** Batch size for migrations */
  batchSize?: number;
  /** Maximum retries per batch */
  maxRetries?: number;
  /** Retry delay in ms */
  retryDelayMs?: number;
  /** Rate limit (requests per second) */
  rateLimit?: number;
  /** Dry run mode */
  dryRun?: boolean;
}

/**
 * Default parallel migration configuration
 */
export const DEFAULT_PARALLEL_CONFIG: Readonly<ParallelMigrationConfig> =
  Object.freeze({
    enabled: true,
    maxParallelTables: 4,
    autoOptimize: true,
  });

// ============================================================================
// Connection Pool Types
// ============================================================================

/**
 * Enhanced connection pool configuration
 */
export interface ConnectionPoolConfig {
  /** Minimum pool size */
  min: number;
  /** Maximum pool size */
  max: number;
  /** Acquire timeout in ms */
  acquireTimeoutMs: number;
  /** Idle timeout in ms (connections idle longer than this are closed) */
  idleTimeoutMs: number;
  /** Connection timeout in ms */
  connectionTimeoutMs: number;
  /** Reap interval for checking idle connections (ms) */
  reapIntervalMs: number;
  /** Whether to enable statement caching */
  statementCaching: boolean;
  /** Max cached statements per connection */
  maxCachedStatements: number;
}

/**
 * Default connection pool configuration
 */
export const DEFAULT_POOL_CONFIG: Readonly<ConnectionPoolConfig> =
  Object.freeze({
    min: 2,
    max: 10,
    acquireTimeoutMs: 30000,
    idleTimeoutMs: 30000,
    connectionTimeoutMs: 10000,
    reapIntervalMs: 1000,
    statementCaching: true,
    maxCachedStatements: 100,
  });

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
  /** Active connections */
  active: number;
  /** Total queries executed */
  totalQueries: number;
  /** Average query time (ms) */
  avgQueryTimeMs: number;
}

// ============================================================================
// Dry Run Types
// ============================================================================

/**
 * Enhanced dry run result
 */
export interface DryRunResult {
  /** Would the migration succeed? */
  wouldSucceed: boolean;
  /** Validation results */
  validation: ValidationResult;
  /** Tables that would be migrated */
  tables: DryRunTableResult[];
  /** Total rows that would be migrated */
  totalRows: number;
  /** Estimated duration in seconds */
  estimatedDurationSec: number;
  /** Schema changes preview */
  schemaChanges: SchemaChangePreview[];
  /** Dependency order */
  migrationOrder: string[];
  /** Parallel execution plan */
  parallelPlan?: {
    phases: number;
    tablesPerPhase: number[];
    estimatedSpeedup: number;
  };
}

/**
 * Per-table dry run result
 */
export interface DryRunTableResult {
  tableName: string;
  schemaName: string;
  rowCount: number;
  columnCount: number;
  hasForeignKeys: boolean;
  foreignKeyDependencies: string[];
  warnings: string[];
  /** Sample transformed rows (first 5) */
  sampleData?: Array<{
    original: Record<string, unknown>;
    transformed: Record<string, unknown>;
  }>;
}

/**
 * Schema change preview
 */
export interface SchemaChangePreview {
  tableName: string;
  changeType: 'create' | 'modify' | 'none';
  fieldsAdded: string[];
  fieldsModified: string[];
  typeChanges: Array<{
    field: string;
    fromType: string;
    toType: string;
  }>;
}

// ============================================================================
// Table Migration Result Types
// ============================================================================

/**
 * Metrics collected during table migration
 */
export interface TableMigrationMetrics {
  /** Average rows processed per second */
  avgRowsPerSecond: number;
  /** Peak memory usage in MB */
  peakMemoryMB: number;
  /** Total batches processed */
  totalBatches: number;
  /** Batches that required retry */
  retriedBatches: number;
}

/**
 * Migration result for a single table
 */
export interface TableMigrationResult {
  tableName: string;
  success: boolean;
  totalRows: number;
  migratedRows: number;
  failedRows: number;
  skippedRows: number;
  duration: number;
  errors: MigrationError[];
  metrics: TableMigrationMetrics;
}

/**
 * Aggregated metrics across multiple tables (for parallel migration)
 */
export interface AggregatedMigrationMetrics {
  /** Weighted average rows per second (weighted by migratedRows per table) */
  avgRowsPerSecond: number;
  /** Peak memory usage across all tables (MB) */
  peakMemoryMB: number;
  /** Total batches processed across all tables */
  totalBatches: number;
  /** Total batches that required retry */
  retriedBatches: number;
  /** Per-table metrics breakdown */
  byTable: Map<string, TableMigrationMetrics>;
}
