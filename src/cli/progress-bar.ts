/**
 * Migration Progress Bar - Visual Progress System
 *
 * Production-quality progress visualization for migration operations with:
 * - Overall migration progress (X of Y tables)
 * - Per-table progress with rows migrated / total rows
 * - Throughput metrics (rows/sec)
 * - ETA calculations
 * - Memory usage display
 * - Batch number tracking
 * - Multiple concurrent table support for parallel migrations
 * - Graceful terminal resize handling
 * - Non-TTY fallback with simple log lines
 * - Color-coded status indicators
 */

import chalk from 'chalk';
import cliProgress from 'cli-progress';
import {
  formatBytes,
  formatDurationCompact as formatDuration,
  formatNumber,
} from '../utils/formatting.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Status of a single table migration
 */
export type TableStatus = 'pending' | 'in_progress' | 'completed' | 'error';

/**
 * State for tracking individual table progress
 */
export interface TableProgressState {
  /** Table name */
  name: string;
  /** Current status */
  status: TableStatus;
  /** Current row count migrated */
  current: number;
  /** Total row count */
  total: number;
  /** Start time of migration for this table */
  startTime: number;
  /** End time (if completed or errored) */
  endTime?: number;
  /** Duration in seconds (computed on completion) */
  duration?: number;
  /** Current batch number */
  batchNumber: number;
  /** Error message if failed */
  errorMessage?: string;
  /** Throughput in rows per second (computed periodically) */
  throughput: number;
  /** Last update timestamp for throughput calculation */
  lastUpdateTime: number;
  /** Rows at last update for throughput calculation */
  lastUpdateRows: number;
}

/**
 * Configuration options for MigrationProgressBar
 */
