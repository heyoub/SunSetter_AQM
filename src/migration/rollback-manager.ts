/**
 * Rollback Manager
 *
 * Handles rollback state and operations for migration recovery.
 * Saves pre-migration snapshots and tracks changes for undo operations.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { PostgresId, ConvexId, MigrationError } from './types.js';
import type { TableInfo } from '../introspector/schema-introspector.js';

/**
 * Record of a single row migration for rollback
 */
export interface RowMigrationRecord {
  /** PostgreSQL primary key */
  postgresId: PostgresId;
  /** Convex document ID that was created */
  convexId: ConvexId;
  /** When the row was migrated */
  migratedAt: Date;
}

/**
 * Pre-migration snapshot of table state
 */
export interface TableSnapshot {
  tableName: string;
  schemaName: string;
  /** Number of rows before migration */
  rowCountBefore: number;
  /** Whether table existed in Convex before migration */
  existedInConvex: boolean;
  /** Convex document IDs that existed before migration (for truncate recovery) */
  existingConvexIds?: ConvexId[];
  /** Timestamp of snapshot */
  snapshotAt: Date;
}

/**
 * Rollback state for a migration
 */
export interface RollbackState {
  /** Migration ID this rollback state belongs to */
  migrationId: string;
  /** When the rollback state was created */
  createdAt: Date;
  /** Pre-migration snapshots by table name */
  snapshots: Map<string, TableSnapshot>;
  /** Records of migrated rows by table name */
  migratedRows: Map<string, RowMigrationRecord[]>;
  /** Whether rollback is enabled */
  enabled: boolean;
  /** Maximum rows to track per table (0 = unlimited) */
  maxRowsPerTable: number;
}

/**
 * Per-table rollback result
 */
export interface TableRollbackResult {
  tableName: string;
  success: boolean;
  deletedCount: number;
  errors: MigrationError[];
}

/**
 * Rollback operation result
 */
export interface RollbackResult {
  success: boolean;
  /** Tables that were rolled back (simple list) */
  rolledBackTables: string[];
  /** Per-table rollback results with details */
  tablesRolledBack: TableRollbackResult[];
  /** Number of documents deleted from Convex */
  deletedDocuments: number;
  /** Errors encountered during rollback */
  errors: MigrationError[];
  /** Duration of rollback in ms */
  duration: number;
}

/**
 * Rollback options
 */
export interface RollbackOptions {
  /** Only rollback specific tables */
  tables?: string[];
  /** Delete migrated documents from Convex */
  deleteFromConvex?: boolean;
  /** Dry run (don't actually delete) */
  dryRun?: boolean;
}

/**
 * Serialized format for RollbackState
 */
interface SerializedRollbackState {
  migrationId: string;
  createdAt: string;
  snapshots: Record<
    string,
    {
      tableName: string;
      schemaName: string;
      rowCountBefore: number;
      existedInConvex: boolean;
      existingConvexIds?: string[];
      snapshotAt: string;
    }
  >;
  migratedRows: Record<
    string,
    Array<{
      postgresId: string | number;
      convexId: string;
      migratedAt: string;
    }>
  >;
  enabled: boolean;
  maxRowsPerTable: number;
}

/**
 * Interface for Convex client operations needed by rollback
 */
export interface IRollbackConvexClient {
  /** Delete a document by ID */
  delete(tableName: string, documentId: ConvexId): Promise<void>;
  /** Batch delete documents */
  batchDelete(tableName: string, documentIds: ConvexId[]): Promise<number>;
  /** Count documents in a table */
  countDocuments(tableName: string): Promise<number>;
}

/**
 * Manages rollback state and operations
 */
export class RollbackManager {
  private baseDir: string;
  private currentState: RollbackState | null;
  private maxRowsPerTable: number;
  private autoSaveInterval: NodeJS.Timeout | null;

  constructor(options: {
    baseDir: string;
    maxRowsPerTable?: number;
    autoSaveIntervalMs?: number;
  }) {
    this.baseDir = options.baseDir;
    this.maxRowsPerTable = options.maxRowsPerTable || 100000; // Default 100k rows per table
    this.currentState = null;
    this.autoSaveInterval = null;
  }

