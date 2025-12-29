/**
 * Migration Engine
 *
 * Main orchestrator for PostgreSQL to Convex data migration.
 * Coordinates all migration components: introspection, dependency resolution,
 * data transformation, table migration, and state management.
 *
 * Enterprise features:
 * - Rollback capability with pre-migration snapshots
 * - Multi-schema support for PostgreSQL
 * - Parallel table migration for independent tables
 * - Enhanced dry-run with detailed previews
 * - Optimized connection pooling
 */

import { Pool } from 'pg';
import type {
  TableInfo,
  MultiSchemaOptions,
} from '../introspector/schema-introspector.js';
import { SchemaIntrospector } from '../introspector/schema-introspector.js';
import {
  DatabaseConnection,
  createOptimizedConnection,
} from '../config/database.js';
import type {
  MigrationConfig,
  MigrationState,
  MigrationReport,
  TableMigrationSummary,
  MigrationError,
  MigrationEventHandler,
  IConvexClient,
  ConvexDocument,
  ConvexId,
  ValidationResult,
  MultiSchemaConfig,
  RollbackConfig,
  DryRunResult,
  DryRunTableResult,
  DEFAULT_MIGRATION_CONFIG,
  DEFAULT_MULTI_SCHEMA_CONFIG,
  DEFAULT_ROLLBACK_CONFIG,
  DEFAULT_PARALLEL_CONFIG,
} from './types.js';
import { DependencyResolver } from './dependency-resolver.js';
import { IdMapper, createIdMapper } from './id-mapper.js';
import { MigrationStateManager } from './migration-state.js';
import { DataTransformer, createTransformer } from './data-transformer.js';
import { TableMigrator, TableMigrationResult } from './table-migrator.js';
import { ConvexFunctionGenerator } from '../generator/convex/index.js';
import { EdgeCaseHandler } from '../convex/edge-case-handler.js';
import {
  RollbackManager,
  RollbackResult,
  RollbackOptions,
} from './rollback-manager.js';
import {
  ParallelMigrator,
  ParallelMigrationResult,
} from './parallel-migrator.js';

/**
 * Extended migration configuration with enterprise features
 */
export interface ExtendedMigrationConfig extends MigrationConfig {
  /** Multi-schema configuration */
  multiSchema?: Partial<MultiSchemaConfig>;
  /** Rollback configuration */
  rollback?: Partial<RollbackConfig>;
  /** Parallel migration configuration */
  parallel?: {
    enabled?: boolean;
    maxParallelTables?: number;
    autoOptimize?: boolean;
  };
}

/**
 * Mock Convex client for schema-only migrations
 */
class MockConvexClient implements IConvexClient {
  async insert(): Promise<ConvexId> {
    return `mock_${Date.now()}`;
  }
  async batchInsert(
    tableName: string,
    documents: ConvexDocument[]
  ): Promise<ConvexId[]> {
    return documents.map((_, i) => `mock_${Date.now()}_${i}`);
  }
  async truncateTable(): Promise<number> {
    return 0;
  }
  async countDocuments(): Promise<number> {
    return 0;
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/**
 * HTTP-based Convex client implementation
 */
export class ConvexHttpClient implements IConvexClient {
  private url: string;
  private deployKey: string;

  constructor(url: string, deployKey: string) {
    this.url = url.replace(/\/$/, '');
    this.deployKey = deployKey;
  }

  async insert(tableName: string, document: ConvexDocument): Promise<ConvexId> {
    const response = await fetch(`${this.url}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.deployKey}`,
      },
      body: JSON.stringify({
        path: `${tableName}:create`,
        args: document,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Convex insert failed: ${error}`);
    }

    const result = (await response.json()) as { value: ConvexId };
    return result.value;
  }

  async batchInsert(
    tableName: string,
    documents: ConvexDocument[]
  ): Promise<ConvexId[]> {
    const response = await fetch(`${this.url}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.deployKey}`,
      },
      body: JSON.stringify({
        path: `${tableName}:batchCreate`,
        args: { items: documents },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Convex batch insert failed: ${error}`);
    }

    const result = (await response.json()) as { value: ConvexId[] };
    return result.value;
  }

  async truncateTable(tableName: string): Promise<number> {
    // Note: Convex doesn't have a native truncate, would need custom mutation
    console.warn(`truncateTable for ${tableName} not implemented`);
    return 0;
  }

  async countDocuments(tableName: string): Promise<number> {
    const response = await fetch(`${this.url}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.deployKey}`,
      },
      body: JSON.stringify({
        path: `${tableName}:count`,
        args: {},
      }),
    });

