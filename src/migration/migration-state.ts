/**
 * Migration State Manager
 *
 * Handles persistence and recovery of migration state.
 * Enables resumable migrations after interruptions or failures.
 * Now includes rollback snapshot support for migration recovery.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  MigrationState,
  TableProgress,
  MigrationStats,
  IStateManager,
  PostgresId,
  ConvexId,
  Checkpoint,
} from './types.js';
import type { TableSnapshot } from './rollback-manager.js';
import { DataMigrationError } from '../cli/errors/index.js';

/**
 * Serializable format for MigrationState
 */
interface SerializedMigrationState {
  migrationId: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'paused';
  tables: Record<string, SerializedTableProgress>;
  idMappings: Record<string, Record<string, string>>;
  migrationOrder: string[];
  currentTable?: string;
  error?: string;
  stats: MigrationStats;
}

/**
 * Serializable format for TableProgress
 */
interface SerializedTableProgress {
  tableName: string;
  status: string;
  totalRows: number;
  migratedRows: number;
  failedRows: number;
  lastProcessedId?: string | number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  retryCount: number;
}

/**
 * Rollback snapshot stored with migration state
 */
interface RollbackSnapshotData {
  /** Table snapshots before migration */
  tableSnapshots: Map<string, TableSnapshot>;
  /** Whether rollback is enabled for this migration */
  rollbackEnabled: boolean;
  /** Timestamp when rollback tracking started */
  startedAt: Date;
}

/**
 * Manages migration state with file-based persistence
 */
export class MigrationStateManager implements IStateManager {
  private baseDir: string;
  private currentState: MigrationState | null;
  private autoSaveInterval: NodeJS.Timeout | null;
  private saveDebounceMs: number;
  private rollbackSnapshots: RollbackSnapshotData | null;

  constructor(options: { baseDir: string; autoSaveIntervalMs?: number }) {
    this.baseDir = options.baseDir;
    this.currentState = null;
    this.autoSaveInterval = null;
    this.saveDebounceMs = options.autoSaveIntervalMs || 5000;
    this.rollbackSnapshots = null;
  }

  /**
   * Initialize rollback snapshot tracking
   */
  initRollbackSnapshots(): void {
    this.rollbackSnapshots = {
      tableSnapshots: new Map(),
      rollbackEnabled: true,
      startedAt: new Date(),
    };
  }

  /**
   * Store a pre-migration table snapshot for rollback
   */
  storeTableSnapshot(snapshot: TableSnapshot): void {
    if (!this.rollbackSnapshots) {
      this.initRollbackSnapshots();
    }
    this.rollbackSnapshots!.tableSnapshots.set(snapshot.tableName, snapshot);
  }

  /**
   * Get a stored table snapshot
   */
  getTableSnapshot(tableName: string): TableSnapshot | undefined {
    return this.rollbackSnapshots?.tableSnapshots.get(tableName);
  }

  /**
   * Get all stored table snapshots
   */
  getAllTableSnapshots(): Map<string, TableSnapshot> {
    return this.rollbackSnapshots?.tableSnapshots ?? new Map();
  }

  /**
   * Check if rollback snapshots are enabled
   */
  isRollbackEnabled(): boolean {
    return this.rollbackSnapshots?.rollbackEnabled ?? false;
  }

  /**
   * Disable rollback tracking
   */
  disableRollback(): void {
    if (this.rollbackSnapshots) {
      this.rollbackSnapshots.rollbackEnabled = false;
    }
  }

  /**
   * Enable rollback tracking
   */
  enableRollback(): void {
    if (!this.rollbackSnapshots) {
      this.initRollbackSnapshots();
    }
    this.rollbackSnapshots!.rollbackEnabled = true;
  }

