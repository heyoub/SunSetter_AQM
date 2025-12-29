/**
 * Progress Reporter - Production-Quality CLI UX
 *
 * Comprehensive logging and progress reporting with:
 * - Structured logging with levels (debug, info, warn, error)
 * - File output option (--log-file)
 * - JSON format option for machine-readable logs
 * - Timestamp prefixes
 * - Spinners, progress bars, and formatted output
 */

import ora, { Ora } from 'ora';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import * as fs from 'fs';
import * as path from 'path';
import type { LogLevel, ProgressStats } from '../../convex/types.js';
import {
  formatError,
  formatErrorJson,
  MigrationError,
} from '../errors/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended log levels for fine-grained control
 */
export type ExtendedLogLevel =
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'quiet'
  | 'normal'
  | 'verbose';

/**
 * Structured log entry for JSON output
 */
export interface LogEntry {
  timestamp: string;
  level: ExtendedLogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    code?: string;
    message: string;
    stack?: string;
  };
}

/**
 * Progress reporter configuration
 */
export interface ProgressReporterConfig {
  /** Log level threshold */
  logLevel: ExtendedLogLevel;
  /** Output logs as JSON */
  json: boolean;
  /** Write logs to file */
  logFile?: string;
  /** Show timestamps in output */
  showTimestamps: boolean;
  /** Use colors in output */
  colors: boolean;
  /** Show spinners and progress bars */
  interactive: boolean;
}

// ============================================================================
// Logger Class
// ============================================================================

/**
 * Structured logger for file and console output
 */
class Logger {
  private logFile: fs.WriteStream | null = null;
  private config: ProgressReporterConfig;
  private buffer: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(config: ProgressReporterConfig) {
    this.config = config;

    if (config.logFile) {
      this.initLogFile(config.logFile);
    }

    // Flush buffer periodically
    this.flushInterval = setInterval(() => this.flush(), 1000);
  }

  /**
   * Initialize log file
   */
  private initLogFile(filePath: string): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.logFile = fs.createWriteStream(filePath, { flags: 'a' });

      // Write session header
      const header: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Migration session started',
        context: {
          pid: process.pid,
          nodeVersion: process.version,
          platform: process.platform,
        },
      };
      this.writeToFile(header);
    } catch (error) {
      console.error(`Failed to open log file: ${(error as Error).message}`);
    }
  }

  /**
   * Write entry to log file
   */
  private writeToFile(entry: LogEntry): void {
    if (this.logFile) {
      this.logFile.write(JSON.stringify(entry) + '\n');
    }
  }

  /**
   * Log an entry
   */
  log(
    level: ExtendedLogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };

    if (error) {
      entry.error = {
        code: error instanceof MigrationError ? error.code : undefined,
        message: error.message,
        stack: error.stack,
      };
    }

    // Buffer for batch file writes
    this.buffer.push(entry);

    // Immediate flush for errors
    if (level === 'error') {
      this.flush();
    }
  }

  /**
   * Flush buffer to file
   */
  flush(): void {
    if (this.logFile && this.buffer.length > 0) {
      for (const entry of this.buffer) {
        this.writeToFile(entry);
      }
      this.buffer = [];
    }
  }

  /**
   * Close logger
   */
  close(): void {
    this.flush();
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    if (this.logFile) {
      this.logFile.end();
      this.logFile = null;
    }
  }
}

// ============================================================================
// Progress Reporter
// ============================================================================

/**
 * Production-quality progress reporter for CLI operations
 * Supports quiet, normal, verbose, and debug modes
 * With file logging, JSON output, and structured logging
 */
export class ProgressReporter {
  private spinner: Ora;
  private progressBar: cliProgress.SingleBar | null = null;
  private config: ProgressReporterConfig;
  private stats: ProgressStats;
  private logger: Logger;
  private currentProgressTotal: number = 0;
  private currentProgressValue: number = 0;

