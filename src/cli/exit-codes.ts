/**
 * Exit Codes for SunSetter AQM+
 *
 * Provides granular exit codes for different failure scenarios
 * to help CI/CD pipelines and automation tools identify specific issues.
 */

/**
 * Standard exit codes
 */
export const EXIT_CODES = {
  /** Successful execution */
  SUCCESS: 0,

  /** General error (unknown or uncategorized) */
  ERROR: 1,

  /** Configuration error (missing or invalid config) */
  CONFIG_ERROR: 2,

  /** Database connection error */
  CONNECTION_ERROR: 3,

  /** Migration execution error */
  MIGRATION_ERROR: 4,

  /** Validation error (preflight checks failed) */
  VALIDATION_ERROR: 5,

  /** Schema introspection error */
  SCHEMA_ERROR: 6,

  /** Code generation error */
  GENERATION_ERROR: 7,

  /** User cancelled operation */
  USER_CANCELLED: 8,

  /** Timeout error */
  TIMEOUT_ERROR: 9,

  /** Permission/authentication error */
  AUTH_ERROR: 10,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/**
 * Exit code descriptions for logging and error messages
 */
export const EXIT_CODE_DESCRIPTIONS: Record<ExitCode, string> = {
  [EXIT_CODES.SUCCESS]: 'Success',
  [EXIT_CODES.ERROR]: 'General error',
  [EXIT_CODES.CONFIG_ERROR]: 'Configuration error',
  [EXIT_CODES.CONNECTION_ERROR]: 'Database connection error',
  [EXIT_CODES.MIGRATION_ERROR]: 'Migration execution error',
  [EXIT_CODES.VALIDATION_ERROR]: 'Validation error',
  [EXIT_CODES.SCHEMA_ERROR]: 'Schema introspection error',
  [EXIT_CODES.GENERATION_ERROR]: 'Code generation error',
  [EXIT_CODES.USER_CANCELLED]: 'User cancelled',
  [EXIT_CODES.TIMEOUT_ERROR]: 'Timeout error',
  [EXIT_CODES.AUTH_ERROR]: 'Authentication/permission error',
};

/**
 * Helper function to exit with a specific code and optional message
 */
export function exitWithCode(
  code: ExitCode,
  message?: string,
  error?: Error
): never {
  if (message) {
    if (code === EXIT_CODES.SUCCESS) {
      console.log(message);
    } else {
      console.error(message);
    }
  }

  if (error && process.env.DEBUG) {
    console.error('Error details:', error);
  }

  process.exit(code);
}

/**
 * Helper to categorize errors and return appropriate exit code
 */
export function getExitCodeForError(error: Error): ExitCode {
  const errorMessage = error.message.toLowerCase();

  // Connection errors
  if (
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('connect')
  ) {
    return EXIT_CODES.CONNECTION_ERROR;
  }

  // Configuration errors
  if (
    errorMessage.includes('config') ||
    errorMessage.includes('missing') ||
    errorMessage.includes('required')
  ) {
    return EXIT_CODES.CONFIG_ERROR;
  }

  // Auth errors
  if (
    errorMessage.includes('auth') ||
    errorMessage.includes('permission') ||
    errorMessage.includes('denied') ||
    errorMessage.includes('forbidden')
  ) {
    return EXIT_CODES.AUTH_ERROR;
  }

  // Timeout errors
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return EXIT_CODES.TIMEOUT_ERROR;
  }

  // Validation errors
  if (errorMessage.includes('invalid') || errorMessage.includes('validation')) {
    return EXIT_CODES.VALIDATION_ERROR;
  }

  // Default to general error
  return EXIT_CODES.ERROR;
}
