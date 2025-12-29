/**
 * ID Mapper
 *
 * Manages the mapping between PostgreSQL IDs and Convex document IDs.
 * Essential for resolving foreign key references during migration.
 * Supports persistence for resumable migrations.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { PostgresId, ConvexId, IIdMapper, IdMapping } from './types.js';

/**
 * ID Mapper configuration options
 */
export interface IdMapperOptions {
  /** File path for persistence */
  persistPath?: string;
  /** Number of changes before auto-save (default: 1000) */
  autoSaveThreshold?: number;
  /** Use streaming mode for large migrations (default: false) */
  streamingMode?: boolean;
  /** Memory threshold in bytes before forcing a flush (default: 100MB) */
  memoryThreshold?: number;
  /** Directory for streaming chunks (default: .migration/id-chunks) */
  chunkDir?: string;
  /** Max mappings per chunk file (default: 100000) */
  chunkSize?: number;
}

/**
 * In-memory ID mapper with persistence support
 * Supports streaming mode for large migrations with millions of IDs
 */
export class IdMapper implements IIdMapper {
  /** Maps tableName -> (postgresId -> convexId) */
  private mappings: Map<string, Map<PostgresId, ConvexId>>;
  /** Optional file path for persistence */
  private persistPath?: string;
  /** Pending changes since last save */
  private pendingChanges: number;
  /** Auto-save threshold */
  private autoSaveThreshold: number;
  /** Streaming mode enabled */
  private streamingMode: boolean;
  /** Memory threshold for auto-flush */
  private memoryThreshold: number;
  /** Directory for chunk files in streaming mode */
  private chunkDir: string;
  /** Max mappings per chunk */
  private chunkSize: number;
  /** Current chunk number */
  private currentChunk: number;
  /** Stream for appending mappings */
  private appendStream: fsSync.WriteStream | null;
  /** Index of flushed chunks per table */
  private flushedChunks: Map<string, number[]>;

  constructor(options: IdMapperOptions = {}) {
    this.mappings = new Map();
    this.persistPath = options.persistPath;
    this.pendingChanges = 0;
    this.autoSaveThreshold = options.autoSaveThreshold || 1000;
    this.streamingMode = options.streamingMode || false;
    this.memoryThreshold = options.memoryThreshold || 100 * 1024 * 1024; // 100MB
    this.chunkDir = options.chunkDir || '.migration/id-chunks';
    this.chunkSize = options.chunkSize || 100000;
    this.currentChunk = 0;
    this.appendStream = null;
    this.flushedChunks = new Map();
  }

  /**
   * Register a new ID mapping
   */
  set(tableName: string, postgresId: PostgresId, convexId: ConvexId): void {
    let tableMap = this.mappings.get(tableName);
    if (!tableMap) {
      tableMap = new Map();
      this.mappings.set(tableName, tableMap);
    }

    tableMap.set(this.normalizeId(postgresId), convexId);
    this.pendingChanges++;

    // In streaming mode, check memory and flush if needed
    if (this.streamingMode) {
      this.checkMemoryAndFlush();
    }

    // Auto-save if threshold reached
    if (this.persistPath && this.pendingChanges >= this.autoSaveThreshold) {
      this.saveAsync().catch(console.error);
    }
  }