  constructor(options: Partial<ProgressReporterConfig> = {}) {
    this.config = {
      logLevel: options.logLevel || 'normal',
      json: options.json || false,
      logFile: options.logFile,
      showTimestamps: options.showTimestamps ?? false,
      colors: options.colors ?? true,
      interactive: options.interactive ?? process.stdout.isTTY ?? false,
    };

    this.spinner = ora({
      spinner: 'dots',
      color: 'cyan',
    });

    this.stats = {
      tables: { total: 0, completed: 0 },
      files: { total: 0, completed: 0 },
      startTime: Date.now(),
    };

    this.logger = new Logger(this.config);
  }

  // ==================== LOG LEVEL HELPERS ====================

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: ExtendedLogLevel): boolean {
    const levels: ExtendedLogLevel[] = [
      'debug',
      'verbose',
      'info',
      'normal',
      'warn',
      'error',
      'quiet',
    ];
    const configLevel = this.config.logLevel;

    // Map normal to info for comparison
    const normalizedConfig = configLevel === 'normal' ? 'info' : configLevel;
    const normalizedLevel = level === 'normal' ? 'info' : level;

    const configIndex = levels.indexOf(normalizedConfig);
    const levelIndex = levels.indexOf(normalizedLevel);

    // Quiet mode only shows errors
    if (configLevel === 'quiet') {
      return level === 'error';
    }

    return levelIndex >= configIndex;
  }

  /**
   * Format timestamp for output
   */
  private formatTimestamp(): string {
    if (!this.config.showTimestamps) return '';
    const now = new Date();
    return chalk.gray(`[${now.toISOString()}] `);
  }

  /**
   * Get color function for log level
   */
  private getLevelColor(level: ExtendedLogLevel): (s: string) => string {
    if (!this.config.colors) return (s: string) => s;

    switch (level) {
      case 'debug':
        return chalk.gray;
      case 'info':
      case 'normal':
        return chalk.cyan;
      case 'warn':
        return chalk.yellow;
      case 'error':
        return chalk.red;
      default:
        return (s: string) => s;
    }
  }

  /**
   * Get level prefix
   */
  private getLevelPrefix(level: ExtendedLogLevel): string {
    switch (level) {
      case 'debug':
        return '[DEBUG]';
      case 'info':
      case 'normal':
        return '[INFO]';
      case 'warn':
        return '[WARN]';
      case 'error':
        return '[ERROR]';
      default:
        return '';
    }
  }

  // ==================== CORE LOGGING ====================

  /**
   * Core logging function
   */
  private logMessage(
    level: ExtendedLogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    // Always log to file
    this.logger.log(level, message, context, error);

    // Check if should output to console
    if (!this.shouldLog(level)) return;

    // Stop spinner temporarily for clean output
    const spinnerWasActive = this.spinner.isSpinning;
    if (spinnerWasActive) {
      this.spinner.stop();
    }

    if (this.config.json) {
      // JSON output
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        context,
      };
      if (error) {
        entry.error = {
          code: error instanceof MigrationError ? error.code : undefined,
          message: error.message,
        };
      }
      console.log(JSON.stringify(entry));
    } else {
      // Formatted output
      const timestamp = this.formatTimestamp();
      const prefix = this.config.showTimestamps
        ? this.getLevelPrefix(level) + ' '
        : '';
      const colorFn = this.getLevelColor(level);
      const formattedMessage = `  ${timestamp}${prefix}${message}`;
      console.log(colorFn(formattedMessage));

      // Log context if present and verbose
      if (
        context &&
        (this.config.logLevel === 'debug' || this.config.logLevel === 'verbose')
      ) {
        for (const [key, value] of Object.entries(context)) {
          const valueStr =
            typeof value === 'object' ? JSON.stringify(value) : String(value);
          console.log(chalk.gray(`    ${key}: ${valueStr}`));
        }
      }
    }

    // Restart spinner if it was active
    if (spinnerWasActive) {
      this.spinner.start();
    }
  }

  /**
   * Debug level logging
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.logMessage('debug', message, context);
  }

  /**
   * Info level logging
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.logMessage('info', message, context);
  }

  /**
   * Warning level logging
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.logMessage('warn', message, context);
  }

  /**
   * Error level logging
   */
  error(
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    this.logMessage('error', message, context, error);

    // For MigrationError, use formatted error output
    if (error instanceof MigrationError && !this.config.json) {
      console.error(
        formatError(error, {
          verbose:
            this.config.logLevel === 'verbose' ||
            this.config.logLevel === 'debug',
          colors: this.config.colors,
        })
      );
    }
  }

  /**
   * Log a message (respects log level) - backward compatible
   */
  log(message: string): void {
    this.logMessage('info', message);
  }

  /**
   * Log only in verbose mode - backward compatible
   */
  verbose(message: string, context?: Record<string, unknown>): void {
    if (
      this.config.logLevel === 'verbose' ||
      this.config.logLevel === 'debug'
    ) {
      this.logMessage('debug', message, context);
    }
  }

  /**
   * Log a success message
   */
  success(message: string): void {
    if (this.config.json || this.config.logLevel === 'quiet') return;
    console.log(chalk.green(`  ${message}`));
  }

  // ==================== SPINNER OPERATIONS ====================

  /**
   * Start a spinner with a message
   */
  startSpinner(message: string): void {
    if (
      this.config.json ||
      this.config.logLevel === 'quiet' ||
      !this.config.interactive
    ) {
      this.log(message);
      return;
    }
    this.spinner.start(chalk.gray(message));
  }

  /**
   * Update spinner text
   */
  updateSpinner(message: string): void {
    if (
      this.config.json ||
      this.config.logLevel === 'quiet' ||
      !this.config.interactive
    )
      return;
    this.spinner.text = chalk.gray(message);
  }

  /**
   * Mark spinner as succeeded
   */
  succeedSpinner(message: string): void {
    if (this.config.json || this.config.logLevel === 'quiet') return;
    if (!this.config.interactive) {
      this.log(message);
      return;
    }
    this.spinner.succeed(chalk.green(message));
  }

  /**
   * Mark spinner as failed
   */
  failSpinner(message: string): void {
    if (this.config.json) return;
    if (!this.config.interactive) {
      this.error(message);
      return;
    }
    this.spinner.fail(chalk.red(message));
  }

  /**
   * Mark spinner with warning
   */
  warnSpinner(message: string): void {
    if (this.config.json || this.config.logLevel === 'quiet') return;
    if (!this.config.interactive) {
      this.warn(message);
      return;
    }
    this.spinner.warn(chalk.yellow(message));
  }

  /**
   * Stop spinner without status
   */
  stopSpinner(): void {
    this.spinner.stop();
  }

  // ==================== PROGRESS BAR OPERATIONS ====================

  /**
   * Start a progress bar
   */
  startProgressBar(total: number, label: string): void {
    if (
      this.config.json ||
      this.config.logLevel === 'quiet' ||
      !this.config.interactive
    ) {
      this.log(`Starting: ${label} (${total} items)`);
      return;
    }

    this.currentProgressTotal = total;
    this.currentProgressValue = 0;

    this.progressBar = new cliProgress.SingleBar(
      {
        format: `  ${chalk.cyan('{bar}')} {percentage}% | ${chalk.gray('{value}/{total}')} ${label} | ETA: {eta_formatted}`,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        etaBuffer: 10,
        fps: 10,
      },
      cliProgress.Presets.shades_classic
    );

    this.progressBar.start(total, 0);
  }

  /**
   * Update progress bar value
   */
  updateProgressBar(current: number, payload?: object): void {
    if (this.progressBar) {
      this.currentProgressValue = current;
      this.progressBar.update(current, payload);
    } else {
      // Non-interactive mode: log progress at intervals
      const percent = Math.round((current / this.currentProgressTotal) * 100);
      if (percent % 10 === 0) {
        this.debug(
          `Progress: ${percent}% (${current}/${this.currentProgressTotal})`
        );
      }
    }
  }

  /**
   * Increment progress bar
   */
  incrementProgressBar(amount: number | object = 1, payload?: object): void {
    if (this.progressBar) {
      if (typeof amount === 'number') {
        this.currentProgressValue += amount;
        this.progressBar.increment(amount, payload);
      } else {
        this.currentProgressValue += 1;
        this.progressBar.increment(1, amount);
      }
    }
  }

  /**
   * Stop and remove progress bar
   */
  stopProgressBar(): void {
    if (this.progressBar) {
      this.progressBar.stop();
      this.progressBar = null;
    }
  }

  // ==================== SECTION HEADERS ====================

  /**
   * Print a section header
   */
  section(title: string): void {
    if (this.config.json || this.config.logLevel === 'quiet') return;
    console.log();
    console.log(chalk.bold.white(`  ${title}`));
    console.log(chalk.gray('  ' + '\u2500'.repeat(title.length)));
  }

  /**
   * Print a subsection header
   */
  subsection(title: string): void {
    if (this.config.json || this.config.logLevel === 'quiet') return;
    console.log();
    console.log(chalk.white(`  ${title}`));
  }

  // ==================== TABLE DISPLAY ====================

  /**
   * Print a data table
   */
  table(data: Array<Record<string, string | number>>): void {
    if (this.config.json) {
      console.log(JSON.stringify(data));
      return;
    }
    if (this.config.logLevel === 'quiet') return;
    console.table(data);
  }

  /**
   * Print a simple key-value list
   */
  keyValue(items: Array<{ key: string; value: string | number }>): void {
    if (this.config.json) {
      const obj = Object.fromEntries(items.map((i) => [i.key, i.value]));
      console.log(JSON.stringify(obj));
      return;
    }
    if (this.config.logLevel === 'quiet') return;

    const maxKeyLen = Math.max(...items.map((i) => i.key.length));
    for (const item of items) {
      console.log(
        `  ${chalk.gray(item.key.padEnd(maxKeyLen))}  ${chalk.white(item.value)}`
      );
    }
  }

  // ==================== STATS & SUMMARY ====================

  /**
   * Set total tables count
   */
  setTotalTables(count: number): void {
    this.stats.tables.total = count;
  }

  /**
   * Set total files count
   */
  setTotalFiles(count: number): void {
    this.stats.files.total = count;
  }

  /**
   * Increment completed tables
   */
  incrementCompletedTables(): void {
    this.stats.tables.completed++;
  }

  /**
   * Increment completed files
   */
  incrementCompletedFiles(): void {
    this.stats.files.completed++;
  }

  /**
   * Print final summary with optional data
   */
  printSummary(data?: Record<string, string | number>): void {
    const elapsed = ((Date.now() - this.stats.startTime) / 1000).toFixed(2);

    if (this.config.json) {
      console.log(
        JSON.stringify({
          success: true,
          tables: this.stats.tables,
          files: this.stats.files,
          elapsedSeconds: parseFloat(elapsed),
          ...data,
        })
      );
      return;
    }

    if (this.config.logLevel === 'quiet') {
      console.log(
        `Generated ${this.stats.files.completed} files from ${this.stats.tables.completed} tables in ${elapsed}s`
      );
      return;
    }

    console.log();
    console.log(chalk.bold.green('  Summary'));
    console.log();
    console.log(chalk.gray('  ' + '\u2500'.repeat(35)));

    // Print custom data if provided
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        console.log(
          `  ${chalk.white(key + ':')}  ${chalk.cyan(String(value))}`
        );
      }
    } else {
      console.log(
        `  ${chalk.white('Tables processed:')}  ${chalk.cyan(this.stats.tables.completed)}`
      );
      console.log(
        `  ${chalk.white('Files generated:')}   ${chalk.cyan(this.stats.files.completed)}`
      );
      console.log(
        `  ${chalk.white('Time elapsed:')}      ${chalk.cyan(elapsed + 's')}`
      );
    }

    console.log(chalk.gray('  ' + '\u2500'.repeat(35)));
    console.log();
  }

  // ==================== FILE GENERATION FEEDBACK ====================

  /**
   * Report a file was generated
   */
  fileGenerated(filePath: string): void {
    this.incrementCompletedFiles();
    this.debug(`File generated: ${filePath}`);

    if (this.config.json || this.config.logLevel === 'quiet') return;

    if (
      this.config.logLevel === 'verbose' ||
      this.config.logLevel === 'debug'
    ) {
      console.log(chalk.green('  + ') + chalk.gray(filePath));
    }
  }

  /**
   * Report a file was skipped
   */
  fileSkipped(filePath: string, reason: string): void {
    this.debug(`File skipped: ${filePath}`, { reason });

    if (this.config.json || this.config.logLevel === 'quiet') return;

    console.log(
      chalk.yellow('  ~ ') + chalk.gray(filePath) + chalk.gray(` (${reason})`)
    );
  }

  /**
   * Report a file generation error
   */
  fileError(filePath: string, error: Error): void {
    this.error(`File error: ${filePath}`, error);

    if (this.config.json) return;

    console.error(chalk.red('  x ') + chalk.gray(filePath));
    if (
      this.config.logLevel === 'verbose' ||
      this.config.logLevel === 'debug'
    ) {
      console.error(chalk.gray(`    ${error.message}`));
    }
  }

  // ==================== TABLE PROCESSING FEEDBACK ====================

  /**
   * Report starting table processing
   */
  tableStarted(tableName: string): void {
    this.debug(`Starting table: ${tableName}`);

    if (this.config.json || this.config.logLevel === 'quiet') return;

    if (
      this.config.logLevel === 'verbose' ||
      this.config.logLevel === 'debug'
    ) {
      this.startSpinner(`Processing ${tableName}...`);
    }
  }

  /**
   * Report table processing completed
   */
  tableCompleted(
    tableName: string,
    stats: { queries: number; mutations: number }
  ): void {
    this.incrementCompletedTables();
    this.debug(`Completed table: ${tableName}`, stats);

    if (this.config.json || this.config.logLevel === 'quiet') return;

    if (
      this.config.logLevel === 'verbose' ||
      this.config.logLevel === 'debug'
    ) {
      this.succeedSpinner(
        `${tableName}: ${stats.queries} queries, ${stats.mutations} mutations`
      );
    }
  }

  // ==================== DATA MIGRATION FEEDBACK ====================

  /**
   * Report row migration progress
   */
  rowProgress(tableName: string, current: number, total: number): void {
    const percent = Math.round((current / total) * 100);
    this.debug(`${tableName}: ${current}/${total} rows (${percent}%)`);
  }

  /**
   * Report batch completion
   */
  batchCompleted(
    tableName: string,
    batchNumber: number,
    rowsInBatch: number,
    totalProcessed: number
  ): void {
    this.debug(`${tableName} batch ${batchNumber} complete`, {
      rowsInBatch,
      totalProcessed,
    });
  }

  // ==================== DRY RUN MODE ====================

  /**
   * Print dry run summary
   */
  printDryRunSummary(files: string[]): void {
    if (this.config.json) {
      console.log(JSON.stringify({ dryRun: true, files }));
      return;
    }

    console.log();
    console.log(chalk.bold.yellow('  Dry Run - No files written'));
    console.log();
    console.log(chalk.gray('  Files that would be generated:'));
    for (const file of files) {
      console.log(chalk.green('  + ') + chalk.gray(file));
    }
    console.log();
  }

  // ==================== BRANDING ====================

  /**
   * Print welcome banner
   */
  printWelcome(
    title: string = 'PostgreSQL to Convex Migration',
    version?: string
  ): void {
    if (this.config.json || this.config.logLevel === 'quiet') return;

    console.log();
    const versionStr = version ? ` v${version}` : '';
    console.log(chalk.bold.cyan(`  ${title}${versionStr}`));
    console.log(
      chalk.gray('  ' + '\u2500'.repeat(title.length + versionStr.length))
    );
    console.log();
  }

  /**
   * Print a boxed message
   */
  box(
    message: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info'
  ): void {
    if (this.config.json || this.config.logLevel === 'quiet') return;

    const colors = {
      info: chalk.cyan,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
    };

    const color = colors[type];
    const lines = message.split('\n');
    const maxLen = Math.max(...lines.map((l) => l.length));
    const border = '\u2500'.repeat(maxLen + 2);

    console.log();
    console.log(color(`  \u250C${border}\u2510`));
    for (const line of lines) {
      console.log(color(`  \u2502 ${line.padEnd(maxLen)} \u2502`));
    }
    console.log(color(`  \u2514${border}\u2518`));
    console.log();
  }

  // ==================== PERFORMANCE METRICS ====================

  /**
   * Log performance metrics
   */
  logMetrics(metrics: {
    rowsPerSecond?: number;
    bytesProcessed?: number;
    memoryUsage?: number;
  }): void {
    if (this.config.logLevel !== 'debug' && this.config.logLevel !== 'verbose')
      return;

    const parts: string[] = [];
    if (metrics.rowsPerSecond !== undefined) {
      parts.push(`${metrics.rowsPerSecond.toFixed(1)} rows/s`);
    }
    if (metrics.bytesProcessed !== undefined) {
      const mb = (metrics.bytesProcessed / 1024 / 1024).toFixed(2);
      parts.push(`${mb} MB processed`);
    }
    if (metrics.memoryUsage !== undefined) {
      const mb = (metrics.memoryUsage / 1024 / 1024).toFixed(2);
      parts.push(`${mb} MB memory`);
    }

    if (parts.length > 0) {
      this.debug(`Performance: ${parts.join(' | ')}`);
    }
  }

  // ==================== UTILITY ====================

  /**
   * Get current stats
   */
  getStats(): ProgressStats {
    return { ...this.stats };
  }

  /**
   * Reset stats
   */
  reset(): void {
    this.stats = {
      tables: { total: 0, completed: 0 },
      files: { total: 0, completed: 0 },
      startTime: Date.now(),
    };
  }

  /**
   * Set log level
   */
  setLogLevel(level: ExtendedLogLevel): void {
    this.config.logLevel = level;
  }

  /**
   * Check if JSON mode is enabled
   */
  isJsonMode(): boolean {
    return this.config.json;
  }

  /**
   * Get the log file path
   */
  getLogFilePath(): string | undefined {
    return this.config.logFile;
  }

  /**
   * Close the reporter (flush logs, close file handles)
   */
  close(): void {
    this.stopProgressBar();
    this.stopSpinner();
    this.logger.close();
  }

  /**
   * Create a child reporter with modified settings
   */
  child(overrides: Partial<ProgressReporterConfig>): ProgressReporter {
    return new ProgressReporter({
      ...this.config,
      ...overrides,
    });
  }
}

/**
 * Create a reporter instance with default settings
 */
export function createReporter(
  options?: Partial<ProgressReporterConfig> & { logLevel?: LogLevel }
): ProgressReporter {
  return new ProgressReporter(options);
}

/**
 * Create a logger-only instance (no spinners/progress)
 */
export function createLogger(options: {
  logFile?: string;
  logLevel?: ExtendedLogLevel;
  json?: boolean;
}): ProgressReporter {
  return new ProgressReporter({
    ...options,
    interactive: false,
    showTimestamps: true,
  });
}
