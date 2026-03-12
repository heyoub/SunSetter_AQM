/**
 * Table Migrator - Production-Quality Implementation
 *
 * Handles migration of any SQL database table to Convex with:
 * - Streaming large result sets (cursor-based pagination via adapter)
 * - Optimal memory management with configurable high-water marks
 * - Intelligent batch sizing that respects Convex rate limits
 * - Exponential backoff with jitter for retries
 * - Progress tracking and event emission
 * - Graceful abort handling with checkpoint saving
 * - Multi-database support (PostgreSQL, MySQL, SQLite, SQL Server)
 */

import type { DatabaseAdapter } from '../adapters/base.js';
import type { TableInfo } from '../introspector/schema-introspector.js';
import type {
  PostgresRow,
  ConvexDocument,
  PostgresId,
  ConvexId,
  IConvexClient,
  IIdMapper,
  TableMigrationOptions,
  MigrationError,
  TokenBucket,
  MigrationEvent,
  MigrationEventHandler,
  TableMigrationResult,
  TableMigrationMetrics,
} from './types.js';
import { DataTransformer } from './data-transformer.js';
import { MigrationStateManager } from './migration-state.js';
import {
  DataMigrationError,
  RateLimitError,
  ERROR_CODES,
  isRetryableError,
} from '../cli/errors/index.js';
import { toError } from '../utils/errors.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import type { RollbackManager } from './rollback-manager.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Table migration configuration with performance tuning options
 */
export interface TableMigratorConfig {
  /** Base batch size for inserts (will be adjusted dynamically) */
  batchSize: number;
  /** Maximum retries per batch */
  maxRetries: number;
  /** Base retry delay in ms (will use exponential backoff) */
  retryDelayMs: number;
  /** Rate limit (requests per second to Convex) */
  rateLimit: number;
  /** Preview mode - no actual writes */
  dryRun: boolean;
  /** Memory high-water mark for streaming (bytes) */
  streamHighWaterMark: number;
  /** Maximum concurrent batch operations */
  concurrency: number;
  /** Minimum batch size (won't go below this even with rate limiting) */
  minBatchSize: number;
  /** Maximum batch size */
  maxBatchSize: number;
  /** Enable adaptive batch sizing */
  adaptiveBatching: boolean;
  /** Memory threshold for GC hint (bytes) */
  memoryThreshold: number;
  /** Maximum batch size in bytes (default: 1MB) */
  maxBatchSizeBytes: number;
  /** Enable batch size validation by bytes */
  validateBatchSizeByBytes: boolean;
  /** Circuit breaker for Convex API call protection */
  circuitBreaker?: CircuitBreaker;
}

/**
 * Default configuration optimized for production use
 */
const DEFAULT_CONFIG: TableMigratorConfig = {
  batchSize: 100,
  maxRetries: 5,
  retryDelayMs: 1000,
  rateLimit: 100,
  dryRun: false,
  streamHighWaterMark: 16 * 1024, // 16KB
  concurrency: 5,
  minBatchSize: 10,
  maxBatchSize: 500,
  adaptiveBatching: true,
  memoryThreshold: 100 * 1024 * 1024, // 100MB
  maxBatchSizeBytes: 1 * 1024 * 1024, // 1MB
  validateBatchSizeByBytes: true,
};

// ============================================================================
// Result Types
// ============================================================================

// TableMigrationResult is imported from ./types.js
export type { TableMigrationResult, TableMigrationMetrics };

/**
 * Batch processing result with timing metrics
 */
interface BatchResult {
  success: boolean;
  insertedCount: number;
  failedCount: number;
  durationMs: number;
  retries: number;
  errors: MigrationError[];
  insertedIdsByIndex: Map<number, ConvexId>;
}

// ============================================================================
// Main Table Migrator Class
// ============================================================================

/**
 * Production-quality table migrator with streaming and optimal batch handling
 */
export class TableMigrator {
  private config: TableMigratorConfig;
  private adapter: DatabaseAdapter;
  private convexClient: IConvexClient;
  private idMapper: IIdMapper;
  private transformer: DataTransformer;
  private stateManager: MigrationStateManager;
  private tokenBucket: TokenBucket;
  private eventHandlers: MigrationEventHandler[] = [];
  private aborted: boolean = false;
  // 110% ENHANCEMENTS
  private dataMasker: import('./data-masking.js').DataMasker | null = null;
  private autoStreamingThreshold: number;
  private rollbackManager: RollbackManager | null = null;
  private circuitBreaker?: CircuitBreaker;

