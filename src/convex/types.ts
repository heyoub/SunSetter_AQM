/**
 * Convex Migration Tool - Core Type Definitions
 *
 * This module contains type definitions for:
 * - Schema translation (PostgreSQL -> Convex)
 * - Relationship analysis
 * - Code generation
 *
 * Shared types are imported from ../shared/types.js
 */

import type {
  ColumnInfo,
  TableInfo,
  ForeignKeyInfo,
  IndexInfo,
  IndexColumnInfo,
  CheckConstraintInfo,
  DomainInfo,
  SchemaInfo,
} from '../introspector/schema-introspector.js';

// Re-export introspector types for convenience
export type {
  ColumnInfo,
  TableInfo,
  ForeignKeyInfo,
  IndexInfo,
  IndexColumnInfo,
  CheckConstraintInfo,
  DomainInfo,
  SchemaInfo,
};

// Re-export shared types that are commonly needed
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
  DependencyGraph,
  ResolutionResult,
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
import type { IIdMapper } from '../shared/types.js';

// ============================================================================
// Convex Type Mapping
// ============================================================================

/**
 * Convex validator types - the complete set of Convex validators
 * Updated for Convex 1.29.0+ which added v.nullable()
 */
export type ConvexValidatorType =
  | 'v.string()'
  | 'v.number()'
  | 'v.float64()'
  | 'v.int64()'
  | 'v.boolean()'
  | 'v.bytes()'
  | 'v.null()'
  | 'v.any()'
  | `v.id("${string}")`
  | `v.array(${string})`
  | `v.object(${string})`
  | `v.union(${string})`
  | `v.literal(${string})`
  | `v.record(${string}, ${string})`
  | `v.optional(${string})`
  | `v.nullable(${string})`;

/**
 * Mapped Convex field with full metadata
 */
export interface ConvexFieldMapping {
  /** camelCase field name for Convex */
  fieldName: string;
  /** Original snake_case PostgreSQL column name */
  originalColumnName: string;
  /** Full validator expression (e.g., "v.optional(v.string())") */
  validator: string;
  /** Whether the field is optional */
  isOptional: boolean;
  /** Whether this field is a reference to another table */
  isId: boolean;
  /** For v.id() references, the referenced table name */
  referencedTable?: string;
  /** Column comment/documentation */
  comment?: string;
  /** Original PostgreSQL data type */
  originalPgType: string;
}

/**
 * Convex index definition
 */
export interface ConvexIndexDefinition {
  /** Index name (e.g., "by_userId") */
  indexName: string;
  /** Fields included in the index (camelCase) */
  fields: string[];
  /** Whether this is a unique index */
  isUnique: boolean;
  /** Original PostgreSQL index name */
  originalIndexName: string;
  /** Whether to use staged deployment for large tables (Convex feature) */
  staged?: boolean;
}

/**
 * Convex search index definition for full-text search
 */
export interface ConvexSearchIndexDefinition {
  /** Search index name (e.g., "search_title") */
  indexName: string;
  /** The main field to search */
  searchField: string;
  /** Additional fields that can be used for filtering */
  filterFields: string[];
}

/**
 * Convex vector index definition for vector similarity search
 */
export interface ConvexVectorIndexDefinition {
  /** Vector index name (e.g., "vector_embedding") */
  indexName: string;
  /** The field containing the vector/embedding */
  vectorField: string;
  /** Number of dimensions in the vector */
  dimensions: number;
  /** Fields that can be used for filtering */
  filterFields: string[];
}

/**
 * Complete Convex table definition
 */
export interface ConvexTableDefinition {
  /** Table name (snake_case, Convex convention) */
  tableName: string;
  /** All field mappings */
  fields: ConvexFieldMapping[];
  /** Index definitions */
  indexes: ConvexIndexDefinition[];
  /** Search index definitions for full-text search */
  searchIndexes?: ConvexSearchIndexDefinition[];
  /** Vector index definitions for similarity search */
  vectorIndexes?: ConvexVectorIndexDefinition[];
  /** Relationships this table participates in */
  relationships: DetectedRelationship[];
  /** Original PostgreSQL table name */
  originalTableName: string;
  /** Original PostgreSQL schema name */
  schemaName: string;
  /** Table comment/documentation */
  comment?: string;
}

/**
 * Complete schema ready for Convex generation
 */
export interface ConvexSchemaDefinition {
  /** All table definitions */
  tables: ConvexTableDefinition[];
  /** Tables identified as M:N junction tables */
  junctionTables: string[];
  /** When the schema was generated */
  generatedAt: Date;
  /** Source database type */
  sourceDatabase: string;
  /** Source schema name */
  sourceSchema: string;
}

// ============================================================================
// Relationship Analysis
// ============================================================================

/**
 * Relationship cardinality types
 */
export type RelationshipCardinality =
  | 'one-to-one'
  | 'one-to-many'
  | 'many-to-one'
  | 'many-to-many';

/**
 * Detected relationship between tables
 */
