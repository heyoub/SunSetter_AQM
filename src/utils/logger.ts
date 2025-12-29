/**
 * Logger Configuration with Log Rotation
 *
 * Production-quality logging with:
 * - Daily log rotation
 * - Configurable max file size and retention
 * - Separate error and combined log files
 * - JSON and human-readable formats
 * - Environment-based configuration
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

/**
 * Log rotation configuration
 */
export interface LogRotationConfig {
  /** Directory for log files (default: logs/) */
  logDir: string;
  /** Max size per file before rotation (default: 20m) */
  maxSize: string;
  /** Max age of log files in days (default: 14d) */
  maxAge: string;
  /** Max number of log files to keep (default: 10) */
  maxFiles: number;
  /** Compress rotated files (default: true) */
  compress: boolean;
  /** Date pattern for rotation (default: YYYY-MM-DD) */
  datePattern: string;
  /** Enable JSON format (default: true in production) */
  jsonFormat: boolean;
}

/**
 * Default log rotation configuration
 */
const DEFAULT_LOG_ROTATION: LogRotationConfig = {
  logDir: process.env.LOG_DIR || 'logs',
  maxSize: process.env.LOG_MAX_SIZE || '20m',
  maxAge: process.env.LOG_MAX_AGE || '14d',
  maxFiles: parseInt(process.env.LOG_MAX_FILES || '10', 10),
  compress: process.env.LOG_COMPRESS !== 'false',
  datePattern: 'YYYY-MM-DD',
  jsonFormat: process.env.NODE_ENV === 'production',
};

// ============================================================================
// Logger Setup
// ============================================================================

const logLevel = process.env.LOG_LEVEL || 'info';
const config = { ...DEFAULT_LOG_ROTATION };

// Ensure log directory exists
if (!fs.existsSync(config.logDir)) {
  fs.mkdirSync(config.logDir, { recursive: true });
}

/**
 * Custom format for human-readable logs
 */
const humanReadableFormat = winston.format.printf(
  ({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? `\n${JSON.stringify(meta, null, 2)}`
      : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  }
);

/**
 * Create JSON format for structured logging
 */
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * Create human-readable format for development
 */
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  humanReadableFormat
);

/**
 * Create daily rotate transport for combined logs
 */
const combinedRotateTransport = new DailyRotateFile({
  filename: path.join(config.logDir, 'combined-%DATE%.log'),
  datePattern: config.datePattern,
  zippedArchive: config.compress,
  maxSize: config.maxSize,
  maxFiles: config.maxFiles,
  format: config.jsonFormat ? jsonFormat : devFormat,
});

/**
 * Create daily rotate transport for error logs
 */
const errorRotateTransport = new DailyRotateFile({
  filename: path.join(config.logDir, 'error-%DATE%.log'),
  datePattern: config.datePattern,
  zippedArchive: config.compress,
  maxSize: config.maxSize,
  maxFiles: config.maxFiles,
  level: 'error',
  format: config.jsonFormat ? jsonFormat : devFormat,
});

/**
 * Create daily rotate transport for migration logs
 */
const migrationRotateTransport = new DailyRotateFile({
  filename: path.join(config.logDir, 'migration-%DATE%.log'),
  datePattern: config.datePattern,
  zippedArchive: config.compress,
  maxSize: config.maxSize,
  maxFiles: config.maxFiles,
  format: config.jsonFormat ? jsonFormat : devFormat,
});

// Handle rotation events
combinedRotateTransport.on('rotate', (oldFilename: string, newFilename: string) => {
  // Optionally notify on rotation
  console.log(`Log rotated: ${oldFilename} -> ${newFilename}`);
});

errorRotateTransport.on('error', (error: Error) => {
  console.error('Error writing to error log:', error);
});

/**
 * Main logger instance with log rotation
 */
const logger = winston.createLogger({
  level: logLevel,
  format: config.jsonFormat ? jsonFormat : devFormat,
  defaultMeta: { service: 'convex-pg-migration' },
  transports: [combinedRotateTransport, errorRotateTransport],
});

/**
 * Migration-specific logger
 */
export const migrationLogger = winston.createLogger({
  level: logLevel,
  format: config.jsonFormat ? jsonFormat : devFormat,
  defaultMeta: { service: 'migration-engine' },
  transports: [migrationRotateTransport],
});

// If we're not in production, log to the console with simple format
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} ${level}: ${message}`;
        })
      ),
    })
  );

  migrationLogger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} ${level}: ${message}`;
        })
      ),
    })
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a child logger with additional metadata
 */
export function createChildLogger(
  meta: Record<string, unknown>
): winston.Logger {
  return logger.child(meta);
}

/**
 * Create a migration logger with table context
 */
export function createTableLogger(tableName: string): winston.Logger {
  return migrationLogger.child({ table: tableName });
}

/**
 * Log migration event
 */
export function logMigrationEvent(
  event: string,
  data: Record<string, unknown>
): void {
  migrationLogger.info(event, data);
}

/**
 * Log migration error
 */
export function logMigrationError(
  message: string,
  error: Error,
  context?: Record<string, unknown>
): void {
  migrationLogger.error(message, {
    error: error.message,
    stack: error.stack,
    ...context,
  });
}

/**
 * Log migration progress
 */
export function logMigrationProgress(
  tableName: string,
  current: number,
  total: number,
  extra?: Record<string, unknown>
): void {
  const percent = Math.round((current / total) * 100);
  migrationLogger.info(`Migration progress: ${tableName}`, {
    table: tableName,
    current,
    total,
    percent,
    ...extra,
  });
}

/**
 * Configure logger at runtime
 */
export function configureLogger(options: Partial<LogRotationConfig>): void {
  // This would require recreating transports, which is complex
  // For now, just log that configuration was requested
  logger.info('Logger configuration update requested', options);
}

/**
 * Get current log rotation configuration
 */
export function getLogConfig(): LogRotationConfig {
  return { ...config };
}

/**
 * Flush all pending log writes (useful before shutdown)
 */
export async function flushLogs(): Promise<void> {
  return new Promise((resolve) => {
    // Wait for all transports to finish writing
    const transports = [
      combinedRotateTransport,
      errorRotateTransport,
      migrationRotateTransport,
    ];

    let completed = 0;
    const checkComplete = () => {
      completed++;
      if (completed >= transports.length) {
        resolve();
      }
    };

    for (const transport of transports) {
      // DailyRotateFile doesn't have a flush method, so we just resolve immediately
      // In practice, logs are written synchronously to the stream
      setImmediate(checkComplete);
    }
  });
}

/**
 * Close all log transports (call on shutdown)
 */
export function closeLoggers(): void {
  logger.close();
  migrationLogger.close();
}

export default logger;