  // Adaptive batching state
  private currentBatchSize: number;
  private successStreak: number = 0;
  private failureCount: number = 0;
  private lastRateLimitTime: number = 0;

  // Metrics
  private peakMemoryUsage: number = 0;
  private totalBatches: number = 0;
  private retriedBatches: number = 0;

  constructor(
    adapter: DatabaseAdapter,
    convexClient: IConvexClient,
    idMapper: IIdMapper,
    transformer: DataTransformer,
    stateManager: MigrationStateManager,
    config: Partial<TableMigratorConfig> & {
      dataMasker?: import('./data-masking.js').DataMasker | null;
      autoStreamingThreshold?: number;
      rollbackManager?: RollbackManager | null;
      sharedTokenBucket?: TokenBucket;
    } = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.adapter = adapter;
    this.convexClient = convexClient;
    this.idMapper = idMapper;
    this.transformer = transformer;
    this.stateManager = stateManager;
    this.currentBatchSize = this.config.batchSize;
    // 110% ENHANCEMENTS
    this.dataMasker = config.dataMasker || null;
    this.autoStreamingThreshold = config.autoStreamingThreshold || 100000;
    this.rollbackManager = config.rollbackManager || null;
    this.circuitBreaker = config.circuitBreaker;

    // Use shared token bucket if provided (for parallel migration),
    // otherwise create an independent one
    this.tokenBucket = config.sharedTokenBucket || {
      tokens: this.config.rateLimit,
      maxTokens: this.config.rateLimit,
      refillRate: this.config.rateLimit,
      lastRefill: Date.now(),
    };
  }

  // ==================== EVENT HANDLING ====================

