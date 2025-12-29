/**
 * Table Migrator - Production-Quality Implementation
 *
 * Handles migration of a single table from PostgreSQL to Convex with:
 * - Streaming large result sets (cursor-based pagination)
 * - Optimal memory management with configurable high-water marks
 * - Intelligent batch sizing that respects Convex rate limits
 * - Exponential backoff with jitter for retries
 * - Progress tracking and event emission
 * - Graceful abort handling with checkpoint saving
 */

import type { Pool } from 'pg';
import { Readable, Transform } from 'stream';
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
// Streaming Infrastructure
// ============================================================================

/**
 * Creates a readable stream from PostgreSQL cursor
 * Uses cursor-based pagination for memory efficiency
 */
class PostgresCursorStream extends Readable {
  private pool: Pool;
  private tableName: string;
  private pkColumn: string;
  private lastId: PostgresId | undefined;
  private batchSize: number;
  private ended: boolean = false;
  private reading: boolean = false;

  constructor(
    pool: Pool,
    tableName: string,
    pkColumn: string,
    startAfter: PostgresId | undefined,
    batchSize: number,
    highWaterMark: number
  ) {
    super({ objectMode: true, highWaterMark });
    this.pool = pool;
    this.tableName = tableName;
    this.pkColumn = pkColumn;
    this.lastId = startAfter;
    this.batchSize = batchSize;
  }

  async _read(): Promise<void> {
    if (this.ended || this.reading) return;
    this.reading = true;

    try {
      const rows = await this.fetchBatch();

      if (rows.length === 0) {
        this.ended = true;
        this.push(null);
        return;
      }

      // Push rows one at a time for backpressure handling
      for (const row of rows) {
        const canContinue = this.push(row);
        if (!canContinue) {
          break;
        }
      }

      // Update cursor for next batch
      if (rows.length > 0) {
        this.lastId = rows[rows.length - 1][this.pkColumn] as PostgresId;
      }

      // If we got fewer rows than batch size, we're done
      if (rows.length < this.batchSize) {
        this.ended = true;
        this.push(null);
      }
    } catch (error) {
      this.destroy(error as Error);
    } finally {
      this.reading = false;
    }
  }

  private async fetchBatch(): Promise<PostgresRow[]> {
    let query: string;
    let params: (PostgresId | number)[];

    if (this.lastId !== undefined) {
      query = `
        SELECT * FROM "${this.tableName}"
        WHERE "${this.pkColumn}" > $1
        ORDER BY "${this.pkColumn}" ASC
        LIMIT $2
      `;
      params = [this.lastId, this.batchSize];
    } else {
      query = `
        SELECT * FROM "${this.tableName}"
        ORDER BY "${this.pkColumn}" ASC
        LIMIT $1
      `;
      params = [this.batchSize];
    }

    const result = await this.pool.query(query, params);
    return result.rows;
  }
}

/**
 * Transform stream that batches rows for insert
 */
class BatchTransform extends Transform {
  private batch: PostgresRow[] = [];
  private batchSize: number;

  constructor(batchSize: number) {
    super({ objectMode: true });
    this.batchSize = batchSize;
  }

  _transform(
    row: PostgresRow,
    _encoding: string,
    callback: (error?: Error | null, data?: PostgresRow[]) => void
  ): void {
    this.batch.push(row);

    if (this.batch.length >= this.batchSize) {
      const batch = this.batch;
      this.batch = [];
      callback(null, batch);
    } else {
      callback();
    }
  }

  _flush(callback: (error?: Error | null, data?: PostgresRow[]) => void): void {
    if (this.batch.length > 0) {
      callback(null, this.batch);
    } else {
      callback();
    }
  }
}

// ============================================================================
// Main Table Migrator Class
// ============================================================================

/**
 * Production-quality table migrator with streaming and optimal batch handling
 */
