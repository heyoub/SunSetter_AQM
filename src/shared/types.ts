/**
 * Shared Type Definitions
 *
 * This module contains all shared types used across the migration tool.
 * Types are defined once here to prevent duplication and inconsistency.
 */

// ============================================================================
// Core ID Types
// ============================================================================

/**
 * PostgreSQL primary key value (can be number, string, uuid, etc.)
 */
export type PostgresId = string | number;

/**
 * Convex document ID (always a string in the format Id<"tableName">)
 */
export type ConvexId = string;

/**
 * Mapping from PostgreSQL ID to Convex ID for a single record
 */
export interface IdMapping {
  postgresId: PostgresId;
  convexId: ConvexId;
  tableName: string;
  createdAt?: Date;
}

// ============================================================================
// Migration Status Types
// ============================================================================

/**
 * Migration status for a single table
 */
export type TableMigrationStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

/**
 * Overall migration phase
 */
export type MigrationPhase =
  | 'not_started'
  | 'analyzing'
  | 'migrating'
  | 'completed'
  | 'failed'
  | 'paused';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Unified error codes for migration errors
 */
export type MigrationErrorCode =
  // Connection errors
  | 'CONNECTION_ERROR'
  | 'POSTGRES_CONNECTION_ERROR'
  // Query/data errors
  | 'QUERY_ERROR'
  | 'TRANSFORM_ERROR'
  | 'VALIDATION_ERROR'
  // Convex-specific errors
  | 'CONVEX_ERROR'
  | 'CONVEX_RATE_LIMIT'
  | 'RATE_LIMIT_ERROR'
  | 'CONVEX_PAYLOAD_TOO_LARGE'
  | 'CONVEX_VALIDATION_ERROR'
  | 'INSERT_ERROR'
  // Mapping/resolution errors
  | 'ID_MAPPING_ERROR'
  | 'FK_RESOLUTION_ERROR'
  // Structural errors
  | 'DEPENDENCY_CYCLE'
  | 'DEPENDENCY_ERROR'
  // State errors
  | 'STATE_ERROR'
  | 'TIMEOUT_ERROR'
  // File system errors
  | 'FILE_SYSTEM_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'GENERATION_ERROR'
  | 'INTROSPECTION_ERROR'
  // Catch-all
  | 'UNKNOWN_ERROR';

/**
 * Unified migration error structure
 */
export interface MigrationError {
  /** Error code for categorization */
  code: MigrationErrorCode;
  /** Human-readable error message */
  message: string;
  /** Table where error occurred (if applicable) */
  table?: string;
  /** Row ID where error occurred - the PostgreSQL primary key (if applicable) */
  rowId?: PostgresId;
  /** Row index in the current batch (if applicable) */
  row?: number;
  /** Batch number (if applicable) */
  batch?: number;
  /** Field name (if applicable) */
  field?: string;
  /** When the error occurred */
  timestamp?: Date;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Original error object */
  originalError?: Error;
  /** Whether this error is retryable */
  retryable: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Migration event types - unified naming convention
 */
export type MigrationEventType =
  | 'migration:start'
  | 'migration:complete'
  | 'migration:error'
  | 'migration:pause'
  | 'migration:resume'
  | 'table:start'
  | 'table:complete'
  | 'table:error'
  | 'table:skip'
  | 'batch:start'
  | 'batch:complete'
  | 'batch:error'
  | 'row:success'
  | 'row:error'
  | 'row:skip'
  | 'warning';

/**
 * Migration event payload
 */
export interface MigrationEvent {
  type: MigrationEventType;
  timestamp: Date;
  migrationId: string;
  table?: string;
  batch?: number;
  row?: number;
  data?: Record<string, unknown>;
  error?: MigrationError;
}

/**
 * Migration event handler
 */
export type MigrationEventHandler = (
  event: MigrationEvent
) => void | Promise<void>;

// ============================================================================
// Dependency Graph Types
// ============================================================================

/**
 * Dependency information for topological sorting
 */
export interface DependencyNode {
  tableName: string;
  /** Tables this table depends on (FKs pointing to) */
  dependencies: string[];
  /** Tables that depend on this table */
  dependents: string[];
}

/**
 * Dependency graph structure
 */
export interface DependencyGraph {
  /** All nodes in the graph */
  nodes: Map<string, DependencyNode>;
  /** Whether the graph contains cycles */
  hasCycle: boolean;
  /** Details about detected cycles */
  cycleDetails: string[] | null;
}

/**
 * Result of dependency resolution (used by RelationshipAnalyzer for schema generation)
 */
export interface ResolutionResult {
  /** Whether resolution was successful */
  success: boolean;
  /** Tables in topological order (dependencies first) */
  orderedTables: string[];
  /** Groups of tables with circular dependencies */
  circularDependencies: string[][];
  /** Warning messages */
  warnings: string[];
}

/**
 * Circular dependency information
 */
export interface CircularDependency {
  tables: string[];
  path: string[];
}

/**
 * Result of dependency resolution
 */
export interface DependencyResolutionResult {
  /** Tables in migration order (respects FK dependencies) */
  order: string[];
  /** Any circular dependencies found */
  circularDeps: CircularDependency[];
  /** Dependency graph */
  graph: Map<string, DependencyNode>;
  /** Tables with no dependencies */
  roots: string[];
  /** Tables with no dependents */
  leaves: string[];
}

// ============================================================================
// Interface Definitions
// ============================================================================

/**
 * Unified ID mapper interface
 */
export interface IIdMapper {
  /** Register a new ID mapping */
  set(tableName: string, postgresId: PostgresId, convexId: ConvexId): void;