  /**
   * Save rollback snapshots to disk
   */
  async saveRollbackSnapshots(): Promise<void> {
    if (!this.currentState || !this.rollbackSnapshots) {
      return;
    }

    const stateDir = path.join(this.baseDir, this.currentState.migrationId);
    await fs.mkdir(stateDir, { recursive: true });

    const snapshotData: Record<
      string,
      {
        tableName: string;
        schemaName: string;
        rowCountBefore: number;
        existedInConvex: boolean;
        existingConvexIds?: string[];
        snapshotAt: string;
      }
    > = {};

    for (const [name, snapshot] of this.rollbackSnapshots.tableSnapshots) {
      snapshotData[name] = {
        tableName: snapshot.tableName,
        schemaName: snapshot.schemaName,
        rowCountBefore: snapshot.rowCountBefore,
        existedInConvex: snapshot.existedInConvex,
        existingConvexIds: snapshot.existingConvexIds,
        snapshotAt: snapshot.snapshotAt.toISOString(),
      };
    }

    const serialized = {
      rollbackEnabled: this.rollbackSnapshots.rollbackEnabled,
      startedAt: this.rollbackSnapshots.startedAt.toISOString(),
      tableSnapshots: snapshotData,
    };

    const snapshotPath = path.join(stateDir, 'rollback-snapshots.json');
    const tempPath = `${snapshotPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(serialized, null, 2), 'utf-8');
    await fs.rename(tempPath, snapshotPath);
  }

  /**
   * Load rollback snapshots from disk
   */
  async loadRollbackSnapshots(
    migrationId: string
  ): Promise<RollbackSnapshotData | null> {
    const snapshotPath = path.join(
      this.baseDir,
      migrationId,
      'rollback-snapshots.json'
    );

    try {
      const data = await fs.readFile(snapshotPath, 'utf-8');
      const parsed = JSON.parse(data);

      const tableSnapshots = new Map<string, TableSnapshot>();
      for (const [name, snapshot] of Object.entries(parsed.tableSnapshots)) {
        const s = snapshot as {
          tableName: string;
          schemaName: string;
          rowCountBefore: number;
          existedInConvex: boolean;
          existingConvexIds?: string[];
          snapshotAt: string;
        };
        tableSnapshots.set(name, {
          tableName: s.tableName,
          schemaName: s.schemaName,
          rowCountBefore: s.rowCountBefore,
          existedInConvex: s.existedInConvex,
          existingConvexIds: s.existingConvexIds,
          snapshotAt: new Date(s.snapshotAt),
        });
      }

      this.rollbackSnapshots = {
        tableSnapshots,
        rollbackEnabled: parsed.rollbackEnabled,
        startedAt: new Date(parsed.startedAt),
      };

      return this.rollbackSnapshots;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a new migration state
   */
  createNew(migrationOrder: string[]): MigrationState {
    const now = new Date();

    const state: MigrationState = {
      migrationId: uuidv4(),
      startedAt: now,
      updatedAt: now,
      status: 'running',
      tables: new Map(),
      idMappings: new Map(),
      migrationOrder,
      stats: {
        totalTables: migrationOrder.length,
        completedTables: 0,
        totalRows: 0,
        migratedRows: 0,
        failedRows: 0,
        skippedRows: 0,
        startTime: now.getTime(),
        avgRowsPerSecond: 0,
      },
    };

    // Initialize table progress
    for (const tableName of migrationOrder) {
      state.tables.set(tableName, {
        tableName,
        status: 'pending',
        totalRows: 0,
        migratedRows: 0,
        failedRows: 0,
        retryCount: 0,
      });
    }

    this.currentState = state;
    return state;
  }

  /**
   * Save current state to disk
   */
  async save(state: MigrationState): Promise<void> {
    state.updatedAt = new Date();

    const stateDir = path.join(this.baseDir, state.migrationId);
    await fs.mkdir(stateDir, { recursive: true });

    const serialized = this.serialize(state);
    const statePath = path.join(stateDir, 'state.json');

    // Write to temp file first, then rename (atomic)
    const tempPath = `${statePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(serialized, null, 2), 'utf-8');
    await fs.rename(tempPath, statePath);

    this.currentState = state;
  }

