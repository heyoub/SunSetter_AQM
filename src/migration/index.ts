/**
 * Migration Module
 *
 * Exports all migration-related components for PostgreSQL to Convex migration.
 */

// Types
export * from './types.js';

// Core components
export { DependencyResolver } from './dependency-resolver.js';
export { IdMapper, createIdMapper } from './id-mapper.js';
export { MigrationStateManager } from './migration-state.js';
export { DataTransformer, createTransformer } from './data-transformer.js';
export type { TransformerConfig } from './data-transformer.js';
export { TableMigrator } from './table-migrator.js';
export type { TableMigratorConfig } from './table-migrator.js';
// TableMigrationResult, TableMigrationMetrics, AggregatedMigrationMetrics are exported from ./types.js via line 8
export {
  MigrationEngine,
  ConvexHttpClient,
  createMigrationEngine,
} from './migration-engine.js';