  /** Get Convex ID for a PostgreSQL ID (returns undefined if not found) */
  get(tableName: string, postgresId: PostgresId): ConvexId | undefined;

  /** Check if mapping exists */
  has(tableName: string, postgresId: PostgresId): boolean;

  /** Get all mappings for a table */
  getTableMappings(tableName: string): Map<PostgresId, ConvexId>;

  /** Get total mapping count */
  count(): number;

  /** Get mapping count for a specific table */
  countForTable(tableName: string): number;

  /** Try to resolve a foreign key, returns undefined if not found, null if input is null */
  tryResolveForeignKey(
    tableName: string,
    postgresId: PostgresId | null | undefined
  ): ConvexId | null | undefined;

  /** Serialize to JSON */
  toJSON(): Record<string, Record<string, string>>;

  /** Load from JSON */
  fromJSON(data: Record<string, Record<string, string>>): void;

  /** Clear all mappings */
  clear(): void;
}

/**
 * Convex HTTP client interface
 */
export interface IConvexClient {
  /** Insert a single document */
  insert(
    tableName: string,
    document: Record<string, unknown>
  ): Promise<ConvexId>;

  /** Insert multiple documents */
  batchInsert(
    tableName: string,
    documents: Record<string, unknown>[]
  ): Promise<ConvexId[]>;

  /** Delete a single document by ID */
  delete(tableName: string, documentId: ConvexId): Promise<void>;

  /** Delete multiple documents by ID */
  batchDelete(tableName: string, documentIds: ConvexId[]): Promise<number>;

  /** Delete all documents in a table (calls batchDelete in chunks) */
  truncateTable(tableName: string): Promise<number>;

  /** Count documents in a table */
  countDocuments(tableName: string): Promise<number>;