export interface DetectedRelationship {
  /** Source table name */
  sourceTable: string;
  /** Source column name */
  sourceColumn: string;
  /** Target/referenced table name */
  targetTable: string;
  /** Target/referenced column name */
  targetColumn: string;
  /** Detected cardinality */
  cardinality: RelationshipCardinality;
  /** Original constraint name */
  constraintName: string;
  /** For M:N relationships, the junction table name */
  junctionTable?: string;
}

// ============================================================================
// Type Mapper Options
// ============================================================================

/**
 * Convex API version for generated code compatibility
 */
export type ConvexApiVersion = '1.30' | '1.31';

/**
 * Options for the Convex type mapper
 */
export interface ConvexTypeMapperOptions {
  /** Use v.int64() for bigint (default: false, uses v.number()) */
  useBigInt64: boolean;
  /** Use v.float64() for floats (default: false, uses v.number()) */
  useFloat64: boolean;
  /** Treat JSON/JSONB as v.any() vs v.object() (default: true = v.any()) */
  jsonAsAny: boolean;
  /** How to handle arrays (default: 'typed') */
  arrayHandling: 'typed' | 'any';
  /** How to handle unknown/unsupported types */
  unknownTypeHandling: 'string' | 'any' | 'error';
  /** Custom type overrides: pgType -> validator */
  customTypeMappings: Record<string, string>;
  /** Whether to preserve PostgreSQL column comments */
  preserveComments: boolean;
  /** Custom enum mappings: enumTypeName -> validator expression */
  enumMappings: Record<string, string>;
  /** Optional table name transformer for FK references (must match schema generator) */
  tableNameTransformer?: (name: string) => string;
  /**
   * Use v.nullable() instead of v.optional() for nullable columns
   * Requires Convex 1.29.0+
   * v.nullable() allows explicit null values, v.optional() allows missing fields
   * (default: false, uses v.optional())
   */
  useNullable?: boolean;
}

/**
 * Options for the relationship analyzer
 */
export interface RelationshipAnalyzerOptions {
  /** Patterns to detect junction tables (default: ['_to_', '_has_', '_rel_']) */
  junctionTablePatterns: string[];
  /** Minimum FK count to consider as junction table (default: 2) */
  minFKsForJunction: number;
  /** Maximum non-FK columns for junction table (default: 3) */
  maxNonFKColumnsForJunction: number;
}

/**
 * Options for schema generation
 */
export interface ConvexSchemaGeneratorOptions {
  /** Output as single schema.ts or multiple files */
  outputMode: 'single' | 'split';
  /** Include TypeScript types alongside validators */
  generateTypes: boolean;
  /** Include comments in output */
  includeComments: boolean;
  /** Export field validators for reuse */
  exportFieldValidators: boolean;
  /** Schema validation setting */
  schemaValidation: boolean;
  /** Index generation strategy */
  indexStrategy: 'all' | 'unique-only' | 'none';
  /** Custom table name transformer */
  tableNameTransformer?: (name: string) => string;
  /** Custom field name transformer */
  fieldNameTransformer?: (name: string) => string;
}

// ============================================================================
// Edge Case Handling
// ============================================================================

/**
 * Edge case warning levels
 */
export type EdgeCaseWarningType = 'info' | 'warning' | 'error';

/**
 * Edge case warning
 */
export interface EdgeCaseWarning {
  /** Warning severity */
  type: EdgeCaseWarningType;
  /** Table name */
  table: string;
  /** Column name (if applicable) */
  column?: string;
  /** Warning message */
  message: string;
  /** Suggested action */
  suggestion?: string;
}

// ============================================================================
// Code Generation
// ============================================================================

/**
 * Options for the Convex function generator
 */
export interface ConvexGeneratorOptions {
  /** Output directory for generated files */
  outputDir: string;
  /** Generate query functions */
  generateQueries: boolean;
  /** Generate mutation functions */
  generateMutations: boolean;
  /** Generate validator schemas */
  generateValidators: boolean;
  /** Generate TypeScript types */
  generateTypes: boolean;
  /** Overwrite existing files */
  overwrite: boolean;
  /** Dry run - preview without writing */
  dryRun: boolean;
}

/**
 * Result of code generation
 */
export interface GenerationResult {
  /** Whether generation was successful */
  success: boolean;
  /** Files that were generated */
  filesGenerated: string[];
  /** Files that were skipped */
  filesSkipped: string[];
  /** Errors encountered */
  errors: Array<{ file: string; error: string }>;
}

/**
 * Query generator result
 */
export interface QueryGeneratorResult {
  /** Generated file content */
  content: string;
  /** Number of queries generated */
  count: number;
}

/**
 * Mutation generator result
 */
export interface MutationGeneratorResult {
  /** Generated file content */
  content: string;
  /** Number of mutations generated */
  count: number;
}

/**
 * Validator generator result
 */
export interface ValidatorGeneratorResult {
  /** Generated file content */
  content: string;
  /** Number of validators generated */
  count: number;
}

/**
 * Type generator result
 */
export interface TypeGeneratorResult {
  /** Generated file content */
  content: string;
  /** Number of types generated */
  count: number;
}