  /**
   * Load state from disk
   */
  async load(migrationId?: string): Promise<MigrationState | null> {
    const targetId = migrationId || (await this.getLatestMigrationId());
    if (!targetId) return null;

    const statePath = path.join(this.baseDir, targetId, 'state.json');

    try {
      const data = await fs.readFile(statePath, 'utf-8');
      const serialized: SerializedMigrationState = JSON.parse(data);
      const state = this.deserialize(serialized);
      this.currentState = state;
      return state;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get the most recent migration ID
   */
  async getLatestMigrationId(): Promise<string | null> {
    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      const migrations: { id: string; time: number }[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const statePath = path.join(this.baseDir, entry.name, 'state.json');
          try {
            const stat = await fs.stat(statePath);
            migrations.push({ id: entry.name, time: stat.mtimeMs });
          } catch {
            // Skip directories without state files
          }
        }
      }

      if (migrations.length === 0) return null;

      // Sort by modification time, descending
      migrations.sort((a, b) => b.time - a.time);
      return migrations[0].id;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check if migration state exists
   */
  async exists(migrationId: string): Promise<boolean> {
    const statePath = path.join(this.baseDir, migrationId, 'state.json');
    try {
      await fs.access(statePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete migration state
   */
  async delete(migrationId: string): Promise<void> {
    const stateDir = path.join(this.baseDir, migrationId);
    await fs.rm(stateDir, { recursive: true, force: true });
  }

  /**
   * List all migration IDs
   */
  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      const migrations: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const statePath = path.join(this.baseDir, entry.name, 'state.json');
          try {
            await fs.access(statePath);
            migrations.push(entry.name);
          } catch {
            // Skip directories without state files
          }
        }
      }

      return migrations;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Update table progress
   */
  updateTableProgress(
    tableName: string,
    updates: Partial<TableProgress>
  ): void {
    if (!this.currentState) {
      throw new DataMigrationError('No active migration state');
    }

    const existing = this.currentState.tables.get(tableName);
    if (!existing) {
      throw new DataMigrationError(
        `Table ${tableName} not found in migration state`
      );
    }

    const updated = { ...existing, ...updates };
    this.currentState.tables.set(tableName, updated);

    // Update stats
    this.recalculateStats();
  }

  /**
   * Set table as started
   */
  startTable(tableName: string, totalRows: number): void {
    this.updateTableProgress(tableName, {
      status: 'in_progress',
      totalRows,
      startedAt: new Date(),
    });
    if (this.currentState) {
      this.currentState.currentTable = tableName;
    }
  }

  /**
   * Set table as completed
   */
  completeTable(tableName: string): void {
    this.updateTableProgress(tableName, {
      status: 'completed',
      completedAt: new Date(),
    });
    if (this.currentState) {
      this.currentState.stats.completedTables++;
    }
  }

  /**
   * Set table as failed
   */
  failTable(tableName: string, error: string): void {
    this.updateTableProgress(tableName, {
      status: 'failed',
      error,
    });
  }

  /**
   * Record row progress
   */
  recordRowProgress(
    tableName: string,
    migratedCount: number,
    lastId?: PostgresId
  ): void {
    if (!this.currentState) return;

    const progress = this.currentState.tables.get(tableName);
    if (progress) {
      progress.migratedRows = migratedCount;
      if (lastId !== undefined) {
        progress.lastProcessedId = lastId;
      }
    }

    this.recalculateStats();
  }

  /**
   * Record failed rows
   */
  recordFailedRows(tableName: string, failedCount: number): void {
    if (!this.currentState) return;

    const progress = this.currentState.tables.get(tableName);
    if (progress) {
      progress.failedRows += failedCount;
    }

    this.currentState.stats.failedRows += failedCount;
  }

  /**
   * Store ID mapping
   */
  storeIdMapping(
    tableName: string,
    postgresId: PostgresId,
    convexId: ConvexId
  ): void {
    if (!this.currentState) return;

    let tableMap = this.currentState.idMappings.get(tableName);
    if (!tableMap) {
      tableMap = new Map();
      this.currentState.idMappings.set(tableName, tableMap);
    }

    tableMap.set(postgresId, convexId);
  }

  /**
   * Get ID mapping
   */
  getIdMapping(
    tableName: string,
    postgresId: PostgresId
  ): ConvexId | undefined {
    if (!this.currentState) return undefined;
    return this.currentState.idMappings.get(tableName)?.get(postgresId);
  }

  /**
   * Complete migration
   */
  completeMigration(): void {
    if (!this.currentState) return;

    const now = new Date();
    this.currentState.status = 'completed';
    this.currentState.completedAt = now;
    this.currentState.stats.endTime = now.getTime();
    this.currentState.currentTable = undefined;
  }

  /**
   * Fail migration
   */
  failMigration(error: string): void {
    if (!this.currentState) return;

    this.currentState.status = 'failed';
    this.currentState.error = error;
    this.currentState.stats.endTime = Date.now();
  }

  /**
   * Pause migration
   */
  pauseMigration(): void {
    if (!this.currentState) return;
    this.currentState.status = 'paused';
  }

  /**
   * Resume migration
   */
  resumeMigration(): void {
    if (!this.currentState) return;
    this.currentState.status = 'running';
  }

  /**
   * Get current state
   */
  getCurrentState(): MigrationState | null {
    return this.currentState;
  }

  /**
   * Create checkpoint
   */
  async createCheckpoint(
    tableName: string,
    lastProcessedId: PostgresId,
    processedCount: number
  ): Promise<Checkpoint> {
    if (!this.currentState) {
      throw new DataMigrationError('No active migration state');
    }

    const checkpoint: Checkpoint = {
      migrationId: this.currentState.migrationId,
      tableName,
      lastProcessedId,
      processedCount,
      timestamp: new Date(),
    };

    // Save checkpoint to separate file
    const checkpointPath = path.join(
      this.baseDir,
      this.currentState.migrationId,
      'checkpoint.json'
    );
    await fs.writeFile(
      checkpointPath,
      JSON.stringify(checkpoint, null, 2),
      'utf-8'
    );

    return checkpoint;
  }

  /**
   * Load checkpoint
   */
  async loadCheckpoint(migrationId: string): Promise<Checkpoint | null> {
    const checkpointPath = path.join(
      this.baseDir,
      migrationId,
      'checkpoint.json'
    );
    try {
      const data = await fs.readFile(checkpointPath, 'utf-8');
      const checkpoint = JSON.parse(data);
      checkpoint.timestamp = new Date(checkpoint.timestamp);
      return checkpoint;
    } catch {
      return null;
    }
  }

  /**
   * Start auto-save interval
   */
  startAutoSave(): void {
    if (this.autoSaveInterval) return;

    this.autoSaveInterval = setInterval(async () => {
      if (this.currentState) {
        await this.save(this.currentState);
      }
    }, this.saveDebounceMs);
  }

  /**
   * Stop auto-save interval
   */
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  /**
   * Recalculate statistics
   */
  private recalculateStats(): void {
    if (!this.currentState) return;

    let totalRows = 0;
    let migratedRows = 0;
    let failedRows = 0;

    for (const progress of this.currentState.tables.values()) {
      totalRows += progress.totalRows;
      migratedRows += progress.migratedRows;
      failedRows += progress.failedRows;
    }

    const stats = this.currentState.stats;
    stats.totalRows = totalRows;
    stats.migratedRows = migratedRows;
    stats.failedRows = failedRows;

    // Calculate rows per second
    const elapsed = (Date.now() - stats.startTime) / 1000;
    stats.avgRowsPerSecond = elapsed > 0 ? migratedRows / elapsed : 0;
  }

  /**
   * Serialize state for storage
   */
  private serialize(state: MigrationState): SerializedMigrationState {
    const tables: Record<string, SerializedTableProgress> = {};
    for (const [name, progress] of state.tables) {
      tables[name] = {
        ...progress,
        startedAt: progress.startedAt?.toISOString(),
        completedAt: progress.completedAt?.toISOString(),
      };
    }

    const idMappings: Record<string, Record<string, string>> = {};
    for (const [tableName, tableMap] of state.idMappings) {
      idMappings[tableName] = {};
      for (const [pgId, convexId] of tableMap) {
        idMappings[tableName][String(pgId)] = convexId;
      }
    }

    return {
      migrationId: state.migrationId,
      startedAt: state.startedAt.toISOString(),
      updatedAt: state.updatedAt.toISOString(),
      completedAt: state.completedAt?.toISOString(),
      status: state.status,
      tables,
      idMappings,
      migrationOrder: state.migrationOrder,
      currentTable: state.currentTable,
      error: state.error,
      stats: state.stats,
    };
  }

  /**
   * Deserialize state from storage
   */
  private deserialize(data: SerializedMigrationState): MigrationState {
    const tables = new Map<string, TableProgress>();
    for (const [name, progress] of Object.entries(data.tables)) {
      tables.set(name, {
        ...progress,
        status: progress.status as TableProgress['status'],
        startedAt: progress.startedAt
          ? new Date(progress.startedAt)
          : undefined,
        completedAt: progress.completedAt
          ? new Date(progress.completedAt)
          : undefined,
      });
    }

    const idMappings = new Map<string, Map<PostgresId, ConvexId>>();
    for (const [tableName, mappings] of Object.entries(data.idMappings)) {
      const tableMap = new Map<PostgresId, ConvexId>();
      for (const [pgId, convexId] of Object.entries(mappings)) {
        const numId = Number(pgId);
        tableMap.set(isNaN(numId) ? pgId : numId, convexId);
      }
      idMappings.set(tableName, tableMap);
    }

    return {
      migrationId: data.migrationId,
      startedAt: new Date(data.startedAt),
      updatedAt: new Date(data.updatedAt),
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      status: data.status,
      tables,
      idMappings,
      migrationOrder: data.migrationOrder,
      currentTable: data.currentTable,
      error: data.error,
      stats: data.stats,
    };
  }
}