  /** Check connection */
  healthCheck(): Promise<boolean>;
}

// ============================================================================
// Progress & Statistics Types
// ============================================================================

/**
 * Progress information for a single table
 */
export interface TableProgress {
  tableName: string;
  status: TableMigrationStatus;
  totalRows: number;
  migratedRows: number;
  failedRows: number;
  skippedRows?: number;
  lastProcessedId?: PostgresId;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  retryCount: number;
}

/**
 * Migration statistics
 */
export interface MigrationStats {
  totalTables: number;
  completedTables: number;
  totalRows: number;
  migratedRows: number;
  failedRows: number;
  skippedRows: number;
  startTime: number;
  endTime?: number;
  avgRowsPerSecond: number;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Validation result for pre-migration checks
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Validation error
 */
export interface ValidationError {
  table: string;
  field?: string;
  message: string;
  severity: 'error';
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  table: string;
  field?: string;
  message: string;
  severity: 'warning';
}

// ============================================================================
// Report Types
// ============================================================================

/**
 * Summary report after migration
 */
export interface MigrationReport {
  migrationId: string;
  status: 'completed' | 'failed' | 'partial';
  startTime: Date;
  endTime: Date;
  duration: number;
  tables: TableMigrationSummary[];
  totalRows: number;
  /** Number of rows successfully migrated to Convex */
  migratedRows: number;
  failedRows: number;
  skippedRows: number;
  errors: MigrationError[];
  warnings: string[];
}

/**
 * Per-table summary in migration report
 */
export interface TableMigrationSummary {
  tableName: string;
  status: TableMigrationStatus;
  totalRows: number;
  /** Number of rows successfully migrated to Convex */
  migratedRows: number;
  failedRows: number;
  skippedRows: number;
  duration: number;
  errors: MigrationError[];
}

// ============================================================================
// CLI Types
// ============================================================================

/**
 * CLI log levels
 */
export type LogLevel = 'quiet' | 'normal' | 'verbose';

/**
 * Progress statistics for CLI display
 */
export interface ProgressStats {
  tables: { total: number; completed: number };
  files: { total: number; completed: number };
  startTime: number;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Row data from PostgreSQL (before transformation)
 */
export type PostgresRow = Record<string, unknown>;

/**
 * Document data for Convex (after transformation)
 */
export type ConvexDocument = Record<string, unknown>;

/**
 * Token bucket for rate limiting
 */
export interface TokenBucket {
  tokens: number;
  maxTokens: number;
  refillRate: number;
  lastRefill: number;
}

/**
 * Checkpoint data for resumable migrations
 */
export interface Checkpoint {
  migrationId: string;
  tableName: string;
  lastProcessedId?: PostgresId;
  processedCount: number;
  timestamp: Date;
}

// ============================================================================
// Reserved Words & Validation
// ============================================================================

/**
 * JavaScript/TypeScript reserved words that need escaping
 */
export const JS_RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'finally',
  'for',
  'function',
  'if',
  'in',
  'instanceof',
  'new',
  'return',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'class',
  'const',
  'enum',
  'export',
  'extends',
  'import',
  'super',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'yield',
  'await',
  'async',
]);

/**
 * Convex reserved field names
 */
export const CONVEX_RESERVED_FIELDS = new Set(['_id', '_creationTime']);

/**
 * Check if a name is a reserved word
 */
export function isReservedWord(name: string): boolean {
  return JS_RESERVED_WORDS.has(name) || CONVEX_RESERVED_FIELDS.has(name);
}

/**
 * Escape a field name if it's reserved
 */
export function escapeFieldName(name: string): string {
  if (isReservedWord(name)) {
    return `${name}_`;
  }
  return name;
}

/**
 * Escape a string for use in generated code
 */
export function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// ============================================================================
// Name Conversion Utilities
// ============================================================================

/**
 * Convert snake_case to camelCase (handles edge cases)
 */
export function toCamelCase(str: string): string {
  // Handle leading underscores
  const leadingUnderscores = str.match(/^_+/)?.[0] || '';
  const rest = str.slice(leadingUnderscores.length);

  // Convert snake_case to camelCase
  const camelCase = rest
    .toLowerCase()
    .replace(/_+([a-z0-9])/g, (_, char) => char.toUpperCase());

  return leadingUnderscores + camelCase;
}

/**
 * Convert snake_case to PascalCase
 */
export function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Check if a string is a valid JavaScript identifier
 */
export function isValidIdentifier(str: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(str);
}

/**
 * Make a string a valid identifier
 */
export function toValidIdentifier(str: string): string {
  // Replace invalid characters
  let result = str.replace(/[^a-zA-Z0-9_$]/g, '_');

  // Ensure doesn't start with a number
  if (/^[0-9]/.test(result)) {
    result = '_' + result;
  }

  // Escape if reserved
  return escapeFieldName(result);
}