  /**
   * Check memory usage and flush to disk if needed (streaming mode)
   */
  private checkMemoryAndFlush(): void {
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > this.memoryThreshold) {
      this.flushToDisk().catch(console.error);
    }
  }

  /**
   * Flush in-memory mappings to disk chunks (streaming mode)
   */
  async flushToDisk(): Promise<void> {
    if (!this.streamingMode) return;

    // Create chunk directory if needed
    await fs.mkdir(this.chunkDir, { recursive: true });

    // Write each table's mappings to a chunk file
    for (const [tableName, tableMap] of this.mappings) {
      if (tableMap.size === 0) continue;

      const chunkPath = path.join(
        this.chunkDir,
        `${tableName}_chunk_${this.currentChunk}.jsonl`
      );

      // Write as JSON Lines format (one mapping per line)
      const lines: string[] = [];
      for (const [pgId, convexId] of tableMap) {
        lines.push(JSON.stringify({ p: pgId, c: convexId }));
      }

      await fs.appendFile(chunkPath, lines.join('\n') + '\n');

      // Track flushed chunks
      let chunks = this.flushedChunks.get(tableName);
      if (!chunks) {
        chunks = [];
        this.flushedChunks.set(tableName, chunks);
      }
      if (!chunks.includes(this.currentChunk)) {
        chunks.push(this.currentChunk);
      }
    }

    // Clear in-memory mappings after flush
    this.mappings.clear();
    this.currentChunk++;
    this.pendingChanges = 0;

    // Hint to GC
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Load mappings from chunk files (streaming mode)
   */
  async loadFromChunks(tableName: string): Promise<void> {
    if (!this.streamingMode) return;

    const chunks = this.flushedChunks.get(tableName) || [];
    let tableMap = this.mappings.get(tableName);
    if (!tableMap) {
      tableMap = new Map();
      this.mappings.set(tableName, tableMap);
    }

    for (const chunkNum of chunks) {
      const chunkPath = path.join(
        this.chunkDir,
        `${tableName}_chunk_${chunkNum}.jsonl`
      );

      try {
        const fileStream = fsSync.createReadStream(chunkPath);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (line.trim()) {
            const { p, c } = JSON.parse(line);
            tableMap.set(this.normalizeId(p), c);
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  /**
   * Enable streaming mode for large migrations
   */
  enableStreamingMode(options?: {
    chunkDir?: string;
    memoryThreshold?: number;
    chunkSize?: number;
  }): void {
    this.streamingMode = true;
    if (options?.chunkDir) this.chunkDir = options.chunkDir;
    if (options?.memoryThreshold) this.memoryThreshold = options.memoryThreshold;
    if (options?.chunkSize) this.chunkSize = options.chunkSize;
  }

  /**
   * Disable streaming mode
   */
  disableStreamingMode(): void {
    this.streamingMode = false;
  }

  /**
   * Check if streaming mode is enabled
   */
  isStreamingMode(): boolean {
    return this.streamingMode;
  }

  /**
   * Close any open streams (call on shutdown)
   */
  async close(): Promise<void> {
    if (this.appendStream) {
      return new Promise((resolve, reject) => {
        this.appendStream!.end((error: Error | undefined) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    // Final flush if in streaming mode
    if (this.streamingMode && this.count() > 0) {
      await this.flushToDisk();
    }
  }

  /**
   * Get Convex ID for a PostgreSQL ID
   */
  get(tableName: string, postgresId: PostgresId): ConvexId | undefined {
    const tableMap = this.mappings.get(tableName);
    if (!tableMap) return undefined;
    return tableMap.get(this.normalizeId(postgresId));
  }

  /**
   * Check if mapping exists
   */
  has(tableName: string, postgresId: PostgresId): boolean {
    const tableMap = this.mappings.get(tableName);
    if (!tableMap) return false;
    return tableMap.has(this.normalizeId(postgresId));
  }

  /**
   * Get all mappings for a table
   */
  getTableMappings(tableName: string): Map<PostgresId, ConvexId> {
    return this.mappings.get(tableName) || new Map();
  }

  /**
   * Get total mapping count
   */
  count(): number {
    let total = 0;
    for (const tableMap of this.mappings.values()) {
      total += tableMap.size;
    }
    return total;
  }

  /**
   * Get mapping count for a specific table
   */
  countForTable(tableName: string): number {
    const tableMap = this.mappings.get(tableName);
    return tableMap?.size || 0;
  }

  /**
   * Get all table names that have mappings
   */
  getTables(): string[] {
    return [...this.mappings.keys()];
  }

  /**
   * Clear all mappings for a table
   */
  clearTable(tableName: string): void {
    this.mappings.delete(tableName);
    this.pendingChanges++;
  }

  /**
   * Clear all mappings
   */
  clear(): void {
    this.mappings.clear();
    this.pendingChanges = 0;
  }

  /**
   * Resolve a foreign key value to Convex ID
   * Returns null if the FK value is null/undefined
   * Throws if mapping not found (data integrity issue)
   */
  resolveForeignKey(
    targetTable: string,
    postgresId: PostgresId | null | undefined
  ): ConvexId | null {
    if (postgresId === null || postgresId === undefined) {
      return null;
    }

    const convexId = this.get(targetTable, postgresId);
    if (!convexId) {
      throw new Error(
        `Foreign key resolution failed: No mapping found for ${targetTable}[${postgresId}]`
      );
    }

    return convexId;
  }

  /**
   * Resolve foreign key, returning undefined if not found (non-throwing)
   */
  tryResolveForeignKey(
    targetTable: string,
    postgresId: PostgresId | null | undefined
  ): ConvexId | null | undefined {
    if (postgresId === null || postgresId === undefined) {
      return null;
    }

    return this.get(targetTable, postgresId);
  }

  /**
   * Batch resolve foreign keys
   */
  batchResolveForeignKeys(
    targetTable: string,
    postgresIds: PostgresId[]
  ): Map<PostgresId, ConvexId | undefined> {
    const result = new Map<PostgresId, ConvexId | undefined>();
    for (const pgId of postgresIds) {
      result.set(pgId, this.get(targetTable, pgId));
    }
    return result;
  }

  /**
   * Serialize to JSON for persistence
   */
  toJSON(): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};

    for (const [tableName, tableMap] of this.mappings) {
      result[tableName] = {};
      for (const [pgId, convexId] of tableMap) {
        result[tableName][String(pgId)] = convexId;
      }
    }

    return result;
  }

  /**
   * Load from JSON
   */
  fromJSON(data: Record<string, Record<string, string>>): void {
    this.mappings.clear();

    for (const [tableName, mappings] of Object.entries(data)) {
      const tableMap = new Map<PostgresId, ConvexId>();
      for (const [pgId, convexId] of Object.entries(mappings)) {
        // Try to parse as number if it looks like one
        const normalizedId = this.normalizeId(pgId);
        tableMap.set(normalizedId, convexId);
      }
      this.mappings.set(tableName, tableMap);
    }

    this.pendingChanges = 0;
  }

  /**
   * Save mappings to file
   */
  async save(filePath?: string): Promise<void> {
    const targetPath = filePath || this.persistPath;
    if (!targetPath) {
      throw new Error('No persist path specified');
    }

    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });

    const data = JSON.stringify(this.toJSON(), null, 2);
    await fs.writeFile(targetPath, data, 'utf-8');
    this.pendingChanges = 0;
  }

  /**
   * Async save (for auto-save, doesn't block)
   */
  private async saveAsync(): Promise<void> {
    if (this.persistPath) {
      await this.save(this.persistPath);
    }
  }

  /**
   * Load mappings from file
   */
  async load(filePath?: string): Promise<void> {
    const targetPath = filePath || this.persistPath;
    if (!targetPath) {
      throw new Error('No persist path specified');
    }

    try {
      const data = await fs.readFile(targetPath, 'utf-8');
      const json = JSON.parse(data);
      this.fromJSON(json);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, start fresh
        this.mappings.clear();
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if persist file exists
   */
  async exists(filePath?: string): Promise<boolean> {
    const targetPath = filePath || this.persistPath;
    if (!targetPath) return false;

    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Normalize ID to consistent format
   * PostgreSQL IDs can be numbers or strings (UUID)
   */
  private normalizeId(id: PostgresId | string): PostgresId {
    // If it's a numeric string, keep it as string for consistency
    // UUIDs stay as strings
    // Numbers stay as numbers only if explicitly passed as numbers
    if (typeof id === 'number') {
      return id;
    }

    // Check if it's a numeric string
    const numValue = Number(id);
    if (!isNaN(numValue) && Number.isInteger(numValue)) {
      return numValue;
    }

    // Keep as string (UUID or other)
    return id;
  }

  /**
   * Get all mappings as array of IdMapping objects
   */
  getAllMappings(): IdMapping[] {
    const result: IdMapping[] = [];

    for (const [tableName, tableMap] of this.mappings) {
      for (const [postgresId, convexId] of tableMap) {
        result.push({ tableName, postgresId, convexId });
      }
    }

    return result;
  }

  /**
   * Get statistics about mappings
   */
  getStats(): {
    totalMappings: number;
    tablesWithMappings: number;
    mappingsPerTable: Record<string, number>;
  } {
    const mappingsPerTable: Record<string, number> = {};

    for (const [tableName, tableMap] of this.mappings) {
      mappingsPerTable[tableName] = tableMap.size;
    }

    return {
      totalMappings: this.count(),
      tablesWithMappings: this.mappings.size,
      mappingsPerTable,
    };
  }

  /**
   * Validate that all required foreign keys can be resolved
   */
  validateForeignKeyIntegrity(
    tableName: string,
    foreignKeyColumn: string,
    targetTable: string,
    values: (PostgresId | null | undefined)[]
  ): { valid: boolean; missingIds: PostgresId[] } {
    const missingIds: PostgresId[] = [];

    for (const value of values) {
      if (value !== null && value !== undefined) {
        if (!this.has(targetTable, value)) {
          missingIds.push(value);
        }
      }
    }

    return {
      valid: missingIds.length === 0,
      missingIds,
    };
  }

  /**
   * Merge another IdMapper into this one
   */
  merge(other: IdMapper): void {
    const otherMappings = other.getAllMappings();
    for (const mapping of otherMappings) {
      this.set(mapping.tableName, mapping.postgresId, mapping.convexId);
    }
  }

  /**
   * Create a subset mapper for specific tables
   */
  subset(tableNames: string[]): IdMapper {
    const subsetMapper = new IdMapper();
    for (const tableName of tableNames) {
      const tableMap = this.mappings.get(tableName);
      if (tableMap) {
        for (const [pgId, convexId] of tableMap) {
          subsetMapper.set(tableName, pgId, convexId);
        }
      }
    }
    return subsetMapper;
  }
}

/**
 * Factory function to create and optionally load an IdMapper
 */
export async function createIdMapper(options: {
  persistPath?: string;
  autoSaveThreshold?: number;
  loadExisting?: boolean;
}): Promise<IdMapper> {
  const mapper = new IdMapper({
    persistPath: options.persistPath,
    autoSaveThreshold: options.autoSaveThreshold,
  });

  if (options.loadExisting && options.persistPath) {
    const exists = await mapper.exists();
    if (exists) {
      await mapper.load();
    }
  }

  return mapper;
}
