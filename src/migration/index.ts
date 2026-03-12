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
  createParallelMigrationEngine,
  createMultiSchemaMigrationEngine,
} from './migration-engine.js';

// 110% ENHANCEMENTS: Export new enterprise utilities
export { HookExecutor, COMMON_HOOKS } from './hooks.js';
export type { HookConfig, HookResult, MigrationHooks } from './hooks.js';

export { SlackNotifier } from './notifications.js';
export type { SlackNotificationConfig } from './notifications.js';

export { MemoryMonitor } from './memory-monitor.js';
export type { MemoryMonitorConfig, MemorySnapshot } from './memory-monitor.js';

export { DataMasker, COMMON_MASKING_RULES } from './data-masking.js';
export type {
  MaskingStrategy,
  MaskingRule,
  TableMaskingConfig,
  DataMaskingConfig,
} from './data-masking.js';

export {
  MigrationVerifier,
  formatVerificationReport,
  formatVerificationReportJson,
} from './verification.js';