export interface MigrationProgressBarConfig {
  /** Use colors in output (default: true) */
  colors?: boolean;
  /** Enable interactive mode with live updates (default: auto-detect TTY) */
  interactive?: boolean;
  /** Show memory usage (default: true) */
  showMemory?: boolean;
  /** Update interval in milliseconds (default: 100) */
  updateInterval?: number;
  /** Width of the progress bar in characters (default: 20) */
  barWidth?: number;
  /** Show throughput (default: true) */
  showThroughput?: boolean;
  /** Show ETA (default: true) */
  showEta?: boolean;
  /** Show batch numbers (default: true) */
  showBatchNumber?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Unicode characters for progress visualization */
const CHARS = {
  /** Filled progress bar segment */
  BAR_FILLED: '\u2588', // Full block
  /** Empty progress bar segment */
  BAR_EMPTY: '\u2591', // Light shade
  /** Overall progress line */
  LINE: '\u2501', // Heavy horizontal
  /** Status icons */
  CHECK: '\u2713', // Checkmark
  SPINNER: '\u25D0', // Circle with left half black
  PENDING: '\u25CB', // White circle
  ERROR: '\u2717', // X mark
};

/** Default configuration values */
const DEFAULTS: Required<MigrationProgressBarConfig> = {
  colors: true,
  interactive: process.stdout.isTTY ?? false,
  showMemory: true,
  updateInterval: 100,
  barWidth: 20,
  showThroughput: true,
  showEta: true,
  showBatchNumber: true,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate ETA based on progress and throughput
 */
function calculateEta(remaining: number, throughput: number): string {
  if (throughput <= 0 || remaining <= 0) return '--';
  const seconds = remaining / throughput;
  if (seconds > 86400) return '>24h';
  return formatDuration(seconds);
}

/**
 * Get the current terminal width, with fallback
 */
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

// ============================================================================
// MigrationProgressBar Class
// ============================================================================

/**
 * Visual progress bar system for database migrations
 *
 * Provides rich visual feedback during migration operations including:
 * - Overall progress tracking across all tables
 * - Per-table progress with throughput and ETA
 * - Memory usage monitoring
 * - Support for parallel table migrations
 * - Graceful degradation for non-TTY environments
 *
 * @example
 * ```typescript
 * const progress = new MigrationProgressBar();
 *
 * progress.start(['users', 'posts', 'comments'], {
 *   users: 1234,
 *   posts: 5678,
 *   comments: 9012
 * });
 *
 * // During migration
 * progress.updateTable('users', 500, 1234);
 * progress.setBatchNumber('users', 5);
 *
 * // When table completes
 * progress.completeTable('users', true, 2.5);
 *
 * // When all done
 * progress.finish(true);
 * ```
 */
export class MigrationProgressBar {
  private config: Required<MigrationProgressBarConfig>;
  private tables: Map<string, TableProgressState> = new Map();
  private tableOrder: string[] = [];
  private overallStartTime: number = 0;
  private isActive: boolean = false;
  private updateTimer: NodeJS.Timeout | null = null;
  private lastRenderTime: number = 0;
  private resizeHandler: (() => void) | null = null;
  private multiBar: cliProgress.MultiBar | null = null;
  private tableBars: Map<string, cliProgress.SingleBar> = new Map();

  constructor(config: MigrationProgressBarConfig = {}) {
    this.config = { ...DEFAULTS, ...config };

    // Bind methods for event handlers
    this.handleResize = this.handleResize.bind(this);
  }

  // ==================== PUBLIC API ====================

  /**
   * Start the progress bar with table information
   *
   * @param tables - Array of table names to track
   * @param rowCounts - Record mapping table names to their total row counts
   */
  start(tables: string[], rowCounts: Record<string, number>): void {
    if (this.isActive) {
      this.finish(false);
    }

    this.isActive = true;
    this.overallStartTime = Date.now();
    this.tableOrder = [...tables];
    this.tables.clear();
    this.tableBars.clear();

    // Initialize table states
    for (const tableName of tables) {
      const total = rowCounts[tableName] ?? 0;
      this.tables.set(tableName, {
        name: tableName,
        status: 'pending',
        current: 0,
        total,
        startTime: 0,
        batchNumber: 0,
        throughput: 0,
        lastUpdateTime: Date.now(),
        lastUpdateRows: 0,
      });
    }

    if (this.config.interactive) {
      this.setupInteractiveMode();
    } else {
      this.logNonInteractiveStart();
    }
  }

  /**
   * Update progress for a specific table
   *
   * @param table - Table name
   * @param current - Current number of rows migrated
   * @param total - Total number of rows (optional, uses initial value if not provided)
   */
  updateTable(table: string, current: number, total?: number): void {
    const state = this.tables.get(table);
    if (!state) return;

    const now = Date.now();

    // Start tracking if this is the first update
    if (state.status === 'pending') {
      state.status = 'in_progress';
      state.startTime = now;
      state.lastUpdateTime = now;
      state.lastUpdateRows = 0;
    }

    // Update total if provided
    if (total !== undefined) {
      state.total = total;
    }

    // Calculate throughput (using sliding window)
    const timeDelta = (now - state.lastUpdateTime) / 1000;
    if (timeDelta >= 0.5) {
      // Update every 500ms
      const rowsDelta = current - state.lastUpdateRows;
      state.throughput = timeDelta > 0 ? rowsDelta / timeDelta : 0;
      state.lastUpdateTime = now;
      state.lastUpdateRows = current;
    }

    state.current = current;

    if (this.config.interactive) {
      this.updateInteractiveDisplay();
    } else {
      this.logNonInteractiveProgress(table, state);
    }
  }

  /**
   * Set the current batch number for a table
   *
   * @param table - Table name
   * @param batchNumber - Current batch number
   */
  setBatchNumber(table: string, batchNumber: number): void {
    const state = this.tables.get(table);
    if (state) {
      state.batchNumber = batchNumber;
    }
  }

  /**
   * Mark a table as completed
   *
   * @param table - Table name
   * @param success - Whether the migration was successful
   * @param duration - Duration in seconds
   */
  completeTable(table: string, success: boolean, duration: number): void {
    const state = this.tables.get(table);
    if (!state) return;

    const now = Date.now();
    state.status = success ? 'completed' : 'error';
    state.endTime = now;
    state.duration = duration;

    if (success) {
      state.current = state.total;
    }

    if (this.config.interactive) {
      this.updateInteractiveDisplay();
    } else {
      this.logNonInteractiveComplete(table, state, success);
    }
  }

  /**
   * Mark a table as errored with a message
   *
   * @param table - Table name
   * @param errorMessage - Error description
   */
  errorTable(table: string, errorMessage: string): void {
    const state = this.tables.get(table);
    if (!state) return;

    state.status = 'error';
    state.endTime = Date.now();
    state.errorMessage = errorMessage;
    state.duration = (state.endTime - state.startTime) / 1000;

    if (this.config.interactive) {
      this.updateInteractiveDisplay();
    } else {
      this.logNonInteractiveError(table, errorMessage);
    }
  }

  /**
   * Finish the progress display
   *
   * @param success - Whether the overall migration was successful
   */
  finish(success: boolean): void {
    if (!this.isActive) return;

    this.isActive = false;

    // Clean up timers and handlers
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    if (this.resizeHandler && typeof process.stdout.off === 'function') {
      process.stdout.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    if (this.config.interactive) {
      // Stop multi-bar and render final state
      if (this.multiBar) {
        this.multiBar.stop();
        this.multiBar = null;
      }
      // Render final summary
      this.renderFinalSummary(success);
    } else {
      this.logNonInteractiveSummary(success);
    }

    // Clear state
    this.tableBars.clear();
  }

  /**
   * Get current memory usage in bytes
   */
  getMemoryUsage(): number {
    return process.memoryUsage().heapUsed;
  }

  /**
   * Get elapsed time in seconds since start
   */
  getElapsedTime(): number {
    return (Date.now() - this.overallStartTime) / 1000;
  }

  /**
   * Get overall progress percentage
   */
  getOverallProgress(): number {
    let totalRows = 0;
    let completedRows = 0;

    for (const state of this.tables.values()) {
      totalRows += state.total;
      completedRows += state.current;
    }

    return totalRows > 0 ? (completedRows / totalRows) * 100 : 0;
  }

  /**
   * Get count of tables by status
   */
  getTableCounts(): Record<TableStatus | 'total', number> {
    const counts: Record<TableStatus | 'total', number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      error: 0,
      total: this.tables.size,
    };

    for (const state of this.tables.values()) {
      counts[state.status]++;
    }

    return counts;
  }

  // ==================== PRIVATE: INTERACTIVE MODE ====================

  private setupInteractiveMode(): void {
    // Set up resize handler
    this.resizeHandler = this.handleResize;
    if (typeof process.stdout.on === 'function') {
      process.stdout.on('resize', this.resizeHandler);
    }

    // Create multi-bar container
    this.multiBar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: this.getBarFormat(),
        barCompleteChar: CHARS.BAR_FILLED,
        barIncompleteChar: CHARS.BAR_EMPTY,
        fps: 10,
        etaBuffer: 20,
      },
      cliProgress.Presets.shades_classic
    );

    // Render header
    this.renderHeader();

    // Create bars for each table
    for (const tableName of this.tableOrder) {
      const state = this.tables.get(tableName)!;
      const bar = this.multiBar.create(state.total || 1, 0, {
        tableName: this.padTableName(tableName),
        status: CHARS.PENDING,
        throughput: '',
        eta: '',
        batch: '',
      });
      this.tableBars.set(tableName, bar);
    }

    // Set up periodic update timer for footer
    this.updateTimer = setInterval(() => {
      this.renderFooter();
    }, this.config.updateInterval);
  }