export class TableMigrator {
  private config: TableMigratorConfig;
  private pool: Pool;
  private convexClient: IConvexClient;
  private idMapper: IIdMapper;
  private transformer: DataTransformer;
  private stateManager: MigrationStateManager;
  private tokenBucket: TokenBucket;
  private eventHandlers: MigrationEventHandler[] = [];
  private aborted: boolean = false;

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
    pool: Pool,
    convexClient: IConvexClient,
    idMapper: IIdMapper,
    transformer: DataTransformer,
    stateManager: MigrationStateManager,
    config: Partial<TableMigratorConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pool = pool;
    this.convexClient = convexClient;
    this.idMapper = idMapper;
    this.transformer = transformer;
    this.stateManager = stateManager;
    this.currentBatchSize = this.config.batchSize;

    // Initialize token bucket for rate limiting
    this.tokenBucket = {
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

    try {
      // Get total row count for progress tracking
      result.totalRows = await this.getRowCount(table.tableName);

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
      const lastId = tableProgress?.lastProcessedId;

      // Calculate optimal batch size based on row estimate
      this.adjustBatchSize(result.totalRows);

      // Process using streaming or batched approach based on table size
      if (result.totalRows > 10000) {
        // Use streaming for large tables
        await this.migrateWithStreaming(
          table,
          pkColumn,
          lastId,
          options,
          result
        );
      } else {
        // Use simple batching for smaller tables
        await this.migrateWithBatching(
          table,
          pkColumn,
          lastId,
          options,
          result
        );
      }

      // Finalize result
      this.finalizeResult(result, startTime);
    } catch (error: unknown) {
      const migrationError: MigrationError = {
        code: 'UNKNOWN_ERROR',
        message: (error as Error).message,
        table: table.tableName,
        originalError: error as Error,
        retryable: false,
      };
      result.errors.push(migrationError);
      this.stateManager.failTable(table.tableName, (error as Error).message);

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
   * Migrate using streaming for large tables
   */
  private async migrateWithStreaming(
    table: TableInfo,
    pkColumn: string,
    startAfter: PostgresId | undefined,
    options: TableMigrationOptions,
    result: TableMigrationResult
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = new PostgresCursorStream(
        this.pool,
        table.tableName,
        pkColumn,
        startAfter,
        this.config.batchSize,
        this.config.streamHighWaterMark
      );

      const batcher = new BatchTransform(this.currentBatchSize);
      let batchNumber = 0;
      let lastProcessedId: PostgresId | undefined;

      const processBatch = async (rows: PostgresRow[]): Promise<void> => {
        if (this.aborted) {
          stream.destroy();
          return;
        }

        batchNumber++;
        this.totalBatches++;

        // Check memory and trigger GC if needed
        this.checkMemory();

        // Transform rows to documents
        const {
          documents,
          errors: transformErrors,
          skipped,
        } = this.transformer.transformBatch(rows, table, options);

        result.skippedRows += skipped;
        result.errors.push(...transformErrors);

        // Insert batch with retry
        if (!this.config.dryRun && documents.length > 0) {
          const batchResult = await this.insertBatchWithRetry(
            table,
            rows,
            documents,
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
          result.migratedRows += documents.length;
        }

        // Update cursor position
        if (rows.length > 0) {
          lastProcessedId = this.transformer.getPrimaryKeyValue(
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
          },
        });

        // Rate limiting
        await this.waitForTokens(documents.length);
      };

      stream
        .pipe(batcher)
        .on('data', async (batch: PostgresRow[]) => {
          batcher.pause();
          try {
            await processBatch(batch);
          } catch (error) {
            stream.destroy(error as Error);
          }
          batcher.resume();
        })
        .on('end', () => {
          if (!this.aborted) {
            this.stateManager.completeTable(table.tableName);
            result.success = result.failedRows === 0;
          }
          resolve();
        })
        .on('error', (error) => {
          reject(error);
        });

      // Handle abort
      if (this.aborted) {
        stream.destroy();
        resolve();
      }
    });
  }