/**
 * Action generator result
 */
export interface ActionGeneratorResult {
  /** Generated file content */
  content: string;
  /** Number of actions generated */
  count: number;
}

/**
 * HTTP action generator result
 */
export interface HttpActionGeneratorResult {
  /** Generated file content */
  content: string;
  /** Number of HTTP actions generated */
  count: number;
}

/**
 * Options for the Convex function generator orchestrator
 */
export interface ConvexFunctionGeneratorOptions {
  /** Output directory for generated files */
  outputDir: string;
  /** Generate query functions */
  generateQueries?: boolean;
  /** Generate mutation functions */
  generateMutations?: boolean;
  /** Generate validator objects */
  generateValidators?: boolean;
  /** Generate TypeScript types */
  generateTypes?: boolean;
  /** Generate action functions for external API calls */
  generateActions?: boolean;
  /** Generate HTTP action functions for REST endpoints */
  generateHttpActions?: boolean;
  /** Generate search indexes for text fields */
  generateSearchIndexes?: boolean;
  /** Generate vector indexes for embedding fields */
  generateVectorIndexes?: boolean;
  /** Separate files per table */
  separateFiles?: boolean;
  /** Include JSDoc comments */
  includeComments?: boolean;
  /**
   * Target Convex API version for generated code
   * - '1.30': Old API style (db.get(docId), db.patch(docId, ...))
   * - '1.31': New API style (db.get("tableName", docId), db.patch("tableName", docId, ...))
   * Default: '1.30' for backwards compatibility
   */
  convexApiVersion?: ConvexApiVersion;
  /**
   * Default vector dimensions for vector indexes (default: 1536 for OpenAI embeddings)
   */
  defaultVectorDimensions?: number;
  /**
   * Use staged deployment for indexes on large tables
   */
  useStagedIndexes?: boolean;
  /** Generate crons.ts with scheduled cleanup jobs (default: true) */
  generateCrons?: boolean;
  /** Generate convex.config.ts with detected components (default: true) */
  generateComponentConfig?: boolean;
  /** Generate per-table scheduled function helpers (default: true) */
  generateScheduledHelpers?: boolean;
  /** Generate Convex Auth files if users table detected (default: true) */
  generateAuth?: boolean;
}

/**
 * Generated files for a single table
 */
export interface GeneratedTableFiles {
  /** Generated queries */
  queries: string;
  /** Generated mutations */
  mutations: string;
  /** Generated validators */
  validators: string;
  /** Generated types */
  types: string;
  /** Generated actions */
  actions: string;
  /** Generated HTTP actions */
  httpActions: string;
  /** Query count */
  queryCount: number;
  /** Mutation count */
  mutationCount: number;
  /** Validator count */
  validatorCount: number;
  /** Type count */
  typeCount: number;
  /** Action count */
  actionCount: number;
  /** HTTP action count */
  httpActionCount: number;
  /** Generated scheduled function helpers */
  scheduledHelpers?: string;
}

/**
 * Complete output from the function generator
 */
export interface ConvexGeneratedOutput {
  /** Generated schema.ts content */
  schema: string;
  /** Per-table generated files */
  tables: Map<string, GeneratedTableFiles>;
  /** Generated index file content */
  indexFile: string;
  /** Generated HTTP routes file content */
  httpFile?: string;
  /** Generated crons.ts content */
  cronsFile?: string;
  /** Generated convex.config.ts content */
  componentConfigFile?: string;
  /** Generated auth.ts content (when users table detected) */
  authFile?: string;
  /** Generated auth.config.ts content (when users table detected) */
  authConfigFile?: string;
  /** Generation statistics */
  stats: {
    totalTables: number;
    totalQueries: number;
    totalMutations: number;
    totalValidators: number;
    totalTypes: number;
    totalActions: number;
    totalHttpActions: number;
    totalSearchIndexes: number;
    totalVectorIndexes: number;
  };
}

// ============================================================================
// Transform Types (used by data migration)
// ============================================================================

/**
 * Transform context for data transformation
 */
export interface TransformContext {
  /** Current table name */
  tableName: string;
  /** Table metadata */
  tableInfo: TableInfo;
  /** ID mapper for FK resolution */
  idMapper: IIdMapper;
  /** Whether this is a dry run */
  dryRun: boolean;
}

/**
 * Result of a row transformation
 */
export interface TransformResult {
  /** Whether transformation succeeded */
  success: boolean;
  /** Transformed document (null if failed) */
  document: Record<string, unknown> | null;
  /** Warning messages */
  warnings: string[];
  /** Error messages */
  errors: string[];
}

/**
 * Column transformer function type
 */
export type ColumnTransformer = (
  value: unknown,
  column: ColumnInfo,
  context: TransformContext
) => unknown;

// ============================================================================
// Convex HTTP Client
// ============================================================================

/**
 * Convex HTTP client interface (alternative to IConvexClient)
 */
export interface ConvexHttpClient {
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
  query(name: string, args: Record<string, unknown>): Promise<unknown>;
}