  private getBarFormat(): string {
    const c = this.config.colors ? chalk : this.noColorChalk();
    const parts: string[] = [];

    // Status icon and table name
    parts.push('  {status}');
    parts.push(c.white('{tableName}'));

    // Progress bar
    parts.push(`[${c.cyan('{bar}')}]`);

    // Percentage
    parts.push(c.white('{percentage}%'));

    // Row count
    parts.push(c.gray('|'));
    parts.push(c.white('{value}/{total} rows'));

    // Throughput
    if (this.config.showThroughput) {
      parts.push('{throughput}');
    }

    // ETA
    if (this.config.showEta) {
      parts.push('{eta}');
    }

    // Batch number
    if (this.config.showBatchNumber) {
      parts.push('{batch}');
    }

    return parts.join(' ');
  }

  private updateInteractiveDisplay(): void {
    const now = Date.now();
    if (now - this.lastRenderTime < 50) return; // Throttle updates
    this.lastRenderTime = now;

    const c = this.config.colors ? chalk : this.noColorChalk();

    for (const [tableName, state] of this.tables) {
      const bar = this.tableBars.get(tableName);
      if (!bar) continue;

      // Determine status icon
      let statusIcon: string;
      switch (state.status) {
        case 'completed':
          statusIcon = c.green(CHARS.CHECK);
          break;
        case 'in_progress':
          statusIcon = c.yellow(CHARS.SPINNER);
          break;
        case 'error':
          statusIcon = c.red(CHARS.ERROR);
          break;
        default:
          statusIcon = c.gray(CHARS.PENDING);
      }

      // Calculate throughput display
      let throughputStr = '';
      if (this.config.showThroughput && state.status === 'in_progress') {
        throughputStr =
          state.throughput > 0
            ? c.gray(`| ${formatNumber(Math.round(state.throughput))} rows/s`)
            : '';
      }

      // Calculate ETA display
      let etaStr = '';
      if (this.config.showEta && state.status === 'in_progress') {
        const remaining = state.total - state.current;
        const eta = calculateEta(remaining, state.throughput);
        etaStr = eta !== '--' ? c.gray(`| ETA: ${eta}`) : '';
      }

      // Batch display
      let batchStr = '';
      if (
        this.config.showBatchNumber &&
        state.batchNumber > 0 &&
        state.status === 'in_progress'
      ) {
        batchStr = c.gray(`| batch ${state.batchNumber}`);
      }

      // Duration display for completed tables
      if (state.status === 'completed' && state.duration !== undefined) {
        etaStr = c.gray(`| ${formatDuration(state.duration)}`);
      }

      bar.update(state.current, {
        tableName: this.padTableName(tableName),
        status: statusIcon,
        throughput: throughputStr,
        eta: etaStr,
        batch: batchStr,
      });
    }
  }