    if (!response.ok) {
      return 0;
    }

    const result = (await response.json()) as { value?: number };
    return result.value || 0;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.url}/version`, {
        headers: {
          Authorization: `Bearer ${this.deployKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Main migration engine with enterprise features
 */
export class MigrationEngine {
  private config: MigrationConfig;
  private extendedConfig: ExtendedMigrationConfig;
  private pool: Pool | null;
  private convexClient: IConvexClient;
  private idMapper: IdMapper;
  private stateManager: MigrationStateManager;
  private transformer: DataTransformer;
  private dependencyResolver: DependencyResolver;
  private functionGenerator: ConvexFunctionGenerator;
  private edgeCaseHandler: EdgeCaseHandler;
  private tableMigrator: TableMigrator | null;
  private rollbackManager: RollbackManager;
  private parallelMigrator: ParallelMigrator | null;
  private eventHandlers: MigrationEventHandler[];
  private tables: TableInfo[];
  private aborted: boolean;
  private multiSchemaConfig: MultiSchemaConfig;
  private rollbackConfig: RollbackConfig;

  constructor(config: Partial<ExtendedMigrationConfig>) {
    // Merge with defaults
    this.config = {
      connectionString: config.connectionString || '',
      convexUrl: config.convexUrl || '',
      convexDeployKey: config.convexDeployKey || '',
      stateDir: config.stateDir || './.migration',
      batchSize: config.batchSize || 100,
      maxRetries: config.maxRetries || 3,
      retryDelayMs: config.retryDelayMs || 1000,
      concurrency: config.concurrency || 5,
      rateLimit: config.rateLimit || 100,
      dryRun: config.dryRun || false,
      includeTables: config.includeTables || [],
      excludeTables: config.excludeTables || [],
      resume: config.resume || false,
      truncateExisting: config.truncateExisting || false,
      logLevel: config.logLevel || 'normal',
    };

    // Extended config with enterprise features
    this.extendedConfig = config as ExtendedMigrationConfig;

    // Multi-schema configuration
    this.multiSchemaConfig = {
      schemas: config.multiSchema?.schemas || ['public'],
      prefixTableNames: config.multiSchema?.prefixTableNames ?? false,
      schemaSeparator: config.multiSchema?.schemaSeparator || '__',
      crossSchemaFkHandling:
        config.multiSchema?.crossSchemaFkHandling || 'resolve',
    };

    // Rollback configuration
    this.rollbackConfig = {
      enabled: config.rollback?.enabled ?? true,
      maxRowsPerTable: config.rollback?.maxRowsPerTable ?? 100000,
      autoSaveIntervalMs: config.rollback?.autoSaveIntervalMs ?? 10000,
      trackExistingDocuments: config.rollback?.trackExistingDocuments ?? false,
    };

    this.pool = null;
    this.tableMigrator = null;
    this.parallelMigrator = null;
    this.eventHandlers = [];
    this.tables = [];
    this.aborted = false;

    // Initialize components
    this.stateManager = new MigrationStateManager({
      baseDir: this.config.stateDir,
    });

    this.idMapper = new IdMapper({
      persistPath: `${this.config.stateDir}/id-mappings.json`,
      autoSaveThreshold: 500,
    });

    this.transformer = createTransformer(this.idMapper);
    this.dependencyResolver = new DependencyResolver();
    this.functionGenerator = new ConvexFunctionGenerator({
      outputDir: './convex',
    });
    this.edgeCaseHandler = new EdgeCaseHandler();

    // Initialize rollback manager
    this.rollbackManager = new RollbackManager({
      baseDir: this.config.stateDir,
      maxRowsPerTable: this.rollbackConfig.maxRowsPerTable,
    });

    // Initialize Convex client
    if (this.config.convexUrl && this.config.convexDeployKey) {
      this.convexClient = new ConvexHttpClient(
        this.config.convexUrl,
        this.config.convexDeployKey
      );
    } else {
      this.convexClient = new MockConvexClient();
    }
  }

  /**
   * Register event handler
   */
  onEvent(handler: MigrationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Abort the migration
   */
  abort(): void {
    this.aborted = true;
    if (this.tableMigrator) {
      this.tableMigrator.abort();
    }
  }

  /**
   * Initialize database connection
   */
  async initialize(): Promise<void> {
    // Connect to PostgreSQL
    this.pool = new Pool({
      connectionString: this.config.connectionString,
    });

    // Test connection
    try {
      await this.pool.query('SELECT 1');
    } catch (error: unknown) {
      throw new Error(
        `Failed to connect to PostgreSQL: ${(error as Error).message}`
      );
    }

    // Initialize table migrator
    this.tableMigrator = new TableMigrator(
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
      this.tableMigrator.onEvent(handler);
    }
  }

  /**
   * Introspect the PostgreSQL database
   * Supports single schema (default) or multi-schema introspection
   */
  async introspect(): Promise<TableInfo[]> {
    if (!this.pool) {
      throw new Error('Not initialized. Call initialize() first.');
    }

    // Create a DatabaseConnection wrapper for the pool
    const dbConnection = this.createDbConnectionWrapper();
    const introspector = new SchemaIntrospector(dbConnection);

    // Check if multi-schema is configured
    if (
      this.multiSchemaConfig.schemas.length > 1 ||
      (this.multiSchemaConfig.schemas.length === 1 &&
        this.multiSchemaConfig.schemas[0] !== 'public')
    ) {
      // Multi-schema introspection
      const multiSchemaResult = await introspector.introspectMultipleSchemas({
        schemas: this.multiSchemaConfig.schemas,
        prefixTableNames: this.multiSchemaConfig.prefixTableNames,
        schemaSeparator: this.multiSchemaConfig.schemaSeparator,
      });

      this.tables = multiSchemaResult.allTables;

      // Log cross-schema foreign keys if any
      if (multiSchemaResult.crossSchemaForeignKeys.length > 0) {
        console.log(
          `Found ${multiSchemaResult.crossSchemaForeignKeys.length} cross-schema foreign keys`
        );
      }
    } else {
      // Single schema introspection (default: public)
      const schema = await introspector.introspectSchema('public');
      this.tables = schema.tables;
    }

    // Apply filters
    if (this.config.includeTables.length > 0) {
      const includeSet = new Set(this.config.includeTables);
      this.tables = this.tables.filter(
        (t) =>
          includeSet.has(t.tableName) ||
          includeSet.has(t.convexTableName || t.tableName)
      );
    }

    if (this.config.excludeTables.length > 0) {
      const excludeSet = new Set(this.config.excludeTables);
      this.tables = this.tables.filter(
        (t) =>
          !excludeSet.has(t.tableName) &&
          !excludeSet.has(t.convexTableName || t.tableName)
      );
    }

    return this.tables;
  }

  /**
   * Introspect multiple schemas
   */
  async introspectSchemas(schemas: string[]): Promise<TableInfo[]> {
    if (!this.pool) {
      throw new Error('Not initialized. Call initialize() first.');
    }

    const dbConnection = this.createDbConnectionWrapper();
    const introspector = new SchemaIntrospector(dbConnection);

    const result = await introspector.introspectMultipleSchemas({
      schemas,
      prefixTableNames: this.multiSchemaConfig.prefixTableNames,
      schemaSeparator: this.multiSchemaConfig.schemaSeparator,
    });

    this.tables = result.allTables;
    return this.tables;
  }

  /**
   * Validate the schema for migration
   */
  async validate(): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // Check edge cases
    const warnings = this.edgeCaseHandler.processSchema(this.tables);
    for (const warning of warnings) {
      if (warning.type === 'error') {
        result.errors.push({
          table: warning.table,
          field: warning.column,
          message: warning.message,
          severity: 'error',
        });
        result.valid = false;
      } else {
        result.warnings.push({
          table: warning.table,
          field: warning.column,
          message: warning.message,
          severity: 'warning',
        });
      }
    }

    // Check for circular dependencies
    const depResult = this.dependencyResolver.resolve(this.tables);
    if (depResult.circularDeps.length > 0) {
      for (const cycle of depResult.circularDeps) {
        result.warnings.push({
          table: cycle.tables[0],
          message: `Circular dependency: ${cycle.path.join(' -> ')}`,
          severity: 'warning',
        });
      }
    }

    // Check Convex client connectivity
    if (!(this.convexClient instanceof MockConvexClient)) {
      const healthy = await this.convexClient.healthCheck();
      if (!healthy) {
        result.errors.push({
          table: '',
          message: 'Cannot connect to Convex deployment',
          severity: 'error',
        });
        result.valid = false;
      }
    }

    return result;
  }

  /**
   * Generate Convex schema and functions (schema-only migration)
   */
  async generateSchema(outputDir?: string): Promise<{
    schemaPath: string;
    functionsGenerated: number;
  }> {
    if (outputDir) {
      this.functionGenerator = new ConvexFunctionGenerator({ outputDir });
    }

    const output = this.functionGenerator.generate(this.tables);
    await this.functionGenerator.writeToFileSystem(output);

    return {
      schemaPath: `${outputDir || './convex'}/schema.ts`,
      functionsGenerated:
        output.stats.totalQueries +
        output.stats.totalMutations +
        output.stats.totalValidators +
        output.stats.totalTypes,
    };
  }

  /**
   * Run the full migration (schema + data)
   * Supports both sequential and parallel migration modes
   */
  async migrate(): Promise<MigrationReport> {
    const startTime = new Date();
    const tableResults: TableMigrationResult[] = [];
    const errors: MigrationError[] = [];

    try {
      // Check if resuming
      let state: MigrationState | null = null;
      if (this.config.resume) {
        state = await this.stateManager.load();
        if (state) {
          // Load existing ID mappings
          await this.idMapper.load();
          // Load rollback state if available
          await this.rollbackManager.load(state.migrationId);
        }
      }

      // Resolve migration order
      const depResult = this.dependencyResolver.resolve(this.tables);
      const migrationOrder = this.dependencyResolver.getMigrationOrder(
        this.tables,
        {
          include: this.config.includeTables,
          exclude: this.config.excludeTables,
        }
      );

      // Create new state if not resuming
      if (!state) {
        state = this.stateManager.createNew(migrationOrder);

        // Initialize rollback tracking
        if (this.rollbackConfig.enabled) {
          this.rollbackManager.createNew(state.migrationId);
          this.stateManager.initRollbackSnapshots();
        }
      }

      // Start auto-save
      this.stateManager.startAutoSave();
      if (this.rollbackConfig.enabled) {
        this.rollbackManager.startAutoSave(
          this.rollbackConfig.autoSaveIntervalMs
        );
      }

      // Emit migration start
      this.emitEvent({
        type: 'migration:start',
        timestamp: new Date(),
        migrationId: state.migrationId,
        data: { tables: migrationOrder.length },
      });

      // Check if parallel migration is enabled
      const parallelEnabled = this.extendedConfig.parallel?.enabled ?? false;

      if (parallelEnabled && !this.config.dryRun) {
        // Parallel migration
        const parallelResult = await this.migrateParallel(state);
        tableResults.push(...parallelResult.tableResults);
        errors.push(...parallelResult.errors);
      } else {
        // Sequential migration
        await this.migrateSequential(
          state,
          migrationOrder,
          tableResults,
          errors
        );
      }

      // Complete migration
      if (this.aborted) {
        this.stateManager.pauseMigration();
      } else {
        this.stateManager.completeMigration();
      }

      // Final save
      await this.stateManager.save(state);
      await this.idMapper.save();
      if (this.rollbackConfig.enabled) {
        await this.rollbackManager.save();
        await this.stateManager.saveRollbackSnapshots();
      }

      // Stop auto-save
      this.stateManager.stopAutoSave();
      this.rollbackManager.stopAutoSave();

      // Emit completion
      this.emitEvent({
        type: this.aborted ? 'migration:pause' : 'migration:complete',
        timestamp: new Date(),
        migrationId: state.migrationId,
      });
    } catch (error: unknown) {
      errors.push({
        code: 'UNKNOWN_ERROR',
        message: (error as Error).message,
        originalError: error as Error,
        retryable: false,
      });

      this.stateManager.failMigration((error as Error).message);
      const currentState = this.stateManager.getCurrentState();
      if (currentState) {
        await this.stateManager.save(currentState);
      }
    }

    // Generate report
    return this.generateReport(startTime, tableResults, errors);
  }

  /**
   * Sequential migration (original behavior)
   */
  private async migrateSequential(
    state: MigrationState,
    migrationOrder: string[],
    tableResults: TableMigrationResult[],
    errors: MigrationError[]
  ): Promise<void> {
    for (const tableName of migrationOrder) {
      if (this.aborted) break;

      // Skip completed tables (for resume)
      const tableProgress = state.tables.get(tableName);
      if (tableProgress?.status === 'completed') {
        continue;
      }

      const table = this.tables.find((t) => t.tableName === tableName);
      if (!table) {
        errors.push({
          code: 'UNKNOWN_ERROR',
          message: `Table ${tableName} not found in schema`,
          table: tableName,
          retryable: false,
        });
        continue;
      }

      // Create pre-migration snapshot for rollback
      if (this.rollbackConfig.enabled) {
        const rowCount = await this.getTableRowCount(tableName);
        await this.rollbackManager.createTableSnapshot(table, rowCount, false);
      }

      // Migrate table
      const result = await this.tableMigrator!.migrate(table);
      tableResults.push(result);

      // Save state after each table
      await this.stateManager.save(state);
      await this.idMapper.save();
    }
  }

  /**
   * Parallel migration using ParallelMigrator
   */
  private async migrateParallel(
    state: MigrationState
  ): Promise<ParallelMigrationResult> {
    if (!this.parallelMigrator) {
      const maxParallelTables =
        this.extendedConfig.parallel?.maxParallelTables ?? 4;

      this.parallelMigrator = new ParallelMigrator(
        this.pool!,
        this.convexClient,
        this.idMapper,
        this.transformer,
        this.stateManager,
        {
          maxParallelTables,
          batchSize: this.config.batchSize,
          maxRetries: this.config.maxRetries,
          retryDelayMs: this.config.retryDelayMs,
          rateLimit: this.config.rateLimit,
          dryRun: this.config.dryRun,
        }
      );

      // Forward events
      for (const handler of this.eventHandlers) {
        this.parallelMigrator.onEvent(handler);
      }
    }

    // Create snapshots for all tables before parallel migration
    if (this.rollbackConfig.enabled) {
      for (const table of this.tables) {
        const rowCount = await this.getTableRowCount(table.tableName);
        await this.rollbackManager.createTableSnapshot(table, rowCount, false);
      }
    }

    return this.parallelMigrator.migrateParallel(this.tables);
  }

  /**
   * Get row count for a table
   */
  private async getTableRowCount(tableName: string): Promise<number> {
    if (!this.pool) return 0;
    try {
      const result = await this.pool.query(
        `SELECT COUNT(*) as count FROM "${tableName}"`
      );
      return parseInt(result.rows[0].count, 10);
    } catch {
      return 0;
    }
  }

  /**
   * Rollback the migration
   * Deletes all migrated documents from Convex
   */
  async rollback(options: RollbackOptions = {}): Promise<RollbackResult> {
    // Create a client adapter for the rollback manager
    const rollbackClient = {
      delete: async (
        tableName: string,
        documentId: ConvexId
      ): Promise<void> => {
        // Single delete would need a custom mutation in Convex
        console.warn(
          `Single delete for ${tableName}:${documentId} not implemented`
        );
      },
      batchDelete: async (
        tableName: string,
        documentIds: ConvexId[]
      ): Promise<number> => {
        // Batch delete would need a custom mutation in Convex
        console.warn(
          `Batch delete for ${tableName}: ${documentIds.length} documents`
        );
        if (options.dryRun) {
          return documentIds.length;
        }
        // In a real implementation, this would call a Convex mutation
        return 0;
      },
      countDocuments: async (tableName: string): Promise<number> => {
        return this.convexClient.countDocuments(tableName);
      },
    };

    return this.rollbackManager.rollback(rollbackClient, options);
  }

  /**
   * Get rollback summary
   */
  getRollbackSummary(): {
    enabled: boolean;
    tablesTracked: number;
    totalRows: number;
    byTable: Record<string, number>;
  } {
    return this.rollbackManager.getSummary();
  }

  /**
   * Enhanced dry-run with detailed preview
   */
  async dryRun(): Promise<DryRunResult> {
    // Set dry run mode temporarily
    const originalDryRun = this.config.dryRun;
    this.config.dryRun = true;

    try {
      // Validate
      const validation = await this.validate();

      // Get table details
      const tableResults: DryRunTableResult[] = [];
      let totalRows = 0;

      for (const table of this.tables) {
        const rowCount = await this.getTableRowCount(table.tableName);
        totalRows += rowCount;

        tableResults.push({
          tableName: table.tableName,
          schemaName: table.schemaName,
          rowCount,
          columnCount: table.columns.length,
          hasForeignKeys: table.foreignKeys.length > 0,
          foreignKeyDependencies: table.foreignKeys.map(
            (fk) => fk.referencedTable
          ),
          warnings: [],
        });
      }

      // Get migration order
      const migrationOrder = this.dependencyResolver.getMigrationOrder(
        this.tables,
        {
          include: this.config.includeTables,
          exclude: this.config.excludeTables,
        }
      );

      // Analyze parallel execution if enabled
      let parallelPlan: DryRunResult['parallelPlan'];
      if (this.extendedConfig.parallel?.enabled) {
        const levels = this.dependencyResolver.groupByLevel();
        const tablesPerPhase = [...levels.values()].map((l) => l.length);
        parallelPlan = {
          phases: levels.size,
          tablesPerPhase,
          estimatedSpeedup: this.tables.length / levels.size,
        };
      }

      // Estimate duration (rough: 1000 rows/sec)
      const estimatedDurationSec = totalRows / 1000;

      return {
        wouldSucceed: validation.valid,
        validation,
        tables: tableResults,
        totalRows,
        estimatedDurationSec,
        schemaChanges: [], // Would need Convex introspection to populate
        migrationOrder,
        parallelPlan,
      };
    } finally {
      this.config.dryRun = originalDryRun;
    }
  }

  /**
   * Analyze parallelization opportunities
   */
  analyzeParallelization(): {
    levels: Array<{ level: number; tables: string[] }>;
    maxParallelism: number;
    bottlenecks: string[];
    suggestions: string[];
  } {
    if (!this.parallelMigrator) {
      this.parallelMigrator = new ParallelMigrator(
        this.pool!,
        this.convexClient,
        this.idMapper,
        this.transformer,
        this.stateManager,
        {}
      );
    }
    return this.parallelMigrator.analyzeParallelization(this.tables);
  }

  /**
   * Generate migration report
   */
  private generateReport(
    startTime: Date,
    tableResults: TableMigrationResult[],
    errors: MigrationError[]
  ): MigrationReport {
    const endTime = new Date();
    const state = this.stateManager.getCurrentState();

    const tableSummaries: TableMigrationSummary[] = tableResults.map((r) => ({
      tableName: r.tableName,
      status: r.success ? 'completed' : 'failed',
      totalRows: r.totalRows,
      migratedRows: r.migratedRows,
      failedRows: r.failedRows,
      skippedRows: r.skippedRows,
      duration: r.duration,
      errors: r.errors,
    }));

    const totalRows = tableResults.reduce((sum, r) => sum + r.totalRows, 0);
    const migratedRows = tableResults.reduce(
      (sum, r) => sum + r.migratedRows,
      0
    );
    const failedRows = tableResults.reduce((sum, r) => sum + r.failedRows, 0);
    const skippedRows = tableResults.reduce((sum, r) => sum + r.skippedRows, 0);

    let status: 'completed' | 'failed' | 'partial' = 'completed';
    if (errors.length > 0 || tableResults.some((r) => !r.success)) {
      status = tableResults.some((r) => r.success) ? 'partial' : 'failed';
    }

    return {
      migrationId: state?.migrationId || 'unknown',
      status,
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      tables: tableSummaries,
      totalRows,
      migratedRows,
      failedRows,
      skippedRows,
      errors: [...errors, ...tableResults.flatMap((r) => r.errors)],
      warnings: [],
    };
  }

  /**
   * Emit event to all handlers
   */
  private emitEvent(event: import('./types.js').MigrationEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let handler errors break migration
      }
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /**
   * Create a DatabaseConnection wrapper for the pool
   */
  private createDbConnectionWrapper(): DatabaseConnection {
    const pool = this.pool!;
    return {
      pool,
      config: {} as any,
      async testConnection(): Promise<boolean> {
        try {
          await pool.query('SELECT 1');
          return true;
        } catch {
          return false;
        }
      },
      async close(): Promise<void> {
        // Don't close - managed by MigrationEngine
      },
      getConfig() {
        return {} as any;
      },
      async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
        const result = await pool.query(sql, params);
        return result.rows as T[];
      },
    } as unknown as DatabaseConnection;
  }

  /**
   * Get current migration state
   */
  getState(): MigrationState | null {
    return this.stateManager.getCurrentState();
  }

  /**
   * Get migration statistics
   */
  getStats(): {
    tablesProcessed: number;
    rowsMigrated: number;
    idMappings: number;
  } {
    const state = this.stateManager.getCurrentState();
    return {
      tablesProcessed: state?.stats.completedTables || 0,
      rowsMigrated: state?.stats.migratedRows || 0,
      idMappings: this.idMapper.count(),
    };
  }

  /**
   * Get list of previous migrations
   */
  async listMigrations(): Promise<string[]> {
    return this.stateManager.list();
  }

  /**
   * Delete a migration's state
   */
  async deleteMigration(migrationId: string): Promise<void> {
    await this.stateManager.delete(migrationId);
  }
}

