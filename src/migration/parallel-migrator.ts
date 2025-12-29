/**
 * Parallel Migrator
 *
 * Orchestrates parallel migration of independent tables.
 * Builds dependency graph to identify tables that can be migrated concurrently.
 */

import type { Pool } from 'pg';
import type { TableInfo } from '../introspector/schema-introspector.js';
import type {
  MigrationEventHandler,
  MigrationEvent,
  MigrationError,
  IConvexClient,
  IIdMapper,
  TableMigrationResult,
  TableMigrationMetrics,
  AggregatedMigrationMetrics,
} from './types.js';
import { TableMigrator } from './table-migrator.js';
import { DataTransformer } from './data-transformer.js';
import { MigrationStateManager } from './migration-state.js';
import { DependencyResolver } from './dependency-resolver.js';

/**
 * Configuration for parallel migration
 */
export interface ParallelMigrationConfig {
  /** Maximum number of tables to migrate in parallel */
  maxParallelTables: number;
  /** Batch size for each table */
  batchSize: number;
  /** Maximum retries per batch */
  maxRetries: number;
  /** Retry delay in ms */
  retryDelayMs: number;
  /** Rate limit per second */
  rateLimit: number;
  /** Enable dry run mode */
  dryRun: boolean;
}

/**
 * Default parallel migration configuration
 */
const DEFAULT_CONFIG: ParallelMigrationConfig = {
  maxParallelTables: 4,
  batchSize: 100,
  maxRetries: 3,
  retryDelayMs: 1000,
  rateLimit: 100,
  dryRun: false,
};

/**
 * Result of parallel migration
 */
export interface ParallelMigrationResult {
  /** Overall success status */
  success: boolean;
  /** Results per table */
  tableResults: TableMigrationResult[];
  /** Total rows migrated */
  totalMigrated: number;
  /** Total rows failed */
  totalFailed: number;
  /** Duration in ms */
  duration: number;
  /** Errors encountered */
  errors: MigrationError[];
  /** Number of parallel batches executed */
  parallelBatches: number;
  /** Aggregated metrics across all tables */
  metrics: AggregatedMigrationMetrics;
}

/**
 * Dependency level group - tables at same dependency depth
 */
interface DependencyLevel {
  level: number;
  tables: string[];
}

/**
 * Orchestrates parallel migration of independent tables
 */
export class ParallelMigrator {
  private config: ParallelMigrationConfig;
  private pool: Pool;
  private convexClient: IConvexClient;
  private idMapper: IIdMapper;
  private transformer: DataTransformer;
  private stateManager: MigrationStateManager;
  private dependencyResolver: DependencyResolver;
  private eventHandlers: MigrationEventHandler[];
  private aborted: boolean;

  constructor(
    pool: Pool,
    convexClient: IConvexClient,
    idMapper: IIdMapper,
    transformer: DataTransformer,
    stateManager: MigrationStateManager,
    config: Partial<ParallelMigrationConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pool = pool;
    this.convexClient = convexClient;
    this.idMapper = idMapper;
    this.transformer = transformer;
    this.stateManager = stateManager;
    this.dependencyResolver = new DependencyResolver();
    this.eventHandlers = [];
    this.aborted = false;
  }