  /**
   * Register event handler
   */
  onEvent(handler: MigrationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit an event to all handlers
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
   * Abort the migration gracefully
   */
  abort(): void {
    this.aborted = true;
  }

  // ==================== MAIN MIGRATION LOGIC ====================

  /**
   * Migrate a single table using streaming for memory efficiency
   *
   * Uses the database adapter's streamRows() method for cross-database
   * compatibility (PostgreSQL, MySQL, SQLite, SQL Server).
   */
  async migrate(
    table: TableInfo,
    options: TableMigrationOptions = {}
  ): Promise<TableMigrationResult> {
    const startTime = Date.now();
    const result: TableMigrationResult = {
      tableName: table.tableName,
      success: false,
      totalRows: 0,
      migratedRows: 0,
      failedRows: 0,
      skippedRows: 0,
      duration: 0,
      errors: [],
      metrics: {
        avgRowsPerSecond: 0,
        peakMemoryMB: 0,
        totalBatches: 0,
        retriedBatches: 0,
      },
    };

    this.aborted = false;
    this.resetMetrics();

    // Use schema from table info, fallback to adapter's default schema
    const schema = table.schemaName || this.adapter.getDefaultSchema();

    try {
      // Get total row count for progress tracking using adapter
      result.totalRows = await this.adapter.getTableRowCount(
        schema,
        table.tableName
      );

      // 110% ENHANCEMENT: Auto-enable streaming mode for large tables
      if (result.totalRows >= this.autoStreamingThreshold) {
        console.log(
          `Auto-enabling streaming mode for ${table.tableName} (${result.totalRows.toLocaleString()} rows)`
        );
        if (this.idMapper.isStreamingMode && !this.idMapper.isStreamingMode()) {
          this.idMapper.enableStreamingMode?.();
        }
      }

      // Emit table start event
      this.emit({
        type: 'table:start',
        table: table.tableName,
        data: { totalRows: result.totalRows },
      });

      // Update state manager
      this.stateManager.startTable(table.tableName, result.totalRows);

      // Get primary key column for cursor pagination
      const pkColumn = this.getPrimaryKeyColumn(table, options);

      // Check for resume point
      const tableProgress = this.stateManager
        .getCurrentState()
        ?.tables.get(table.tableName);
      const startCursor = tableProgress?.lastProcessedId;

      // Calculate optimal batch size based on row estimate
      this.adjustBatchSize(result.totalRows);

      // Process using adapter's streaming for all table sizes
      await this.migrateWithAdapterStreaming(
        table,
        schema,
        pkColumn,
        startCursor,
        options,
        result
      );

      // Finalize result
      this.finalizeResult(result, startTime);
    } catch (error: unknown) {
      const err = toError(error);
      const migrationError: MigrationError = {
        code: 'UNKNOWN_ERROR',
        message: err.message,
        table: table.tableName,
        originalError: err,
        retryable: false,
      };
      result.errors.push(migrationError);
      this.stateManager.failTable(table.tableName, err.message);

      this.emit({
        type: 'table:error',
        table: table.tableName,
        error: migrationError,
      });
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Migrate using adapter's streamRows() for cross-database compatibility
   *
   * Uses cursor-based pagination with the database adapter abstraction,
   * supporting all database types (PostgreSQL, MySQL, SQLite, SQL Server).
   */
  private async migrateWithAdapterStreaming(
    table: TableInfo,
    schema: string,
    pkColumn: string,
    startCursor: PostgresId | undefined,
    options: TableMigrationOptions,
    result: TableMigrationResult
  ): Promise<void> {
    let batchNumber = 0;
    const batchSize = options.batchSize || this.currentBatchSize;

    // Stream rows using the adapter
    for await (const batch of this.adapter.streamRows(schema, table.tableName, {
      batchSize,
      cursor: startCursor,
      orderBy: pkColumn,
      orderDirection: 'ASC',
    })) {
      if (this.aborted) {
        break;
      }

      const rows = batch.rows as PostgresRow[];
      if (rows.length === 0) {
        break;
      }

      batchNumber++;
      this.totalBatches++;

      // Check memory and trigger GC if needed
      this.checkMemory();

      this.emit({
        type: 'batch:start',
        table: table.tableName,
        batch: batchNumber,
        data: { rowCount: rows.length, totalFetched: batch.totalFetched },
      });

      // Transform rows to documents
      const {
        documents,
        errors: transformErrors,
        skipped,
      } = this.transformer.transformBatch(rows, table, options);

      result.skippedRows += skipped;
      result.errors.push(...transformErrors);

      // 110% ENHANCEMENT: Apply data masking if configured
      let maskedDocuments = documents;
      if (
        this.dataMasker &&
        this.dataMasker.hasMaskingForTable(table.tableName)
      ) {
        maskedDocuments = this.dataMasker.maskDocuments(
          table.tableName,
          documents as Array<Record<string, unknown>>
        ) as ConvexDocument[];
      }

      // CRITICAL FIX: Validate batch size by bytes if enabled
      if (this.config.validateBatchSizeByBytes && maskedDocuments.length > 0) {
        const batchSizeBytes = this.calculateBatchSizeBytes(maskedDocuments);
        if (batchSizeBytes > this.config.maxBatchSizeBytes) {
          // Split batch into smaller chunks
          const chunkedDocuments = this.splitBatchBySize(
            maskedDocuments,
            rows,
            this.config.maxBatchSizeBytes
          );

          this.emit({
            type: 'warning',
            table: table.tableName,
            data: {
              message: `Batch size (${(batchSizeBytes / 1024 / 1024).toFixed(2)}MB) exceeds limit (${(this.config.maxBatchSizeBytes / 1024 / 1024).toFixed(2)}MB). Split into ${chunkedDocuments.length} chunks.`,
            },
          });

          // Process each chunk separately
          for (
            let chunkIdx = 0;
            chunkIdx < chunkedDocuments.length;
            chunkIdx++
          ) {
            const chunk = chunkedDocuments[chunkIdx];
            if (this.config.dryRun) {
              result.migratedRows += chunk.documents.length;
            } else {
              const batchResult = await this.insertBatchWithRetry(
                table,
                chunk.rows,
                chunk.documents,
                options,
                batchNumber + chunkIdx
              );

              result.migratedRows += batchResult.insertedCount;
              result.failedRows += batchResult.failedCount;
              result.errors.push(...batchResult.errors);
              this.retriedBatches += batchResult.retries > 0 ? 1 : 0;

              this.storeIdMappings(
                table.tableName,
                chunk.rows,
                batchResult.insertedIdsByIndex,
                table,
                options
              );
            }
          }
          // Skip normal processing for this batch
          continue;
        }
      }

      // Insert batch with retry (use masked documents)
      if (!this.config.dryRun && maskedDocuments.length > 0) {
        const batchResult = await this.insertBatchWithRetry(
          table,
          rows,
          maskedDocuments,
          options,
          batchNumber
        );

        result.migratedRows += batchResult.insertedCount;
        result.failedRows += batchResult.failedCount;
        result.errors.push(...batchResult.errors);
        this.retriedBatches += batchResult.retries > 0 ? 1 : 0;

        // Store ID mappings
        this.storeIdMappings(
          table.tableName,
          rows,
          batchResult.insertedIdsByIndex,
          table,
          options
        );
      } else if (this.config.dryRun) {
        result.migratedRows += maskedDocuments.length;
      }

      // Update cursor position for state tracking
      if (rows.length > 0) {
        const lastProcessedId = this.transformer.getPrimaryKeyValue(
          rows[rows.length - 1],
          table,
          options
        ) as PostgresId;

        this.stateManager.recordRowProgress(
          table.tableName,
          result.migratedRows,
          lastProcessedId
        );
      }

      // Emit progress event
      this.emit({
        type: 'batch:complete',
        table: table.tableName,
        batch: batchNumber,
        data: {
          processed: rows.length,
          migrated: result.migratedRows,
          failed: result.failedRows,
          totalFetched: batch.totalFetched,
        },
      });

      // Rate limiting
      await this.waitForTokens(documents.length);

      // Check if this was the last batch
      if (batch.isLastBatch) {
        break;
      }
    }

    // Mark complete or aborted
    if (this.aborted) {
      this.stateManager.failTable(table.tableName, 'Migration aborted');
      result.errors.push({
        code: 'UNKNOWN_ERROR',
        message: 'Migration aborted by user',
        table: table.tableName,
        retryable: false,
      });
    } else if (result.failedRows > 0) {
      this.stateManager.failTable(
        table.tableName,
        `${result.failedRows} rows failed to migrate`
      );
    } else {
      this.stateManager.completeTable(table.tableName);
      result.success = true;
    }

    // Emit table complete
    this.emit({
      type: result.success ? 'table:complete' : 'table:error',
      table: table.tableName,
      data: {
        migrated: result.migratedRows,
        failed: result.failedRows,
        skipped: result.skippedRows,
      },
      error: result.errors[0],
    });
  }

  // ==================== BATCH INSERT WITH RETRY ====================

  /**
   * Insert batch with exponential backoff and jitter
   */
  private async insertBatchWithRetry(
    table: TableInfo,
    rows: PostgresRow[],
    documents: ConvexDocument[],
    options: TableMigrationOptions,
    batchNumber: number
  ): Promise<BatchResult> {
    const result: BatchResult = {
      success: false,
      insertedCount: 0,
      failedCount: 0,
      durationMs: 0,
      retries: 0,
      errors: [],
      insertedIdsByIndex: new Map(),
    };

    const startTime = Date.now();
    let lastError: Error | null = null;

    // Log batch progress for large migrations
    if (batchNumber > 0 && batchNumber % 100 === 0) {
      console.log(`  [${table.tableName}] Processing batch ${batchNumber}...`);
    }

    // Trigger checkpoint hint every 50 batches for resumability
    if (
      options.checkpointCallback &&
      batchNumber > 0 &&
      batchNumber % 50 === 0
    ) {
      options.checkpointCallback(table.tableName, batchNumber);
    }

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const ids = this.circuitBreaker
          ? await this.circuitBreaker.execute(() => this.convexClient.batchInsert(table.tableName, documents))
          : await this.convexClient.batchInsert(table.tableName, documents);

        // Success!
        result.success = true;
        result.insertedCount = ids.length;

        for (let i = 0; i < ids.length; i++) {
          result.insertedIdsByIndex.set(i, ids[i]);
        }

        // Update adaptive batching
        this.onBatchSuccess();

        result.durationMs = Date.now() - startTime;
        return result;
      } catch (error: unknown) {
        lastError = toError(error);
        result.retries = attempt + 1;

        // Check if we should retry
        if (!this.shouldRetry(error, attempt)) {
          break;
        }

        // Handle rate limiting specially
        if (this.isRateLimitError(error)) {
          this.onRateLimitHit();
          const waitTime = this.getRateLimitBackoff(toError(error));
          await this.sleep(waitTime);
          continue;
        }

        // Exponential backoff with jitter
        const delay = this.calculateBackoff(attempt);
        await this.sleep(delay);
      }
    }

    // Batch insert failed - try individual inserts
    if (lastError && result.insertedCount === 0) {
      const individualResult = await this.insertIndividually(
        table,
        rows,
        documents,
        options
      );

      result.insertedCount = individualResult.insertedCount;
      result.failedCount = individualResult.failedCount;
      result.errors = individualResult.errors;
      result.insertedIdsByIndex = individualResult.insertedIdsByIndex;
      result.success = individualResult.failedCount === 0;

      this.onBatchFailure();
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  /**
   * Insert documents individually as fallback
   */
  private async insertIndividually(
    table: TableInfo,
    rows: PostgresRow[],
    documents: ConvexDocument[],
    options: TableMigrationOptions
  ): Promise<BatchResult> {
    const result: BatchResult = {
      success: true,
      insertedCount: 0,
      failedCount: 0,
      durationMs: 0,
      retries: 0,
      errors: [],
      insertedIdsByIndex: new Map(),
    };

    const startTime = Date.now();
    let skippedCount = 0;

    for (let i = 0; i < documents.length; i++) {
      // Apply custom row validation if provided
      if (options.validateRow) {
        const isValid = options.validateRow(rows[i] as Record<string, unknown>);
        if (!isValid) {
          skippedCount++;
          this.emit({
            type: 'row:skip',
            table: table.tableName,
            row: i,
            data: { reason: 'Failed custom validation' },
          });
          continue;
        }
      }

      try {
        const id = await this.convexClient.insert(
          table.tableName,
          documents[i]
        );
        result.insertedCount++;
        result.insertedIdsByIndex.set(i, id);

        this.emit({
          type: 'row:success',
          table: table.tableName,
          row: i,
          data: { convexId: id },
        });

        // Brief pause between individual inserts for rate limiting
        if (i > 0 && i % 10 === 0) {
          await this.waitForTokens(10);
        }
      } catch (error: unknown) {
        const err = toError(error);
        result.failedCount++;
        const migrationError: MigrationError = {
          code: 'INSERT_ERROR',
          message: err.message,
          table: table.tableName,
          row: i,
          originalError: err,
          retryable: isRetryableError(err),
        };
        result.errors.push(migrationError);

        // Call custom error handler if provided
        if (options.onRowError) {
          options.onRowError(
            rows[i] as Record<string, unknown>,
            err
          );
        }

        this.emit({
          type: 'row:error',
          table: table.tableName,
          row: i,
          error: migrationError,
        });
      }
    }

    // Log skipped rows summary
    if (skippedCount > 0) {
      console.log(
        `  [${table.tableName}] Skipped ${skippedCount} rows due to validation`
      );
    }

    result.success = result.failedCount === 0;
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // ==================== HELPER METHODS ====================

  /**
   * Get primary key column name
   */
  private getPrimaryKeyColumn(
    table: TableInfo,
    options: TableMigrationOptions
  ): string {
    if (options.primaryKey) {
      return options.primaryKey;
    }

    if (options.cursorField) {
      return options.cursorField;
    }

    const pkColumn = table.columns.find((c) => c.isPrimaryKey);
    if (pkColumn) {
      return pkColumn.columnName;
    }

    const commonPks = ['id', '_id', `${table.tableName}_id`];
    for (const pk of commonPks) {
      if (table.columns.some((c) => c.columnName === pk)) {
        return pk;
      }
    }

    throw new DataMigrationError(
      `Cannot determine primary key for table ${table.tableName}`,
      ERROR_CODES.PRIMARY_KEY_MISSING,
      { details: { table: table.tableName } }
    );
  }

  /**
   * Store ID mappings for successfully inserted documents
   */
  private storeIdMappings(
    tableName: string,
    rows: PostgresRow[],
    insertedIdsByIndex: Map<number, ConvexId>,
    table: TableInfo,
    options: TableMigrationOptions
  ): void {
    for (const [rowIndex, convexId] of insertedIdsByIndex) {
      if (rowIndex < rows.length) {
        const pgId = this.transformer.getPrimaryKeyValue(
          rows[rowIndex],
          table,
          options
        );
        if (pgId !== null && pgId !== undefined) {
          this.idMapper.set(tableName, pgId as PostgresId, convexId);
          // Record for rollback capability
          if (this.rollbackManager) {
            this.rollbackManager.recordMigratedRow(tableName, pgId as PostgresId, convexId);
          }
          this.stateManager.storeIdMapping(
            tableName,
            pgId as PostgresId,
            convexId
          );
        }
      }
    }
  }

  // ==================== RATE LIMITING ====================

  /**
   * Wait for rate limit tokens using token bucket algorithm
   */
  private async waitForTokens(count: number): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.tokenBucket.lastRefill) / 1000;

    // Refill tokens
    this.tokenBucket.tokens = Math.min(
      this.tokenBucket.maxTokens,
      this.tokenBucket.tokens + elapsed * this.tokenBucket.refillRate
    );
    this.tokenBucket.lastRefill = now;

    // Wait if not enough tokens
    if (this.tokenBucket.tokens < count) {
      const tokensNeeded = count - this.tokenBucket.tokens;
      const waitTime = (tokensNeeded / this.tokenBucket.refillRate) * 1000;
      await this.sleep(waitTime);

      // Recalculate after wait
      const afterWait = Date.now();
      const waitElapsed = (afterWait - this.tokenBucket.lastRefill) / 1000;
      this.tokenBucket.tokens = Math.min(
        this.tokenBucket.maxTokens,
        this.tokenBucket.tokens + waitElapsed * this.tokenBucket.refillRate
      );
      this.tokenBucket.lastRefill = afterWait;
    }

    // Consume tokens
    this.tokenBucket.tokens -= count;
  }

  // ==================== ADAPTIVE BATCHING ====================

  /**
   * Adjust batch size based on table size and history
   */
  private adjustBatchSize(totalRows: number): void {
    if (!this.config.adaptiveBatching) {
      this.currentBatchSize = this.config.batchSize;
      return;
    }

    // Start with configured batch size
    let size = this.config.batchSize;

    // Adjust based on table size
    if (totalRows < 100) {
      size = Math.min(size, 25);
    } else if (totalRows < 1000) {
      size = Math.min(size, 50);
    } else if (totalRows > 100000) {
      size = Math.max(size, 200);
    }

    // Clamp to min/max
    this.currentBatchSize = Math.max(
      this.config.minBatchSize,
      Math.min(this.config.maxBatchSize, size)
    );
  }

  /**
   * Handle successful batch
   */
  private onBatchSuccess(): void {
    this.successStreak++;
    this.failureCount = 0;

    // Increase batch size after consistent success
    if (this.config.adaptiveBatching && this.successStreak >= 5) {
      this.currentBatchSize = Math.min(
        this.config.maxBatchSize,
        Math.floor(this.currentBatchSize * 1.2)
      );
      this.successStreak = 0;
    }
  }

  /**
   * Handle failed batch
   */
  private onBatchFailure(): void {
    this.successStreak = 0;
    this.failureCount++;

    // Reduce batch size after failures
    if (this.config.adaptiveBatching) {
      this.currentBatchSize = Math.max(
        this.config.minBatchSize,
        Math.floor(this.currentBatchSize * 0.7)
      );
    }
  }

  /**
   * Handle rate limit hit
   */
  private onRateLimitHit(): void {
    this.lastRateLimitTime = Date.now();

    // Significantly reduce batch size on rate limit
    if (this.config.adaptiveBatching) {
      this.currentBatchSize = Math.max(
        this.config.minBatchSize,
        Math.floor(this.currentBatchSize * 0.5)
      );
    }
  }

  // ==================== RETRY LOGIC ====================

  /**
   * Check if error is retryable
   */
  private shouldRetry(error: unknown, attempt: number): boolean {
    if (attempt >= this.config.maxRetries) return false;
    return isRetryableError(toError(error));
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    const message = toError(error).message?.toLowerCase() || '';
    return (
      message.includes('rate limit') ||
      message.includes('429') ||
      error instanceof RateLimitError
    );
  }

  /**
   * Get rate limit backoff time
   */
  private getRateLimitBackoff(error: Error): number {
    if (error instanceof RateLimitError && error.retryAfterMs) {
      return error.retryAfterMs;
    }
    return 5000; // Default 5 second wait for rate limits
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoff(attempt: number): number {
    const baseDelay = this.config.retryDelayMs;
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  // ==================== MEMORY MANAGEMENT ====================

  /**
   * Check memory usage and hint GC if needed
   */
  private checkMemory(): void {
    const usage = process.memoryUsage();
    this.peakMemoryUsage = Math.max(this.peakMemoryUsage, usage.heapUsed);

    if (usage.heapUsed > this.config.memoryThreshold) {
      // Hint to GC (not guaranteed but can help)
      if (global.gc) {
        global.gc();
      }
    }
  }

  /**
   * Reset metrics for new migration
   */
  private resetMetrics(): void {
    this.peakMemoryUsage = 0;
    this.totalBatches = 0;
    this.retriedBatches = 0;
    this.successStreak = 0;
    this.failureCount = 0;
    this.currentBatchSize = this.config.batchSize;
  }

  /**
   * Finalize result with metrics
   */
  private finalizeResult(
    result: TableMigrationResult,
    startTime: number
  ): void {
    const duration = Date.now() - startTime;
    result.metrics = {
      avgRowsPerSecond:
        duration > 0 ? (result.migratedRows / duration) * 1000 : 0,
      peakMemoryMB: this.peakMemoryUsage / (1024 * 1024),
      totalBatches: this.totalBatches,
      retriedBatches: this.retriedBatches,
    };
  }

  // ==================== BATCH SIZE VALIDATION ====================

  /**
   * Calculate batch size in bytes (approximate)
   */
  private calculateBatchSizeBytes(documents: ConvexDocument[]): number {
    let totalBytes = 0;
    for (const doc of documents) {
      // Approximate size using JSON serialization
      totalBytes += JSON.stringify(doc).length;
    }
    return totalBytes;
  }

  /**
   * Split batch into smaller chunks based on byte size
   */
  private splitBatchBySize(
    documents: ConvexDocument[],
    rows: PostgresRow[],
    maxBytes: number
  ): Array<{ documents: ConvexDocument[]; rows: PostgresRow[] }> {
    const chunks: Array<{ documents: ConvexDocument[]; rows: PostgresRow[] }> =
      [];
    let currentDocs: ConvexDocument[] = [];
    let currentRows: PostgresRow[] = [];
    let currentSize = 0;

    for (let i = 0; i < documents.length; i++) {
      const docSize = JSON.stringify(documents[i]).length;

      if (currentSize + docSize > maxBytes && currentDocs.length > 0) {
        // Start new chunk
        chunks.push({ documents: currentDocs, rows: currentRows });
        currentDocs = [];
        currentRows = [];
        currentSize = 0;
      }

      currentDocs.push(documents[i]);
      currentRows.push(rows[i]);
      currentSize += docSize;
    }

    // Add remaining
    if (currentDocs.length > 0) {
      chunks.push({ documents: currentDocs, rows: currentRows });
    }

    return chunks;
  }

  // ==================== UTILITIES ====================

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Validate table before migration
   */
  async validate(
    table: TableInfo
  ): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    const schema = table.schemaName || this.adapter.getDefaultSchema();

    // Check if table exists
    try {
      await this.adapter.getTableRowCount(schema, table.tableName);
    } catch {
      issues.push(
        `Table ${table.tableName} does not exist or is not accessible`
      );
      return { valid: false, issues };
    }

    // Check primary key
    try {
      this.getPrimaryKeyColumn(table, {});
    } catch {
      issues.push(`Cannot determine primary key for ${table.tableName}`);
    }

    // Check foreign key dependencies
    for (const fk of table.foreignKeys) {
      if (fk.referencedTable === table.tableName) continue;

      const mappingCount = this.idMapper.countForTable(fk.referencedTable);
      if (mappingCount === 0) {
        const column = table.columns.find(
          (c) => c.columnName === fk.columnName
        );
        if (column && !column.isNullable) {
          issues.push(
            `Required FK ${fk.columnName} references ${fk.referencedTable} which hasn't been migrated yet`
          );
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