  /**
   * Create a new rollback state for a migration
   */
  createNew(migrationId: string): RollbackState {
    const state: RollbackState = {
      migrationId,
      createdAt: new Date(),
      snapshots: new Map(),
      migratedRows: new Map(),
      enabled: true,
      maxRowsPerTable: this.maxRowsPerTable,
    };

    this.currentState = state;
    return state;
  }

  /**
   * Get current rollback state
   */
  getCurrentState(): RollbackState | null {
    return this.currentState;
  }

  /**
   * Create a pre-migration snapshot for a table
   */
  async createTableSnapshot(
    table: TableInfo,
    rowCount: number,
    existedInConvex: boolean,
    existingConvexIds?: ConvexId[]
  ): Promise<TableSnapshot> {
    if (!this.currentState) {
      throw new Error('No active rollback state');
    }

    const snapshot: TableSnapshot = {
      tableName: table.tableName,
      schemaName: table.schemaName,
      rowCountBefore: rowCount,
      existedInConvex,
      existingConvexIds: existingConvexIds?.slice(0, 1000), // Limit stored IDs
      snapshotAt: new Date(),
    };

    this.currentState.snapshots.set(table.tableName, snapshot);
    return snapshot;
  }

  /**
   * Record a migrated row for potential rollback
   */
  recordMigratedRow(
    tableName: string,
    postgresId: PostgresId,
    convexId: ConvexId
  ): void {
    if (!this.currentState || !this.currentState.enabled) {
      return;
    }

    let tableRecords = this.currentState.migratedRows.get(tableName);
    if (!tableRecords) {
      tableRecords = [];
      this.currentState.migratedRows.set(tableName, tableRecords);
    }

    // Check max rows limit
    if (
      this.maxRowsPerTable > 0 &&
      tableRecords.length >= this.maxRowsPerTable
    ) {
      // Disable tracking for this table if limit reached
      console.warn(
        `Rollback tracking limit reached for table ${tableName}. ` +
          `Disabling rollback for additional rows.`
      );
      return;
    }

    tableRecords.push({
      postgresId,
      convexId,
      migratedAt: new Date(),
    });
  }

  /**
   * Record multiple migrated rows at once (batch operation)
   */
  recordMigratedRows(
    tableName: string,
    records: Array<{ postgresId: PostgresId; convexId: ConvexId }>
  ): void {
    for (const record of records) {
      this.recordMigratedRow(tableName, record.postgresId, record.convexId);
    }
  }

  /**
   * Get all Convex IDs that were created for a table
   */
  getCreatedConvexIds(tableName: string): ConvexId[] {
    if (!this.currentState) {
      return [];
    }

    const records = this.currentState.migratedRows.get(tableName);
    if (!records) {
      return [];
    }

    return records.map((r) => r.convexId);
  }

  /**
   * Get the number of tracked rows for a table
   */
  getTrackedRowCount(tableName: string): number {
    if (!this.currentState) {
      return 0;
    }

    return this.currentState.migratedRows.get(tableName)?.length || 0;
  }

  /**
   * Get total tracked rows across all tables
   */
  getTotalTrackedRows(): number {
    if (!this.currentState) {
      return 0;
    }

    let total = 0;
    for (const records of this.currentState.migratedRows.values()) {
      total += records.length;
    }
    return total;
  }