  /**
   * Register event handler
   */
  onEvent(handler: MigrationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit event to all handlers
   */
  private emit(event: Omit<MigrationEvent, 'timestamp' | 'migrationId'>): void {
    const state = this.stateManager.getCurrentState();
    const fullEvent: MigrationEvent = {
      ...event,
      timestamp: new Date(),
      migrationId: state?.migrationId || 'unknown',
    };

    for (const handler of this.eventHandlers) {
      try {
        handler(fullEvent);
      } catch {
        // Don't let event handler errors break migration
      }
    }
  }

  /**
   * Abort the parallel migration
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Build dependency graph and group tables by level
   */
  buildDependencyLevels(tables: TableInfo[]): DependencyLevel[] {
    // Build the dependency graph
    this.dependencyResolver.buildGraph(tables);

    // Group tables by dependency depth
    const levelMap = this.dependencyResolver.groupByLevel();
    const levels: DependencyLevel[] = [];

    // Sort levels (0 = no dependencies, migrate first)
    const sortedLevelKeys = [...levelMap.keys()].sort((a, b) => a - b);

    for (const level of sortedLevelKeys) {
      const tablesAtLevel = levelMap.get(level) || [];
      levels.push({
        level,
        tables: tablesAtLevel.sort(), // Sort for deterministic order
      });
    }

    return levels;
  }

  /**
   * Get tables that can be migrated in parallel (no dependencies between them)
   */
  getIndependentTables(tables: TableInfo[]): string[][] {
    const levels = this.buildDependencyLevels(tables);
    return levels.map((l) => l.tables);
  }

  /**
   * Migrate tables in parallel, respecting dependencies
   */
  async migrateParallel(tables: TableInfo[]): Promise<ParallelMigrationResult> {
    const startTime = Date.now();
    const result: ParallelMigrationResult = {
      success: true,
      tableResults: [],
      totalMigrated: 0,
      totalFailed: 0,
      duration: 0,
      errors: [],
      parallelBatches: 0,
      metrics: {
        avgRowsPerSecond: 0,
        peakMemoryMB: 0,
        totalBatches: 0,
        retriedBatches: 0,
        byTable: new Map(),
      },
    };

    this.aborted = false;

    try {
      // Build dependency levels
      const levels = this.buildDependencyLevels(tables);

      this.emit({
        type: 'migration:start',
        data: {
          totalTables: tables.length,
          parallelLevels: levels.length,
          tablesPerLevel: levels.map((l) => l.tables.length),
        },
      });

      // Create table lookup
      const tableMap = new Map<string, TableInfo>();
      for (const table of tables) {
        tableMap.set(table.tableName, table);
      }

      // Process each dependency level
      for (const level of levels) {
        if (this.aborted) break;

        result.parallelBatches++;

        // Migrate all tables at this level in parallel
        const levelResults = await this.migrateLevelParallel(
          level.tables,
          tableMap
        );

        // Aggregate results
        for (const tableResult of levelResults) {
          result.tableResults.push(tableResult);
          result.totalMigrated += tableResult.migratedRows;
          result.totalFailed += tableResult.failedRows;
          result.errors.push(...tableResult.errors);

          if (!tableResult.success) {
            result.success = false;
          }
        }
      }

      this.emit({
        type: result.success ? 'migration:complete' : 'migration:error',
        data: {
          migrated: result.totalMigrated,
          failed: result.totalFailed,
          parallelBatches: result.parallelBatches,
        },
      });
    } catch (error: unknown) {
      result.success = false;
      result.errors.push({
        code: 'UNKNOWN_ERROR',
        message: (error as Error).message,
        originalError: error as Error,
        retryable: false,
      });

      this.emit({
        type: 'migration:error',
        error: result.errors[result.errors.length - 1],
      });
    }

    result.duration = Date.now() - startTime;
    result.metrics = this.aggregateMetrics(result.tableResults);
    return result;
  }

  /**
   * Aggregate metrics from all table results
   */
  private aggregateMetrics(
    results: TableMigrationResult[]
  ): AggregatedMigrationMetrics {
    const byTable = new Map<string, TableMigrationMetrics>();
    let totalMigratedRows = 0;
    let weightedRowsPerSecond = 0;
    let peakMemoryMB = 0;
    let totalBatches = 0;
    let retriedBatches = 0;

    for (const result of results) {
      byTable.set(result.tableName, result.metrics);
      totalMigratedRows += result.migratedRows;
      weightedRowsPerSecond +=
        result.metrics.avgRowsPerSecond * result.migratedRows;
      peakMemoryMB = Math.max(peakMemoryMB, result.metrics.peakMemoryMB);
      totalBatches += result.metrics.totalBatches;
      retriedBatches += result.metrics.retriedBatches;
    }

    return {
      avgRowsPerSecond:
        totalMigratedRows > 0 ? weightedRowsPerSecond / totalMigratedRows : 0,
      peakMemoryMB,
      totalBatches,
      retriedBatches,
      byTable,
    };
  }

  /**
   * Migrate all tables at a dependency level in parallel
   */
  private async migrateLevelParallel(
    tableNames: string[],
    tableMap: Map<string, TableInfo>
  ): Promise<TableMigrationResult[]> {
    const results: TableMigrationResult[] = [];

    // Chunk tables by maxParallelTables
    const chunks: string[][] = [];
    for (let i = 0; i < tableNames.length; i += this.config.maxParallelTables) {
      chunks.push(tableNames.slice(i, i + this.config.maxParallelTables));
    }

    for (const chunk of chunks) {
      if (this.aborted) break;

      // Create migrators for each table in the chunk
      const promises = chunk.map(
        async (tableName): Promise<TableMigrationResult> => {
          const table = tableMap.get(tableName);
          if (!table) {
            return {
              tableName,
              success: false,
              totalRows: 0,
              migratedRows: 0,
              failedRows: 0,
              skippedRows: 0,
              duration: 0,
              errors: [
                {
                  code: 'UNKNOWN_ERROR' as const,
                  message: `Table ${tableName} not found`,
                  table: tableName,
                  retryable: false,
                },
              ],
              metrics: {
                avgRowsPerSecond: 0,
                peakMemoryMB: 0,
                totalBatches: 0,
                retriedBatches: 0,
              },
            };
          }

          return this.migrateTable(table);
        }
      );

      // Wait for all tables in this chunk to complete
      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Migrate a single table
   */
  private async migrateTable(table: TableInfo): Promise<TableMigrationResult> {
    const migrator = new TableMigrator(
      this.pool,
      this.convexClient,
      this.idMapper,
      this.transformer,
      this.stateManager,
      {
        batchSize: this.config.batchSize,
        maxRetries: this.config.maxRetries,
        retryDelayMs: this.config.retryDelayMs,
        rateLimit: this.config.rateLimit,
        dryRun: this.config.dryRun,
      }
    );

    // Forward events
    for (const handler of this.eventHandlers) {
      migrator.onEvent(handler);
    }

    return migrator.migrate(table);
  }

  /**
   * Analyze parallelization opportunities
   */
  analyzeParallelization(tables: TableInfo[]): {
    levels: DependencyLevel[];
    maxParallelism: number;
    bottlenecks: string[];
    suggestions: string[];
  } {
    const levels = this.buildDependencyLevels(tables);

    // Find max parallelism (largest level)
    const maxParallelism = Math.max(...levels.map((l) => l.tables.length));

    // Find bottlenecks (levels with single table that blocks many)
    const bottlenecks: string[] = [];
    const result = this.dependencyResolver.resolve(tables);

    for (const level of levels) {
      if (level.tables.length === 1) {
        const tableName = level.tables[0];
        const node = result.graph.get(tableName);
        if (node && node.dependents.length > 2) {
          bottlenecks.push(
            `${tableName} (blocks ${node.dependents.length} tables)`
          );
        }
      }
    }

    // Generate suggestions
    const suggestions: string[] = [];

    if (maxParallelism < 2) {
      suggestions.push(
        'Consider breaking up large tables into smaller ones to increase parallelism'
      );
    }

    if (bottlenecks.length > 0) {
      suggestions.push(
        'Bottleneck tables should be migrated first to unblock parallel migration'
      );
    }

    // Check for circular dependencies
    if (result.circularDeps.length > 0) {
      suggestions.push(
        `Found ${result.circularDeps.length} circular dependencies - these tables ` +
          'will be migrated sequentially with nullable FKs set to null initially'
      );
    }

    return {
      levels,
      maxParallelism,
      bottlenecks,
      suggestions,
    };
  }

  /**
   * Estimate migration time based on parallel execution
   */
  estimateTime(
    tables: TableInfo[],
    rowCounts: Map<string, number>,
    rowsPerSecond: number = 1000
  ): {
    serialTime: number;
    parallelTime: number;
    speedup: number;
  } {
    const levels = this.buildDependencyLevels(tables);

    // Calculate serial time (sum of all tables)
    let totalRows = 0;
    for (const count of rowCounts.values()) {
      totalRows += count;
    }
    const serialTime = totalRows / rowsPerSecond;

    // Calculate parallel time (max of each level)
    let parallelTime = 0;
    for (const level of levels) {
      let levelMaxTime = 0;
      for (const tableName of level.tables) {
        const rows = rowCounts.get(tableName) || 0;
        const tableTime = rows / rowsPerSecond;
        levelMaxTime = Math.max(levelMaxTime, tableTime);
      }
      parallelTime += levelMaxTime;
    }

    return {
      serialTime,
      parallelTime,
      speedup: serialTime / parallelTime,
    };
  }

  /**
   * Get optimal parallel configuration based on table structure
   */
  getOptimalConfig(tables: TableInfo[]): Partial<ParallelMigrationConfig> {
    const analysis = this.analyzeParallelization(tables);

    // Base parallel tables on analysis
    let maxParallelTables = Math.min(
      analysis.maxParallelism,
      8 // Hard limit
    );

    // Adjust for CPU/memory constraints (heuristic)
    if (tables.length > 50) {
      maxParallelTables = Math.min(maxParallelTables, 4);
    }

    // Adjust batch size based on average table size
    let batchSize = 100;
    if (tables.length < 10) {
      batchSize = 500; // Larger batches for fewer tables
    }

    return {
      maxParallelTables,
      batchSize,
    };
  }

  /**
   * Create a migration plan showing execution order
   */
  createMigrationPlan(tables: TableInfo[]): {
    phases: Array<{
      phase: number;
      tables: string[];
      canParallelize: boolean;
      reason: string;
    }>;
    totalPhases: number;
    estimatedSpeedup: string;
  } {
    const levels = this.buildDependencyLevels(tables);
    const phases: Array<{
      phase: number;
      tables: string[];
      canParallelize: boolean;
      reason: string;
    }> = [];

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      phases.push({
        phase: i + 1,
        tables: level.tables,
        canParallelize: level.tables.length > 1,
        reason:
          level.level === 0
            ? 'Root tables (no dependencies)'
            : `Depends on phase ${i} tables`,
      });
    }

    // Estimate speedup
    const totalTables = tables.length;
    const serialPhases = totalTables;
    const actualPhases = levels.length;
    const speedup = (serialPhases / actualPhases).toFixed(2);

    return {
      phases,
      totalPhases: actualPhases,
      estimatedSpeedup: `${speedup}x (${totalTables} tables in ${actualPhases} phases)`,
    };
  }
}

/**
 * Factory function to create parallel migrator
 */
export function createParallelMigrator(
  pool: Pool,
  convexClient: IConvexClient,
  idMapper: IIdMapper,
  transformer: DataTransformer,
  stateManager: MigrationStateManager,
  config: Partial<ParallelMigrationConfig> = {}
): ParallelMigrator {
  return new ParallelMigrator(
    pool,
    convexClient,
    idMapper,
    transformer,
    stateManager,
    config
  );
}
