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

import type { TableInfo } from '../introspector/schema-introspector.js';
import { SchemaIntrospector } from '../introspector/schema-introspector.js';
import { createAdapter, parseConnectionString } from '../adapters/index.js';
import type { DatabaseAdapter } from '../adapters/index.js';
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
} from './types.js';
import { DependencyResolver } from './dependency-resolver.js';
import { IdMapper } from './id-mapper.js';
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
import { HookExecutor } from './hooks.js';
import { SlackNotifier } from './notifications.js';
import { MemoryMonitor } from './memory-monitor.js';
import { DataMasker } from './data-masking.js';
import { toError } from '../utils/errors.js';
import { createConvexCircuitBreaker } from '../utils/circuit-breaker.js';
import {
  ConnectionError,
  ConvexError,
  DataMigrationError,
} from '../cli/errors/index.js';
import {
  SummaryReportGenerator,
  printSummaryToConsole,
} from '../cli/summary-report.js';

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
    _tableName: string,
    documents: ConvexDocument[]
  ): Promise<ConvexId[]> {
    return documents.map((_, i) => `mock_${Date.now()}_${i}`);
  }
  async delete(): Promise<void> {
    // Mock - do nothing
  }
  async batchDelete(
    _tableName: string,
    documentIds: ConvexId[]
  ): Promise<number> {
    return documentIds.length; // Mock - pretend we deleted them
  }
  async truncateTable(): Promise<number> {
    return 0;
  }
  async countDocuments(): Promise<number> {
    return 0;
  }
  async getDocument(): Promise<ConvexDocument | null> {
    return null;
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
      throw new ConvexError(`Convex insert failed: ${error}`);
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
      throw new ConvexError(`Convex batch insert failed: ${error}`);
    }

    const result = (await response.json()) as { value: ConvexId[] };
    return result.value;
  }

  /**
   * Delete a single document by ID
   * Calls the generated `remove` mutation
   */
  async delete(tableName: string, documentId: ConvexId): Promise<void> {
    const response = await fetch(`${this.url}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.deployKey}`,
      },
      body: JSON.stringify({
        path: `${tableName}:remove`,
        args: { id: documentId },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ConvexError(`Convex delete failed: ${error}`);
    }
  }

  /**
   * Delete multiple documents by ID
   * Calls the generated `batchRemove` mutation
   */
  async batchDelete(
    tableName: string,
    documentIds: ConvexId[]
  ): Promise<number> {
    if (documentIds.length === 0) return 0;

    const response = await fetch(`${this.url}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.deployKey}`,
      },
      body: JSON.stringify({
        path: `${tableName}:batchRemove`,
        args: { ids: documentIds },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ConvexError(`Convex batch delete failed: ${error}`);
    }

    const result = (await response.json()) as { value?: number };
    return result.value ?? documentIds.length;
  }

  /**
   * Delete all documents in a table
   * Queries all document IDs then batch deletes in chunks
   */
  async truncateTable(tableName: string): Promise<number> {
    // First, get all document IDs
    const response = await fetch(`${this.url}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.deployKey}`,
      },
      body: JSON.stringify({
        path: `${tableName}:listAll`,
        args: {},
      }),
    });

    if (!response.ok) {
      // If listAll doesn't exist, we can't truncate
      console.warn(
        `truncateTable for ${tableName}: listAll query not found. ` +
          `Generate queries with --include-list-all flag.`
      );
      return 0;
    }

    const result = (await response.json()) as { value?: { _id: ConvexId }[] };
    const documents = result.value || [];

    if (documents.length === 0) return 0;

    // Batch delete in chunks of 100
    const CHUNK_SIZE = 100;
    let totalDeleted = 0;

    for (let i = 0; i < documents.length; i += CHUNK_SIZE) {
      const chunk = documents.slice(i, i + CHUNK_SIZE);
      const ids = chunk.map((doc) => doc._id);
      const deleted = await this.batchDelete(tableName, ids);
      totalDeleted += deleted;
    }

    return totalDeleted;
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

  async getDocument(
    tableName: string,
    id: ConvexId
  ): Promise<ConvexDocument | null> {
    // NOTE: Requires a `get` query to be generated for the table in Convex.
    // e.g. `export const get = query({ args: { id: v.id("tableName") }, handler: ... })`
    const response = await fetch(`${this.url}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.deployKey}`,
      },
      body: JSON.stringify({
        path: `${tableName}:get`,
        args: { id },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const result = (await response.json()) as { value?: ConvexDocument | null };
    return result.value ?? null;
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
  private adapter: DatabaseAdapter | null;
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
  // 110% ENHANCEMENTS
  private hookExecutor: HookExecutor;
  private slackNotifier: SlackNotifier | null;
  private memoryMonitor: MemoryMonitor | null;
  private dataMasker: DataMasker | null;

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
    // NOTE: 'public' is a placeholder — initialize() replaces it with
    // adapter.getDefaultSchema() for non-PostgreSQL databases.
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

    this.adapter = null;
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
      // CRITICAL FIX: Reduced from 500 to 10 for crash safety
      autoSaveThreshold: 10,
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

    // 110% ENHANCEMENTS: Initialize new components
    this.hookExecutor = new HookExecutor();

    this.slackNotifier = this.config.slackNotifications
      ? new SlackNotifier(this.config.slackNotifications)
      : null;

    this.memoryMonitor = this.config.memoryMonitoring
      ? new MemoryMonitor({
          ...this.config.memoryMonitoring,
          onWarning: (snapshot, level) => {
            const message = `Memory ${level}: ${(snapshot.heapUsed / 1024 / 1024).toFixed(2)}MB used`;
            console.warn(message);
            if (this.slackNotifier) {
              this.slackNotifier.notify(
                message,
                level === 'critical' ? 'danger' : 'warning'
              );
            }
          },
        })
      : null;

    this.dataMasker = this.config.dataMasking?.enabled
      ? new DataMasker(this.config.dataMasking)
      : null;
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
   *
   * Creates the appropriate database adapter based on the connection string,
   * supporting PostgreSQL, MySQL, SQLite, and SQL Server.
   */
  async initialize(): Promise<void> {
    // Parse connection string to determine database type and create adapter
    const dbConfig = parseConnectionString(this.config.connectionString);
    this.adapter = createAdapter(dbConfig);

    // Connect to database
    try {
      await this.adapter.connect();
      // Test connection
      await this.adapter.testConnection();
    } catch (error: unknown) {
      throw new ConnectionError(
        `Failed to connect to ${dbConfig.type}: ${toError(error).message}`
      );
    }

    // Resolve multi-schema default now that adapter is available.
    // The constructor sets schemas to ['public'] as a placeholder;
    // replace it with the adapter's real default for non-PostgreSQL DBs.
    const adapterDefault = this.adapter.getDefaultSchema();
    if (
      this.multiSchemaConfig.schemas.length === 1 &&
      this.multiSchemaConfig.schemas[0] === 'public' &&
      adapterDefault !== 'public'
    ) {
      this.multiSchemaConfig.schemas = [adapterDefault];
    }

    // Initialize circuit breaker if configured
    const circuitBreaker = this.config.circuitBreaker?.enabled
      ? createConvexCircuitBreaker({
          failureThreshold: this.config.circuitBreaker.failureThreshold,
          resetTimeout: this.config.circuitBreaker.resetTimeoutMs,
        })
      : undefined;

    // Initialize table migrator with adapter
    this.tableMigrator = new TableMigrator(
      this.adapter,
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
        // 110% ENHANCEMENTS
        dataMasker: this.dataMasker,
        autoStreamingThreshold: this.config.autoStreamingThreshold || 100000,
        rollbackManager: this.rollbackManager,
        circuitBreaker,
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
    if (!this.adapter) {
      throw new DataMigrationError('Not initialized. Call initialize() first.');
    }

    const introspector = new SchemaIntrospector(this.adapter!);

    // Check if multi-schema is configured
    const defaultSchema = this.adapter!.getDefaultSchema();
    if (
      this.multiSchemaConfig.schemas.length > 1 ||
      (this.multiSchemaConfig.schemas.length === 1 &&
        this.multiSchemaConfig.schemas[0] !== defaultSchema)
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
      // Single schema introspection (use DB-appropriate default)
      const schema = await introspector.introspectSchema(
        this.adapter!.getDefaultSchema()
      );
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
    if (!this.adapter) {
      throw new DataMigrationError('Not initialized. Call initialize() first.');
    }

    const introspector = new SchemaIntrospector(this.adapter!);

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

    // 110% ENHANCEMENT: Start memory monitoring
    if (this.memoryMonitor) {
      this.memoryMonitor.start();
    }

    try {
      // 110% ENHANCEMENT: Execute pre-migration hooks
      if (this.config.hooks?.preMigration) {
        console.log('Executing pre-migration hooks...');
        await this.hookExecutor.executeHooks(this.config.hooks.preMigration, {
          MIGRATION_ID: 'starting',
          START_TIME: startTime.toISOString(),
        });
      }
      // Check if resuming
      let state: MigrationState | null = null;
      if (this.config.resume) {
        state = await this.stateManager.load();
        if (state) {
          // CRITICAL FIX: Load checkpoint to restore exact migration position
          const checkpoint = await this.stateManager.loadCheckpoint(
            state.migrationId
          );
          if (checkpoint) {
            this.emitEvent({
              type: 'migration:resume',
              timestamp: new Date(),
              migrationId: state.migrationId,
              data: {
                resumeFrom: checkpoint.tableName,
                processedRows: checkpoint.processedCount,
                checkpointTime: checkpoint.timestamp,
              },
            });
          }

          // Load existing ID mappings
          await this.idMapper.load();
          // Load rollback state if available
          await this.rollbackManager.load(state.migrationId);
        }
      }

      // Resolve migration order and check for circular dependencies
      const depResult = this.dependencyResolver.resolve(this.tables);
      if (depResult.circularDeps.length > 0) {
        // Warn about circular dependencies - they will be handled by nullable FK strategy
        this.emitEvent({
          type: 'warning',
          timestamp: new Date(),
          migrationId: state?.migrationId || 'initializing',
          data: {
            message: `Found ${depResult.circularDeps.length} circular dependencies`,
            circularDeps: depResult.circularDeps.map((c) => c.path.join(' → ')),
          },
        });
      }
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

      // 110% ENHANCEMENT: Send Slack notification
      if (this.slackNotifier) {
        await this.slackNotifier.notifyMigrationStart({
          migrationId: state.migrationId,
          totalTables: migrationOrder.length,
        });
      }

      // Check if parallel migration is enabled
      const parallelEnabled = this.extendedConfig.parallel?.enabled ?? false;

      if (parallelEnabled && !this.config.dryRun) {
        // Parallel migration
        const parallelResult = await this.migrateParallel();
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

      // 110% ENHANCEMENT: Send success notification
      if (!this.aborted && this.slackNotifier) {
        const successfulTables = tableResults.filter((t) => t.success).length;
        const totalMigrated = tableResults.reduce(
          (sum, t) => sum + t.migratedRows,
          0
        );
        const totalFailed = tableResults.reduce(
          (sum, t) => sum + t.failedRows,
          0
        );
        const duration = Date.now() - startTime.getTime();

        await this.slackNotifier.notifyMigrationComplete({
          migrationId: state.migrationId,
          duration,
          migratedRows: totalMigrated,
          failedRows: totalFailed,
          tablesCompleted: successfulTables,
        });
      }

      // 110% ENHANCEMENT: Execute post-migration success hooks
      if (!this.aborted && this.config.hooks?.postMigrationSuccess) {
        console.log('Executing post-migration success hooks...');
        await this.hookExecutor.executeHooks(
          this.config.hooks.postMigrationSuccess,
          {
            MIGRATION_ID: state.migrationId,
            END_TIME: new Date().toISOString(),
            SUCCESS: 'true',
          }
        );
      }
    } catch (error: unknown) {
      const err = toError(error);
      errors.push({
        code: 'UNKNOWN_ERROR',
        message: err.message,
        originalError: err,
        retryable: false,
      });

      this.stateManager.failMigration(err.message);
      const currentState = this.stateManager.getCurrentState();
      if (currentState) {
        await this.stateManager.save(currentState);

        // 110% ENHANCEMENT: Send failure notification
        if (this.slackNotifier) {
          const successfulTables = tableResults.filter((t) => t.success).length;
          const failedTables = tableResults.filter((t) => !t.success).length;

          await this.slackNotifier.notifyMigrationFailure({
            migrationId: currentState.migrationId,
            error: err.message,
            tablesCompleted: successfulTables,
            tablesFailed: failedTables,
          });
        }

        // 110% ENHANCEMENT: Execute post-migration failure hooks
        if (this.config.hooks?.postMigrationFailure) {
          console.log('Executing post-migration failure hooks...');
          await this.hookExecutor.executeHooks(
            this.config.hooks.postMigrationFailure,
            {
              MIGRATION_ID: currentState.migrationId,
              END_TIME: new Date().toISOString(),
              SUCCESS: 'false',
              ERROR: err.message,
            }
          );
        }
      }
    }

    // 110% ENHANCEMENT: Stop memory monitoring
    if (this.memoryMonitor) {
      this.memoryMonitor.stop();

      // Log memory stats
      const stats = this.memoryMonitor.getStats();
      console.log(
        `Memory Stats - Peak: ${(stats.peak.heapUsed / 1024 / 1024).toFixed(2)}MB, ` +
          `Avg: ${(stats.average.heapUsed / 1024 / 1024).toFixed(2)}MB`
      );
    }

    // Generate report
    const report = this.generateReport(startTime, tableResults, errors);

    // Print human-readable summary
    const summaryGenerator = new SummaryReportGenerator();
    const summary = summaryGenerator.createExtendedSummary(report, {
      batchSize: this.config.batchSize,
      rateLimit: this.config.rateLimit,
      parallel: this.extendedConfig.parallel?.enabled ?? false,
      dryRun: this.config.dryRun,
    });
    printSummaryToConsole(summary);

    return report;
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

      // Execute pre-table hooks
      if (this.config.hooks?.preTable) {
        await this.hookExecutor.executeHooks(this.config.hooks.preTable, {
          MIGRATION_ID: state.migrationId,
          TABLE_NAME: tableName,
        });
      }

      // Migrate table
      const result = await this.tableMigrator!.migrate(table);
      tableResults.push(result);

      // Execute post-table hooks
      if (this.config.hooks?.postTable) {
        await this.hookExecutor.executeHooks(this.config.hooks.postTable, {
          MIGRATION_ID: state.migrationId,
          TABLE_NAME: tableName,
          SUCCESS: String(result.success),
          MIGRATED_ROWS: String(result.migratedRows),
          FAILED_ROWS: String(result.failedRows),
        });
      }

      // Save state after each table
      await this.stateManager.save(state);
      await this.idMapper.save();
    }
  }

  /**
   * Parallel migration using ParallelMigrator
   */
  private async migrateParallel(): Promise<ParallelMigrationResult> {
    if (!this.parallelMigrator) {
      const maxParallelTables =
        this.extendedConfig.parallel?.maxParallelTables ?? 4;

      this.parallelMigrator = new ParallelMigrator(
        this.adapter!,
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
          // 110% ENHANCEMENTS
          dataMasker: this.dataMasker ?? undefined,
          autoStreamingThreshold: this.config.autoStreamingThreshold || 100000,
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
    if (!this.adapter) return 0;
    try {
      // Use first schema from multi-schema config or adapter's default
      const schema =
        this.multiSchemaConfig.schemas[0] || this.adapter!.getDefaultSchema();
      return await this.adapter.getTableRowCount(schema, tableName);
    } catch {
      return 0;
    }
  }

  /**
   * Rollback the migration
   * Deletes all migrated documents from Convex using generated mutations
   */
  async rollback(options: RollbackOptions = {}): Promise<RollbackResult> {
    // Create a client adapter for the rollback manager
    // Uses the actual ConvexHttpClient delete methods
    const rollbackClient = {
      delete: async (
        tableName: string,
        documentId: ConvexId
      ): Promise<void> => {
        if (options.dryRun) {
          return; // Don't actually delete in dry run
        }
        await this.convexClient.delete(tableName, documentId);
      },
      batchDelete: async (
        tableName: string,
        documentIds: ConvexId[]
      ): Promise<number> => {
        if (options.dryRun) {
          return documentIds.length; // Pretend we deleted them
        }
        return this.convexClient.batchDelete(tableName, documentIds);
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
        this.adapter!,
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
    if (this.adapter) {
      await this.adapter.disconnect();
      this.adapter = null;
    }
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