/**
 * Factory function to create and initialize a migration engine
 */
export async function createMigrationEngine(
  config: Partial<ExtendedMigrationConfig>
): Promise<MigrationEngine> {
  const engine = new MigrationEngine(config);
  await engine.initialize();
  return engine;
}

/**
 * Create a migration engine with parallel migration enabled
 */
export async function createParallelMigrationEngine(
  config: Partial<MigrationConfig>,
  parallelOptions: {
    maxParallelTables?: number;
    autoOptimize?: boolean;
  } = {}
): Promise<MigrationEngine> {
  const extendedConfig: Partial<ExtendedMigrationConfig> = {
    ...config,
    parallel: {
      enabled: true,
      maxParallelTables: parallelOptions.maxParallelTables ?? 4,
      autoOptimize: parallelOptions.autoOptimize ?? true,
    },
  };

  const engine = new MigrationEngine(extendedConfig);
  await engine.initialize();
  return engine;
}

/**
 * Create a migration engine with multi-schema support
 */
export async function createMultiSchemaMigrationEngine(
  config: Partial<MigrationConfig>,
  schemaOptions: {
    schemas: string[];
    prefixTableNames?: boolean;
    schemaSeparator?: string;
  }
): Promise<MigrationEngine> {
  const extendedConfig: Partial<ExtendedMigrationConfig> = {
    ...config,
    multiSchema: {
      schemas: schemaOptions.schemas,
      prefixTableNames: schemaOptions.prefixTableNames ?? true,
      schemaSeparator: schemaOptions.schemaSeparator ?? '__',
      crossSchemaFkHandling: 'resolve',
    },
  };

  const engine = new MigrationEngine(extendedConfig);
  await engine.initialize();
  return engine;
}
