/**
 * JSON Output Handler
 *
 * Provides structured JSON output for CLI commands.
 * Useful for CI/CD pipelines and programmatic access.
 */

// ============================================================================
// Types
// ============================================================================

export interface JsonOutput<T = unknown> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Operation that was performed */
  operation: string;
  /** Timestamp of the operation */
  timestamp: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** The actual data/result */
  data?: T;
  /** Error information if failed */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  /** Warnings that occurred */
  warnings?: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface IntrospectionJsonOutput {
  schemaName: string;
  tables: Array<{
    name: string;
    rowCount: number;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      isPrimaryKey: boolean;
      isForeignKey: boolean;
      defaultValue?: string;
    }>;
    primaryKeys: string[];
    foreignKeys: Array<{
      column: string;
      referencesTable: string;
      referencesColumn: string;
    }>;
    indexes: Array<{
      name: string;
      columns: string[];
      unique: boolean;
    }>;
  }>;
  views: string[];
  totalRows: number;
  totalTables: number;
}

export interface MigrationJsonOutput {
  migrationId: string;
  status: 'completed' | 'failed' | 'partial' | 'dry-run';
  tables: Array<{
    name: string;
    status: 'success' | 'failed' | 'skipped';
    rowsMigrated: number;
    rowsFailed: number;
    durationMs: number;
    errors?: string[];
  }>;
  totalRowsMigrated: number;
  totalRowsFailed: number;
  totalDurationMs: number;
  generatedFiles?: string[];
}

export interface PreflightJsonOutput {
  valid: boolean;
  tables: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
    hasPrimaryKey: boolean;
    hasUnsupportedTypes: boolean;
    estimatedMigrationTimeMs: number;
  }>;
  totalRows: number;
  estimatedDuration: {
    optimistic: number;
    realistic: number;
    pessimistic: number;
  };
  blockers: string[];
  warnings: string[];
  recommendations: string[];
}

export interface GenerationJsonOutput {
  outputDir: string;
  files: Array<{
    path: string;
    type: 'schema' | 'query' | 'mutation' | 'action' | 'http' | 'validator';
    tables: string[];
    linesOfCode: number;
  }>;
  totalFiles: number;
  totalLinesOfCode: number;
}

// ============================================================================
// Output Functions
// ============================================================================

/**
 * Create a success JSON output
 */
export function createSuccessOutput<T>(
  operation: string,
  data: T,
  options?: {
    durationMs?: number;
    warnings?: string[];
    metadata?: Record<string, unknown>;
  }
): JsonOutput<T> {
  return {
    success: true,
    operation,
    timestamp: new Date().toISOString(),
    durationMs: options?.durationMs,
    data,
    warnings: options?.warnings,
    metadata: options?.metadata,
  };
}

/**
 * Create an error JSON output
 */
export function createErrorOutput(
  operation: string,
  error: Error | { code: string; message: string; details?: unknown },
  options?: {
    durationMs?: number;
    warnings?: string[];
    metadata?: Record<string, unknown>;
  }
): JsonOutput {
  const errorInfo =
    error instanceof Error
      ? {
          code: (error as Error & { code?: string }).code || 'ERR_UNKNOWN',
          message: error.message,
          details: (error as Error & { details?: unknown }).details,
        }
      : error;

  return {
    success: false,
    operation,
    timestamp: new Date().toISOString(),
    durationMs: options?.durationMs,
    error: errorInfo,
    warnings: options?.warnings,
    metadata: options?.metadata,
  };
}

/**
 * Print JSON output to stdout
 */
export function printJson<T>(
  output: JsonOutput<T>,
  pretty: boolean = true
): void {
  const json = pretty
    ? JSON.stringify(output, null, 2)
    : JSON.stringify(output);
  console.log(json);
}

/**
 * Print JSON data directly (for simple outputs)
 */
export function printJsonData<T>(data: T, pretty: boolean = true): void {
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  console.log(json);
}

// ============================================================================
// Output State Manager
// ============================================================================

/**
 * Manages output mode (JSON vs pretty) globally
 */
class OutputManager {
  private jsonMode: boolean = false;
  private prettyPrint: boolean = true;
  private quietMode: boolean = false;
  private buffer: string[] = [];

  setJsonMode(enabled: boolean): void {
    this.jsonMode = enabled;
  }

  setPrettyPrint(enabled: boolean): void {
    this.prettyPrint = enabled;
  }

  setQuietMode(enabled: boolean): void {
    this.quietMode = enabled;
  }

  isJsonMode(): boolean {
    return this.jsonMode;
  }

  isQuietMode(): boolean {
    return this.quietMode;
  }

  /**
   * Log a message (respects quiet mode and JSON mode)
   */
  log(message: string): void {
    if (this.quietMode) return;
    if (this.jsonMode) {
      this.buffer.push(message);
    } else {
      console.log(message);
    }
  }

  /**
   * Log an error (always shows)
   */
  error(message: string): void {
    if (this.jsonMode) {
      this.buffer.push(`ERROR: ${message}`);
    } else {
      console.error(message);
    }
  }

  /**
   * Log a warning
   */
  warn(message: string): void {
    if (this.quietMode) return;
    if (this.jsonMode) {
      this.buffer.push(`WARNING: ${message}`);
    } else {
      console.warn(message);
    }
  }

  /**
   * Output final result
   */
  output<T>(
    operation: string,
    data: T,
    success: boolean = true,
    options?: {
      durationMs?: number;
      error?: Error;
    }
  ): void {
    if (this.jsonMode) {
      const output = success
        ? createSuccessOutput(operation, data, {
            durationMs: options?.durationMs,
            warnings: this.buffer
              .filter((m) => m.startsWith('WARNING:'))
              .map((m) => m.replace('WARNING: ', '')),
            metadata: { logs: this.buffer },
          })
        : createErrorOutput(
            operation,
            options?.error || new Error('Unknown error'),
            {
              durationMs: options?.durationMs,
              warnings: this.buffer
                .filter((m) => m.startsWith('WARNING:'))
                .map((m) => m.replace('WARNING: ', '')),
              metadata: { logs: this.buffer },
            }
          );
      printJson(output, this.prettyPrint);
      this.buffer = [];
    }
  }

  /**
   * Clear buffer
   */
  clear(): void {
    this.buffer = [];
  }
}

export const outputManager = new OutputManager();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Wrap an async operation with JSON output handling
 */
export async function withJsonOutput<T>(
  operation: string,
  fn: () => Promise<T>,
  options?: { jsonMode?: boolean }
): Promise<T> {
  const startTime = Date.now();
  const wasJsonMode = outputManager.isJsonMode();

  if (options?.jsonMode !== undefined) {
    outputManager.setJsonMode(options.jsonMode);
  }

  try {
    const result = await fn();
    const durationMs = Date.now() - startTime;
    outputManager.output(operation, result, true, { durationMs });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    outputManager.output(operation, null, false, {
      durationMs,
      error: error as Error,
    });
    throw error;
  } finally {
    outputManager.setJsonMode(wasJsonMode);
  }
}