  /**
   * Perform rollback operation
   */
  async rollback(
    convexClient: IRollbackConvexClient,
    options: RollbackOptions = {}
  ): Promise<RollbackResult> {
    const startTime = Date.now();
    const result: RollbackResult = {
      success: true,
      rolledBackTables: [],
      tablesRolledBack: [],
      deletedDocuments: 0,
      errors: [],
      duration: 0,
    };

    if (!this.currentState) {
      result.success = false;
      result.errors.push({
        code: 'STATE_ERROR',
        message: 'No rollback state available',
        retryable: false,
      });
      result.duration = Date.now() - startTime;
      return result;
    }

    // Determine which tables to rollback
    let tablesToRollback: string[];
    if (options.tables && options.tables.length > 0) {
      tablesToRollback = options.tables.filter((t) =>
        this.currentState!.migratedRows.has(t)
      );
    } else {
      tablesToRollback = [...this.currentState.migratedRows.keys()];
    }

    // Rollback in reverse order (dependents first)
    tablesToRollback.reverse();

    for (const tableName of tablesToRollback) {
      const convexIds = this.getCreatedConvexIds(tableName);
      const tableResult: TableRollbackResult = {
        tableName,
        success: true,
        deletedCount: 0,
        errors: [],
      };

      if (convexIds.length === 0) {
        result.tablesRolledBack.push(tableResult);
        continue;
      }

      if (options.dryRun) {
        console.log(
          `[Dry Run] Would delete ${convexIds.length} documents from ${tableName}`
        );
        result.rolledBackTables.push(tableName);
        tableResult.deletedCount = convexIds.length;
        result.deletedDocuments += convexIds.length;
        result.tablesRolledBack.push(tableResult);
        continue;
      }

      if (options.deleteFromConvex !== false) {
        try {
          // Batch delete for efficiency
          const batchSize = 100;
          for (let i = 0; i < convexIds.length; i += batchSize) {
            const batch = convexIds.slice(i, i + batchSize);
            const deleted = await convexClient.batchDelete(tableName, batch);

            // CRITICAL FIX: Verify deletion count matches expected
            if (deleted !== batch.length) {
              console.warn(
                `Rollback verification warning for ${tableName}: ` +
                  `Expected to delete ${batch.length} documents, but deleted ${deleted}. ` +
                  `This may indicate partial deletion or missing documents.`
              );
              // Add a warning to errors but don't fail the rollback
              const verificationWarning: MigrationError = {
                code: 'ROLLBACK_WARNING',
                message: `Deletion count mismatch: expected ${batch.length}, deleted ${deleted}`,
                table: tableName,
                retryable: false,
              };
              result.errors.push(verificationWarning);
              tableResult.errors.push(verificationWarning);
            }

            tableResult.deletedCount += deleted;
            result.deletedDocuments += deleted;
          }
          result.rolledBackTables.push(tableName);
          tableResult.success = true;
        } catch (error: unknown) {
          const migrationError: MigrationError = {
            code: 'CONVEX_ERROR',
            message: `Failed to rollback table ${tableName}: ${(error as Error).message}`,
            table: tableName,
            originalError: error as Error,
            retryable: true,
          };
          result.errors.push(migrationError);
          tableResult.errors.push(migrationError);
          tableResult.success = false;
          result.success = false;
        }
      }
      result.tablesRolledBack.push(tableResult);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Save rollback state to disk
   */
  async save(): Promise<void> {
    if (!this.currentState) {
      return;
    }

    const stateDir = path.join(this.baseDir, this.currentState.migrationId);
    await fs.mkdir(stateDir, { recursive: true });

    const serialized = this.serialize(this.currentState);
    const statePath = path.join(stateDir, 'rollback.json');

    // Write atomically
    const tempPath = `${statePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(serialized, null, 2), 'utf-8');
    await fs.rename(tempPath, statePath);
  }

  /**
   * Load rollback state from disk
   */
  async load(migrationId: string): Promise<RollbackState | null> {
    const statePath = path.join(this.baseDir, migrationId, 'rollback.json');

    try {
      const data = await fs.readFile(statePath, 'utf-8');
      const serialized: SerializedRollbackState = JSON.parse(data);
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
   * Delete rollback state
   */
  async delete(migrationId: string): Promise<void> {
    const statePath = path.join(this.baseDir, migrationId, 'rollback.json');
    try {
      await fs.unlink(statePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Check if rollback state exists for a migration
   */
  async exists(migrationId: string): Promise<boolean> {
    const statePath = path.join(this.baseDir, migrationId, 'rollback.json');
    try {
      await fs.access(statePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start auto-save interval
   */
  startAutoSave(intervalMs: number = 10000): void {
    if (this.autoSaveInterval) {
      return;
    }

    this.autoSaveInterval = setInterval(async () => {
      if (this.currentState) {
        try {
          await this.save();
        } catch (error) {
          console.error('Failed to auto-save rollback state:', error);
        }
      }
    }, intervalMs);
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
   * Disable rollback tracking (for performance on large migrations)
   */
  disable(): void {
    if (this.currentState) {
      this.currentState.enabled = false;
    }
  }

  /**
   * Enable rollback tracking
   */
  enable(): void {
    if (this.currentState) {
      this.currentState.enabled = true;
    }
  }

  /**
   * Check if rollback is enabled
   */
  isEnabled(): boolean {
    return this.currentState?.enabled ?? false;
  }

  /**
   * Clear all tracked data (free memory)
   */
  clear(): void {
    if (this.currentState) {
      this.currentState.migratedRows.clear();
      this.currentState.snapshots.clear();
    }
  }

  /**
   * Get rollback summary statistics
   */
  getSummary(): {
    enabled: boolean;
    tablesTracked: number;
    totalRows: number;
    byTable: Record<string, number>;
  } {
    if (!this.currentState) {
      return {
        enabled: false,
        tablesTracked: 0,
        totalRows: 0,
        byTable: {},
      };
    }

    const byTable: Record<string, number> = {};
    let totalRows = 0;

    for (const [tableName, records] of this.currentState.migratedRows) {
      byTable[tableName] = records.length;
      totalRows += records.length;
    }

    return {
      enabled: this.currentState.enabled,
      tablesTracked: this.currentState.migratedRows.size,
      totalRows,
      byTable,
    };
  }

  /**
   * Serialize state for storage
   */
  private serialize(state: RollbackState): SerializedRollbackState {
    const snapshots: SerializedRollbackState['snapshots'] = {};
    for (const [name, snapshot] of state.snapshots) {
      snapshots[name] = {
        tableName: snapshot.tableName,
        schemaName: snapshot.schemaName,
        rowCountBefore: snapshot.rowCountBefore,
        existedInConvex: snapshot.existedInConvex,
        existingConvexIds: snapshot.existingConvexIds,
        snapshotAt: snapshot.snapshotAt.toISOString(),
      };
    }

    const migratedRows: SerializedRollbackState['migratedRows'] = {};
    for (const [name, records] of state.migratedRows) {
      migratedRows[name] = records.map((r) => ({
        postgresId: r.postgresId,
        convexId: r.convexId,
        migratedAt: r.migratedAt.toISOString(),
      }));
    }

    return {
      migrationId: state.migrationId,
      createdAt: state.createdAt.toISOString(),
      snapshots,
      migratedRows,
      enabled: state.enabled,
      maxRowsPerTable: state.maxRowsPerTable,
    };
  }

  /**
   * Deserialize state from storage
   */
  private deserialize(data: SerializedRollbackState): RollbackState {
    const snapshots = new Map<string, TableSnapshot>();
    for (const [name, snapshot] of Object.entries(data.snapshots)) {
      snapshots.set(name, {
        tableName: snapshot.tableName,
        schemaName: snapshot.schemaName,
        rowCountBefore: snapshot.rowCountBefore,
        existedInConvex: snapshot.existedInConvex,
        existingConvexIds: snapshot.existingConvexIds,
        snapshotAt: new Date(snapshot.snapshotAt),
      });
    }

    const migratedRows = new Map<string, RowMigrationRecord[]>();
    for (const [name, records] of Object.entries(data.migratedRows)) {
      migratedRows.set(
        name,
        records.map((r) => ({
          postgresId: r.postgresId,
          convexId: r.convexId,
          migratedAt: new Date(r.migratedAt),
        }))
      );
    }

    return {
      migrationId: data.migrationId,
      createdAt: new Date(data.createdAt),
      snapshots,
      migratedRows,
      enabled: data.enabled,
      maxRowsPerTable: data.maxRowsPerTable,
    };
  }
}