  /**
   * Migrate using simple batching for smaller tables
   */
  private async migrateWithBatching(
    table: TableInfo,
    pkColumn: string,
    startAfter: PostgresId | undefined,
    options: TableMigrationOptions,
    result: TableMigrationResult
  ): Promise<void> {
    let lastId = startAfter;
    let batchNumber = 0;
    const batchSize = options.batchSize || this.currentBatchSize;

    while (!this.aborted) {
      // Fetch batch
      const rows = await this.fetchBatch(
        table.tableName,
        pkColumn,
        lastId,
        batchSize
      );

      if (rows.length === 0) {
        break;
      }

      batchNumber++;
      this.totalBatches++;

      // Check memory
      this.checkMemory();

      this.emit({
        type: 'batch:start',
        table: table.tableName,
        batch: batchNumber,
        data: { rowCount: rows.length },
      });

      // Transform rows
      const {
        documents,
        errors: transformErrors,
        skipped,
      } = this.transformer.transformBatch(rows, table, options);

      result.skippedRows += skipped;
      result.errors.push(...transformErrors);

      // Insert to Convex
      if (!this.config.dryRun && documents.length > 0) {
        const batchResult = await this.insertBatchWithRetry(
          table,
          rows,
          documents,
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
        result.migratedRows += documents.length;
      }

      // Update cursor
      if (rows.length > 0) {
        lastId = this.transformer.getPrimaryKeyValue(
          rows[rows.length - 1],
          table,
          options
        ) as PostgresId;
      }

      // Update state
      this.stateManager.recordRowProgress(
        table.tableName,
        result.migratedRows,
        lastId
      );

      // Emit batch complete
      this.emit({
        type: 'batch:complete',
        table: table.tableName,
        batch: batchNumber,
        data: {
          processed: documents.length,
          migrated: result.migratedRows,
          failed: result.failedRows,
        },
      });

      // Check if we're done
      if (rows.length < batchSize) {
        break;
      }

      // Rate limiting
      await this.waitForTokens(documents.length);
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
    _batchNumber: number
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

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const ids = await this.convexClient.batchInsert(
          table.tableName,
          documents
        );

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
        lastError = error as Error;
        result.retries = attempt + 1;

        // Check if we should retry
        if (!this.shouldRetry(error, attempt)) {
          break;
        }

        // Handle rate limiting specially
        if (this.isRateLimitError(error)) {
          this.onRateLimitHit();
          const waitTime = this.getRateLimitBackoff(error as Error);
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
    _options: TableMigrationOptions
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

    for (let i = 0; i < documents.length; i++) {
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
        result.failedCount++;
        const migrationError: MigrationError = {
          code: 'INSERT_ERROR',
          message: (error as Error).message,
          table: table.tableName,
          row: i,
          originalError: error as Error,
          retryable: isRetryableError(error as Error),
        };
        result.errors.push(migrationError);

        this.emit({
          type: 'row:error',
          table: table.tableName,
          row: i,
          error: migrationError,
        });
      }
    }

    result.success = result.failedCount === 0;
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // ==================== HELPER METHODS ====================

  /**
   * Get row count for a table
   */
  private async getRowCount(tableName: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*) as count FROM "${tableName}"`
    );
    return parseInt(result.rows[0].count, 10);
  }

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
   * Fetch a batch of rows using cursor-based pagination
   */
  private async fetchBatch(
    tableName: string,
    pkColumn: string,
    lastId: PostgresId | undefined,
    batchSize: number
  ): Promise<PostgresRow[]> {
    let query: string;
    let params: (PostgresId | number)[];

    if (lastId !== undefined) {
      query = `
        SELECT * FROM "${tableName}"
        WHERE "${pkColumn}" > $1
        ORDER BY "${pkColumn}" ASC
        LIMIT $2
      `;
      params = [lastId, batchSize];
    } else {
      query = `
        SELECT * FROM "${tableName}"
        ORDER BY "${pkColumn}" ASC
        LIMIT $1
      `;
      params = [batchSize];
    }

    const result = await this.pool.query(query, params);
    return result.rows;
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
    return isRetryableError(error as Error);
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    const message = (error as Error).message?.toLowerCase() || '';
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

    // Check if table exists
    try {
      await this.getRowCount(table.tableName);
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