  private renderHeader(): void {
    const c = this.config.colors ? chalk : this.noColorChalk();
    const totalTables = this.tables.size;
    const completedTables = this.getTableCounts().completed;
    const percent =
      totalTables > 0 ? Math.round((completedTables / totalTables) * 100) : 0;

    console.log();
    console.log(c.bold.white('  Migration Progress'));

    // Overall progress bar
    const barWidth = Math.min(40, getTerminalWidth() - 30);
    const filledWidth = Math.round((percent / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;
    const progressBar =
      CHARS.LINE.repeat(filledWidth) + c.gray(CHARS.LINE.repeat(emptyWidth));
    console.log(
      `  ${c.cyan(progressBar)} ${percent}% | ${completedTables}/${totalTables} tables`
    );
    console.log();
  }

  private renderFooter(): void {
    // Footer is continuously updated via cursor manipulation
    // For simplicity with cli-progress, we log occasionally
    if (this.config.showMemory) {
      const memUsage = formatBytes(this.getMemoryUsage());
      const elapsed = formatDuration(this.getElapsedTime());
      // Using stderr to avoid interfering with progress bars
      process.stderr.write(
        `\r  Memory: ${memUsage} | Elapsed: ${elapsed}      `
      );
    }
  }

  private renderFinalSummary(success: boolean): void {
    const c = this.config.colors ? chalk : this.noColorChalk();
    const counts = this.getTableCounts();
    const elapsed = formatDuration(this.getElapsedTime());
    const memUsage = formatBytes(this.getMemoryUsage());

    console.log();
    console.log();

    // Overall status bar
    const percent =
      counts.total > 0
        ? Math.round((counts.completed / counts.total) * 100)
        : 0;
    const barWidth = Math.min(40, getTerminalWidth() - 30);
    const filledWidth = Math.round((percent / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;
    const barColor = success ? c.green : counts.error > 0 ? c.red : c.yellow;
    const progressBar =
      barColor(CHARS.LINE.repeat(filledWidth)) +
      c.gray(CHARS.LINE.repeat(emptyWidth));

    console.log(c.bold.white('  Migration Progress'));
    console.log(
      `  ${progressBar} ${percent}% | ${counts.completed}/${counts.total} tables`
    );
    console.log();

    // Table summary
    for (const tableName of this.tableOrder) {
      const state = this.tables.get(tableName)!;
      let statusIcon: string;
      let statusColor: typeof c.green;

      switch (state.status) {
        case 'completed':
          statusIcon = CHARS.CHECK;
          statusColor = c.green;
          break;
        case 'error':
          statusIcon = CHARS.ERROR;
          statusColor = c.red;
          break;
        case 'in_progress':
          statusIcon = CHARS.SPINNER;
          statusColor = c.yellow;
          break;
        default:
          statusIcon = CHARS.PENDING;
          statusColor = c.gray;
      }

      const rowInfo = `${formatNumber(state.current)}/${formatNumber(state.total)} rows`;
      const durationInfo =
        state.duration !== undefined
          ? ` | ${formatDuration(state.duration)}`
          : '';
      const paddedName = this.padTableName(tableName);
      const barStr = this.renderMiniBar(
        state.current,
        state.total,
        this.config.barWidth,
        state.status
      );

      console.log(
        `  ${statusColor(statusIcon)} ${c.white(paddedName)} ${barStr} ${c.gray(rowInfo)}${c.gray(durationInfo)}`
      );

      if (state.status === 'error' && state.errorMessage) {
        console.log(c.red(`    Error: ${state.errorMessage}`));
      }
    }

    console.log();
    console.log(c.gray(`  Memory: ${memUsage} | Elapsed: ${elapsed}`));
    console.log();
  }

  private renderMiniBar(
    current: number,
    total: number,
    width: number,
    status: TableStatus
  ): string {
    const c = this.config.colors ? chalk : this.noColorChalk();
    const percent = total > 0 ? current / total : 0;
    const filledWidth = Math.round(percent * width);
    const emptyWidth = width - filledWidth;

    let barColor: typeof c.green;
    switch (status) {
      case 'completed':
        barColor = c.green;
        break;
      case 'error':
        barColor = c.red;
        break;
      case 'in_progress':
        barColor = c.yellow;
        break;
      default:
        barColor = c.gray;
    }

    const filled = barColor(CHARS.BAR_FILLED.repeat(filledWidth));
    const empty = c.gray(CHARS.BAR_EMPTY.repeat(emptyWidth));
    const percentStr = Math.round(percent * 100)
      .toString()
      .padStart(3, ' ');

    return `[${filled}${empty}] ${c.white(percentStr)}%`;
  }

  private padTableName(name: string): string {
    // Calculate max table name length for alignment
    const maxLen = Math.max(
      ...Array.from(this.tables.keys()).map((n) => n.length),
      10
    );
    return name.padEnd(maxLen);
  }

  private handleResize(): void {
    // On resize, we could re-render but cli-progress handles most of it
    // Just update our calculations
    this.updateInteractiveDisplay();
  }

  // ==================== PRIVATE: NON-INTERACTIVE MODE ====================

  private logNonInteractiveStart(): void {
    const c = this.config.colors ? chalk : this.noColorChalk();
    const totalRows = Array.from(this.tables.values()).reduce(
      (sum, t) => sum + t.total,
      0
    );

    console.log();
    console.log(c.bold.white('  Migration Progress'));
    console.log(c.gray('  ' + '-'.repeat(40)));
    console.log(`  Tables: ${this.tables.size}`);
    console.log(`  Total rows: ${formatNumber(totalRows)}`);
    console.log();
  }

  private logNonInteractiveProgress(
    table: string,
    state: TableProgressState
  ): void {
    // Log at 10%, 25%, 50%, 75%, 90%, 100%
    const percent =
      state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
    const milestones = [10, 25, 50, 75, 90, 100];

    // Find if we just crossed a milestone
    const previousPercent =
      state.total > 0
        ? Math.round(((state.current - 1) / state.total) * 100)
        : 0;

    for (const milestone of milestones) {
      if (previousPercent < milestone && percent >= milestone) {
        const c = this.config.colors ? chalk : this.noColorChalk();
        const throughputStr =
          state.throughput > 0
            ? ` | ${formatNumber(Math.round(state.throughput))} rows/s`
            : '';
        console.log(
          c.gray(
            `  [${table}] ${percent}% - ${formatNumber(state.current)}/${formatNumber(state.total)} rows${throughputStr}`
          )
        );
        break;
      }
    }
  }

  private logNonInteractiveComplete(
    table: string,
    state: TableProgressState,
    success: boolean
  ): void {
    const c = this.config.colors ? chalk : this.noColorChalk();
    const statusStr = success ? c.green('DONE') : c.red('FAIL');
    const durationStr =
      state.duration !== undefined ? formatDuration(state.duration) : '--';
    const rowsStr = `${formatNumber(state.current)}/${formatNumber(state.total)} rows`;

    console.log(`  ${statusStr} ${table}: ${rowsStr} | ${durationStr}`);
  }

  private logNonInteractiveError(table: string, errorMessage: string): void {
    const c = this.config.colors ? chalk : this.noColorChalk();
    console.log(c.red(`  ERROR ${table}: ${errorMessage}`));
  }

  private logNonInteractiveSummary(success: boolean): void {
    const c = this.config.colors ? chalk : this.noColorChalk();
    const counts = this.getTableCounts();
    const elapsed = formatDuration(this.getElapsedTime());
    const memUsage = formatBytes(this.getMemoryUsage());

    console.log();
    console.log(c.gray('  ' + '-'.repeat(40)));

    let totalRows = 0;
    let migratedRows = 0;
    for (const state of this.tables.values()) {
      totalRows += state.total;
      migratedRows += state.current;
    }

    console.log(`  Tables completed: ${counts.completed}/${counts.total}`);
    console.log(
      `  Rows migrated: ${formatNumber(migratedRows)}/${formatNumber(totalRows)}`
    );
    if (counts.error > 0) {
      console.log(c.red(`  Errors: ${counts.error} table(s) failed`));
    }
    console.log(`  Memory: ${memUsage}`);
    console.log(`  Elapsed: ${elapsed}`);

    if (success) {
      console.log(c.green('  Status: Completed successfully'));
    } else {
      console.log(c.red('  Status: Completed with errors'));
    }
    console.log();
  }

  // ==================== PRIVATE: UTILITIES ====================

  private noColorChalk(): typeof chalk {
    const identity = (s: string): string => s;
    const chainable = Object.assign(identity, {
      green: identity,
      red: identity,
      yellow: identity,
      cyan: identity,
      gray: identity,
      white: identity,
      bold: {
        white: identity,
        green: identity,
        red: identity,
        yellow: identity,
        cyan: identity,
      },
    });
    // Type assertion to satisfy TypeScript
    return chainable as unknown as typeof chalk;
  }
}

/**
 * Create a new MigrationProgressBar instance with optional configuration
 */
export function createMigrationProgressBar(
  config?: MigrationProgressBarConfig
): MigrationProgressBar {
  return new MigrationProgressBar(config);
}

/**
 * Default export for convenience
 */
export default MigrationProgressBar;
