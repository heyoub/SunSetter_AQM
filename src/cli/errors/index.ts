/**
 * Custom Error Classes for Convex Migration Tool
 *
 * Production-quality error handling with:
 * - Structured error codes (ERR-XXX format)
 * - Actionable error messages with cause and fix suggestions
 * - Documentation links for common errors
 * - Rich formatting for console output
 */

import chalk from 'chalk';

// ============================================================================
// Error Code System
// ============================================================================

/**
 * Error code categories with numeric identifiers
 */
export const ERROR_CODES = {
  // Connection errors (ERR-001 to ERR-099)
  CONNECTION_FAILED: 'ERR-001',
  CONNECTION_TIMEOUT: 'ERR-002',
  CONNECTION_REFUSED: 'ERR-003',
  AUTHENTICATION_FAILED: 'ERR-004',
  SSL_ERROR: 'ERR-005',
  CONNECTION_POOL_EXHAUSTED: 'ERR-006',

  // Schema introspection errors (ERR-100 to ERR-199)
  INTROSPECTION_FAILED: 'ERR-100',
  SCHEMA_NOT_FOUND: 'ERR-101',
  TABLE_NOT_FOUND: 'ERR-102',
  PERMISSION_DENIED: 'ERR-103',
  UNSUPPORTED_TYPE: 'ERR-104',
  COMPOSITE_TYPE_ERROR: 'ERR-105',

  // Type mapping errors (ERR-200 to ERR-299)
  TYPE_MAPPING_FAILED: 'ERR-200',
  UNKNOWN_POSTGRES_TYPE: 'ERR-201',
  ARRAY_TYPE_ERROR: 'ERR-202',
  ENUM_TYPE_ERROR: 'ERR-203',
  JSON_PARSE_ERROR: 'ERR-204',
  BINARY_DATA_ERROR: 'ERR-205',

  // Migration errors (ERR-300 to ERR-399)
  MIGRATION_FAILED: 'ERR-300',
  BATCH_INSERT_FAILED: 'ERR-301',
  ROW_TRANSFORM_FAILED: 'ERR-302',
  FK_RESOLUTION_FAILED: 'ERR-303',
  PRIMARY_KEY_MISSING: 'ERR-304',
  CIRCULAR_DEPENDENCY: 'ERR-305',
  STATE_SAVE_FAILED: 'ERR-306',
  STATE_LOAD_FAILED: 'ERR-307',
  MIGRATION_ABORTED: 'ERR-308',
  RESUME_FAILED: 'ERR-309',

  // Convex API errors (ERR-400 to ERR-499)
  CONVEX_API_ERROR: 'ERR-400',
  CONVEX_AUTH_FAILED: 'ERR-401',
  CONVEX_RATE_LIMITED: 'ERR-402',
  CONVEX_DEPLOYMENT_NOT_FOUND: 'ERR-403',
  CONVEX_FUNCTION_ERROR: 'ERR-404',
  CONVEX_SCHEMA_MISMATCH: 'ERR-405',
  CONVEX_DOCUMENT_TOO_LARGE: 'ERR-406',

  // Configuration errors (ERR-500 to ERR-599)
  CONFIG_INVALID: 'ERR-500',
  CONFIG_MISSING_REQUIRED: 'ERR-501',
  CONFIG_FILE_NOT_FOUND: 'ERR-502',
  CONFIG_PARSE_ERROR: 'ERR-503',
  OUTPUT_DIR_ERROR: 'ERR-504',

  // File system errors (ERR-600 to ERR-699)
  FS_READ_ERROR: 'ERR-600',
  FS_WRITE_ERROR: 'ERR-601',
  FS_PERMISSION_DENIED: 'ERR-602',
  FS_PATH_NOT_FOUND: 'ERR-603',
  FS_DISK_FULL: 'ERR-604',

  // Validation errors (ERR-700 to ERR-799)
  VALIDATION_FAILED: 'ERR-700',
  INVALID_INPUT: 'ERR-701',
  CONSTRAINT_VIOLATION: 'ERR-702',
  DATA_INTEGRITY_ERROR: 'ERR-703',

  // Unknown/catch-all
  UNKNOWN_ERROR: 'ERR-999',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ============================================================================
// Error Metadata
// ============================================================================

interface ErrorMetadata {
  title: string;
  description: string;
  cause?: string;
  fix?: string;
  docsUrl?: string;
  retryable: boolean;
  category:
    | 'connection'
    | 'introspection'
    | 'type'
    | 'migration'
    | 'convex'
    | 'config'
    | 'filesystem'
    | 'validation'
    | 'unknown';
}

const ERROR_METADATA: Record<ErrorCode, ErrorMetadata> = {
  // Connection errors
  [ERROR_CODES.CONNECTION_FAILED]: {
    title: 'Connection Failed',
    description: 'Unable to establish connection to PostgreSQL database',
    cause:
      'The database server may be unreachable or the connection string is invalid',
    fix: 'Verify the connection string format and ensure the database server is running',
    docsUrl: 'https://docs.example.com/errors/ERR-001',
    retryable: true,
    category: 'connection',
  },
  [ERROR_CODES.CONNECTION_TIMEOUT]: {
    title: 'Connection Timeout',
    description: 'Connection to database timed out',
    cause: 'Network latency or firewall blocking the connection',
    fix: 'Check network connectivity and firewall rules. Try increasing the timeout value',
    docsUrl: 'https://docs.example.com/errors/ERR-002',
    retryable: true,
    category: 'connection',
  },
  [ERROR_CODES.CONNECTION_REFUSED]: {
    title: 'Connection Refused',
    description: 'Database server actively refused the connection',
    cause:
      'PostgreSQL is not running or not accepting connections on the specified port',
    fix: 'Ensure PostgreSQL service is running and listening on the correct port',
    docsUrl: 'https://docs.example.com/errors/ERR-003',
    retryable: true,
    category: 'connection',
  },
  [ERROR_CODES.AUTHENTICATION_FAILED]: {
    title: 'Authentication Failed',
    description: 'Invalid database credentials',
    cause:
      'Username or password is incorrect, or user lacks connection privileges',
    fix: 'Verify username and password. Check pg_hba.conf for authentication settings',
    docsUrl: 'https://docs.example.com/errors/ERR-004',
    retryable: false,
    category: 'connection',
  },
  [ERROR_CODES.SSL_ERROR]: {
    title: 'SSL Connection Error',
    description: 'Failed to establish secure SSL/TLS connection',
    cause: 'SSL certificate issues or SSL mode mismatch',
    fix: 'Check SSL configuration. Try adding ?sslmode=require or ?sslmode=disable to connection string',
    docsUrl: 'https://docs.example.com/errors/ERR-005',
    retryable: false,
    category: 'connection',
  },
  [ERROR_CODES.CONNECTION_POOL_EXHAUSTED]: {
    title: 'Connection Pool Exhausted',
    description: 'All database connections in the pool are in use',
    cause: 'Too many concurrent operations or connection leak',
    fix: 'Reduce concurrency or increase pool size. Check for unclosed connections',
    docsUrl: 'https://docs.example.com/errors/ERR-006',
    retryable: true,
    category: 'connection',
  },

  // Introspection errors
  [ERROR_CODES.INTROSPECTION_FAILED]: {
    title: 'Schema Introspection Failed',
    description: 'Unable to read database schema information',
    cause: 'Insufficient permissions or invalid schema',
    fix: 'Ensure the database user has SELECT permissions on information_schema and pg_catalog',
    docsUrl: 'https://docs.example.com/errors/ERR-100',
    retryable: false,
    category: 'introspection',
  },
  [ERROR_CODES.SCHEMA_NOT_FOUND]: {
    title: 'Schema Not Found',
    description: 'The specified database schema does not exist',
    cause: 'Schema name is misspelled or does not exist in the database',
    fix: 'Verify the schema name. Use \\dn in psql to list available schemas',
    docsUrl: 'https://docs.example.com/errors/ERR-101',
    retryable: false,
    category: 'introspection',
  },
  [ERROR_CODES.TABLE_NOT_FOUND]: {
    title: 'Table Not Found',
    description: 'The specified table does not exist',
    cause: 'Table name is misspelled or does not exist in the schema',
    fix: 'Verify the table name. Use \\dt in psql to list available tables',
    docsUrl: 'https://docs.example.com/errors/ERR-102',
    retryable: false,
    category: 'introspection',
  },
  [ERROR_CODES.PERMISSION_DENIED]: {
    title: 'Permission Denied',
    description: 'Insufficient permissions to access database objects',
    cause: 'Database user lacks required SELECT or USAGE privileges',
    fix: 'Grant necessary permissions: GRANT SELECT ON ALL TABLES IN SCHEMA public TO user',
    docsUrl: 'https://docs.example.com/errors/ERR-103',
    retryable: false,
    category: 'introspection',
  },
  [ERROR_CODES.UNSUPPORTED_TYPE]: {
    title: 'Unsupported Data Type',
    description:
      'A column uses a PostgreSQL type that cannot be mapped to Convex',
    cause: 'The data type is not supported by the migration tool',
    fix: 'Use a custom type mapping or transform the data before migration',
    docsUrl: 'https://docs.example.com/errors/ERR-104',
    retryable: false,
    category: 'introspection',
  },
  [ERROR_CODES.COMPOSITE_TYPE_ERROR]: {
    title: 'Composite Type Error',
    description: 'Error processing PostgreSQL composite or custom type',
    cause: 'Complex or nested composite types are not fully supported',
    fix: 'Consider flattening composite types or using JSON columns',
    docsUrl: 'https://docs.example.com/errors/ERR-105',
    retryable: false,
    category: 'introspection',
  },

  // Type mapping errors
  [ERROR_CODES.TYPE_MAPPING_FAILED]: {
    title: 'Type Mapping Failed',
    description: 'Unable to map PostgreSQL type to Convex validator',
    cause: 'The type mapping logic encountered an unexpected type',
    fix: 'Add a custom type mapping in configuration',
    docsUrl: 'https://docs.example.com/errors/ERR-200',
    retryable: false,
    category: 'type',
  },
  [ERROR_CODES.UNKNOWN_POSTGRES_TYPE]: {
    title: 'Unknown PostgreSQL Type',
    description: 'Encountered an unrecognized PostgreSQL data type',
    cause: 'The type may be a custom extension type or new PostgreSQL type',
    fix: 'Add the type to customTypeMappings in configuration',
    docsUrl: 'https://docs.example.com/errors/ERR-201',
    retryable: false,
    category: 'type',
  },
  [ERROR_CODES.ARRAY_TYPE_ERROR]: {
    title: 'Array Type Error',
    description: 'Error processing PostgreSQL array type',
    cause: 'Nested arrays or unsupported array element types',
    fix: 'Consider using JSON type for complex arrays',
    docsUrl: 'https://docs.example.com/errors/ERR-202',
    retryable: false,
    category: 'type',
  },
  [ERROR_CODES.ENUM_TYPE_ERROR]: {
    title: 'Enum Type Error',
    description: 'Error processing PostgreSQL enum type',
    cause: 'Enum type definition could not be retrieved',
    fix: 'Ensure the enum type exists and is accessible',
    docsUrl: 'https://docs.example.com/errors/ERR-203',
    retryable: false,
    category: 'type',
  },
  [ERROR_CODES.JSON_PARSE_ERROR]: {
    title: 'JSON Parse Error',
    description: 'Failed to parse JSON/JSONB column data',
    cause: 'Invalid JSON data in the source column',
    fix: 'Validate JSON data integrity before migration',
    docsUrl: 'https://docs.example.com/errors/ERR-204',
    retryable: false,
    category: 'type',
  },
  [ERROR_CODES.BINARY_DATA_ERROR]: {
    title: 'Binary Data Error',
    description: 'Error processing binary (bytea) data',
    cause: 'Binary data encoding or size issues',
    fix: 'Ensure binary data is properly encoded and within size limits',
    docsUrl: 'https://docs.example.com/errors/ERR-205',
    retryable: false,
    category: 'type',
  },

  // Migration errors
  [ERROR_CODES.MIGRATION_FAILED]: {
    title: 'Migration Failed',
    description: 'The data migration process encountered a fatal error',
    cause: 'An unrecoverable error occurred during migration',
    fix: 'Check the error details and logs. Use --resume to continue from checkpoint',
    docsUrl: 'https://docs.example.com/errors/ERR-300',
    retryable: false,
    category: 'migration',
  },
  [ERROR_CODES.BATCH_INSERT_FAILED]: {
    title: 'Batch Insert Failed',
    description: 'Failed to insert a batch of documents to Convex',
    cause: 'Network issue, rate limiting, or data validation error',
    fix: 'The migration will retry automatically. Consider reducing batch size',
    docsUrl: 'https://docs.example.com/errors/ERR-301',
    retryable: true,
    category: 'migration',
  },
  [ERROR_CODES.ROW_TRANSFORM_FAILED]: {
    title: 'Row Transform Failed',
    description: 'Failed to transform a PostgreSQL row to Convex document',
    cause: 'Data format issue or custom transform function error',
    fix: 'Check the row data and transform function. The row will be skipped',
    docsUrl: 'https://docs.example.com/errors/ERR-302',
    retryable: false,
    category: 'migration',
  },
  [ERROR_CODES.FK_RESOLUTION_FAILED]: {
    title: 'Foreign Key Resolution Failed',
    description: 'Could not resolve foreign key reference to Convex ID',
    cause: 'Referenced row was not migrated or ID mapping not found',
    fix: 'Ensure tables are migrated in dependency order. Check for orphan FK values',
    docsUrl: 'https://docs.example.com/errors/ERR-303',
    retryable: false,
    category: 'migration',
  },
  [ERROR_CODES.PRIMARY_KEY_MISSING]: {
    title: 'Primary Key Missing',
    description: 'Table does not have a primary key or unique identifier',
    cause: 'The table lacks a primary key constraint',
    fix: 'Specify --primary-key option or add a primary key to the table',
    docsUrl: 'https://docs.example.com/errors/ERR-304',
    retryable: false,
    category: 'migration',
  },
  [ERROR_CODES.CIRCULAR_DEPENDENCY]: {
    title: 'Circular Dependency',
    description: 'Tables have circular foreign key dependencies',
    cause: 'Table A references B which references A (directly or indirectly)',
    fix: 'Use --exclude to break the cycle, or migrate in multiple passes',
    docsUrl: 'https://docs.example.com/errors/ERR-305',
    retryable: false,
    category: 'migration',
  },
  [ERROR_CODES.STATE_SAVE_FAILED]: {
    title: 'State Save Failed',
    description: 'Could not save migration checkpoint state',
    cause: 'File system error or permissions issue',
    fix: 'Check write permissions on the state directory',
    docsUrl: 'https://docs.example.com/errors/ERR-306',
    retryable: true,
    category: 'migration',
  },
  [ERROR_CODES.STATE_LOAD_FAILED]: {
    title: 'State Load Failed',
    description: 'Could not load migration checkpoint state',
    cause: 'State file is corrupted or missing',
    fix: 'Start a fresh migration without --resume flag',
    docsUrl: 'https://docs.example.com/errors/ERR-307',
    retryable: false,
    category: 'migration',
  },
  [ERROR_CODES.MIGRATION_ABORTED]: {
    title: 'Migration Aborted',
    description: 'Migration was cancelled by user or signal',
    cause: 'User pressed Ctrl+C or sent termination signal',
    fix: 'Use --resume to continue the migration from last checkpoint',
    docsUrl: 'https://docs.example.com/errors/ERR-308',
    retryable: false,
    category: 'migration',
  },
  [ERROR_CODES.RESUME_FAILED]: {
    title: 'Resume Failed',
    description: 'Could not resume migration from checkpoint',
    cause: 'Checkpoint data is incompatible or corrupted',
    fix: 'Start a fresh migration without --resume flag',
    docsUrl: 'https://docs.example.com/errors/ERR-309',
    retryable: false,
    category: 'migration',
  },

  // Convex API errors
  [ERROR_CODES.CONVEX_API_ERROR]: {
    title: 'Convex API Error',
    description: 'Convex API returned an error response',
    cause: 'API request was rejected by Convex',
    fix: 'Check the error message and Convex documentation',
    docsUrl: 'https://docs.example.com/errors/ERR-400',
    retryable: false,
    category: 'convex',
  },
  [ERROR_CODES.CONVEX_AUTH_FAILED]: {
    title: 'Convex Authentication Failed',
    description: 'Invalid or expired Convex deploy key',
    cause: 'The CONVEX_DEPLOY_KEY is invalid, expired, or missing',
    fix: 'Generate a new deploy key from the Convex dashboard',
    docsUrl: 'https://docs.example.com/errors/ERR-401',
    retryable: false,
    category: 'convex',
  },
  [ERROR_CODES.CONVEX_RATE_LIMITED]: {
    title: 'Convex Rate Limited',
    description: 'Too many requests to Convex API',
    cause: 'Exceeded Convex API rate limits',
    fix: 'Reduce --rate-limit or --batch-size. The tool will retry automatically',
    docsUrl: 'https://docs.example.com/errors/ERR-402',
    retryable: true,
    category: 'convex',
  },
  [ERROR_CODES.CONVEX_DEPLOYMENT_NOT_FOUND]: {
    title: 'Convex Deployment Not Found',
    description: 'The specified Convex deployment does not exist',
    cause: 'CONVEX_URL is incorrect or deployment was deleted',
    fix: 'Verify the deployment URL from Convex dashboard',
    docsUrl: 'https://docs.example.com/errors/ERR-403',
    retryable: false,
    category: 'convex',
  },
  [ERROR_CODES.CONVEX_FUNCTION_ERROR]: {
    title: 'Convex Function Error',
    description: 'Error executing Convex mutation or query',
    cause: 'The Convex function threw an error',
    fix: 'Check Convex function logs in the dashboard',
    docsUrl: 'https://docs.example.com/errors/ERR-404',
    retryable: false,
    category: 'convex',
  },
  [ERROR_CODES.CONVEX_SCHEMA_MISMATCH]: {
    title: 'Convex Schema Mismatch',
    description: 'Document does not match Convex schema definition',
    cause: 'The generated schema and data structure do not align',
    fix: 'Regenerate schema or update the existing Convex schema',
    docsUrl: 'https://docs.example.com/errors/ERR-405',
    retryable: false,
    category: 'convex',
  },
  [ERROR_CODES.CONVEX_DOCUMENT_TOO_LARGE]: {
    title: 'Document Too Large',
    description: 'Document exceeds Convex size limit (1MB)',
    cause: 'Large text, binary, or JSON data in the row',
    fix: 'Split large data into separate documents or use file storage',
    docsUrl: 'https://docs.example.com/errors/ERR-406',
    retryable: false,
    category: 'convex',
  },

  // Configuration errors
  [ERROR_CODES.CONFIG_INVALID]: {
    title: 'Invalid Configuration',
    description: 'Configuration values are invalid or inconsistent',
    cause: 'One or more configuration options have invalid values',
    fix: 'Review configuration file or command-line options',
    docsUrl: 'https://docs.example.com/errors/ERR-500',
    retryable: false,
    category: 'config',
  },
  [ERROR_CODES.CONFIG_MISSING_REQUIRED]: {
    title: 'Missing Required Configuration',
    description: 'A required configuration value is missing',
    cause: 'Required environment variable or option not provided',
    fix: 'Set the required environment variable or command-line option',
    docsUrl: 'https://docs.example.com/errors/ERR-501',
    retryable: false,
    category: 'config',
  },
  [ERROR_CODES.CONFIG_FILE_NOT_FOUND]: {
    title: 'Configuration File Not Found',
    description: 'The specified configuration file does not exist',
    cause: 'File path is incorrect or file was deleted',
    fix: 'Verify the configuration file path',
    docsUrl: 'https://docs.example.com/errors/ERR-502',
    retryable: false,
    category: 'config',
  },
  [ERROR_CODES.CONFIG_PARSE_ERROR]: {
    title: 'Configuration Parse Error',
    description: 'Could not parse configuration file',
    cause: 'Invalid JSON or YAML syntax in configuration file',
    fix: 'Validate the configuration file syntax',
    docsUrl: 'https://docs.example.com/errors/ERR-503',
    retryable: false,
    category: 'config',
  },
  [ERROR_CODES.OUTPUT_DIR_ERROR]: {
    title: 'Output Directory Error',
    description: 'Cannot use the specified output directory',
    cause: 'Directory does not exist or is not writable',
    fix: 'Create the directory or check permissions',
    docsUrl: 'https://docs.example.com/errors/ERR-504',
    retryable: false,
    category: 'config',
  },

  // File system errors
  [ERROR_CODES.FS_READ_ERROR]: {
    title: 'File Read Error',
    description: 'Could not read from file',
    cause: 'File does not exist or is not readable',
    fix: 'Check file path and permissions',
    docsUrl: 'https://docs.example.com/errors/ERR-600',
    retryable: false,
    category: 'filesystem',
  },
  [ERROR_CODES.FS_WRITE_ERROR]: {
    title: 'File Write Error',
    description: 'Could not write to file',
    cause: 'Insufficient permissions or disk full',
    fix: 'Check write permissions and available disk space',
    docsUrl: 'https://docs.example.com/errors/ERR-601',
    retryable: false,
    category: 'filesystem',
  },
  [ERROR_CODES.FS_PERMISSION_DENIED]: {
    title: 'Permission Denied',
    description: 'Insufficient file system permissions',
    cause: 'User does not have required access rights',
    fix: 'Run with appropriate permissions or change file ownership',
    docsUrl: 'https://docs.example.com/errors/ERR-602',
    retryable: false,
    category: 'filesystem',
  },
  [ERROR_CODES.FS_PATH_NOT_FOUND]: {
    title: 'Path Not Found',
    description: 'The specified file or directory path does not exist',
    cause: 'Path is misspelled or parent directory does not exist',
    fix: 'Verify the path and create parent directories if needed',
    docsUrl: 'https://docs.example.com/errors/ERR-603',
    retryable: false,
    category: 'filesystem',
  },
  [ERROR_CODES.FS_DISK_FULL]: {
    title: 'Disk Full',
    description: 'No space left on device',
    cause: 'The file system is full',
    fix: 'Free up disk space or use a different output directory',
    docsUrl: 'https://docs.example.com/errors/ERR-604',
    retryable: false,
    category: 'filesystem',
  },

  // Validation errors
  [ERROR_CODES.VALIDATION_FAILED]: {
    title: 'Validation Failed',
    description: 'Data or schema validation failed',
    cause: 'Input data does not meet validation requirements',
    fix: 'Review validation errors and correct the data',
    docsUrl: 'https://docs.example.com/errors/ERR-700',
    retryable: false,
    category: 'validation',
  },
  [ERROR_CODES.INVALID_INPUT]: {
    title: 'Invalid Input',
    description: 'The provided input is invalid',
    cause: 'Input format or value is not acceptable',
    fix: 'Check the expected input format in documentation',
    docsUrl: 'https://docs.example.com/errors/ERR-701',
    retryable: false,
    category: 'validation',
  },
  [ERROR_CODES.CONSTRAINT_VIOLATION]: {
    title: 'Constraint Violation',
    description: 'Data violates a database constraint',
    cause: 'Unique, check, or foreign key constraint violation',
    fix: 'Review and fix the data that violates constraints',
    docsUrl: 'https://docs.example.com/errors/ERR-702',
    retryable: false,
    category: 'validation',
  },
  [ERROR_CODES.DATA_INTEGRITY_ERROR]: {
    title: 'Data Integrity Error',
    description: 'Data integrity check failed',
    cause: 'Inconsistent or corrupted data detected',
    fix: 'Verify data integrity and repair if necessary',
    docsUrl: 'https://docs.example.com/errors/ERR-703',
    retryable: false,
    category: 'validation',
  },

  // Unknown
  [ERROR_CODES.UNKNOWN_ERROR]: {
    title: 'Unknown Error',
    description: 'An unexpected error occurred',
    cause: 'The error type was not recognized',
    fix: 'Check the error details and stack trace for more information',
    docsUrl: 'https://docs.example.com/errors/ERR-999',
    retryable: false,
    category: 'unknown',
  },
};

// ============================================================================
// Base Error Class
// ============================================================================

/**
 * Base error class for all migration errors
 * Provides structured error information with codes, causes, and fixes
 */
export class MigrationError extends Error {
  public readonly code: ErrorCode;
  public readonly details: Record<string, unknown>;
  public readonly cause?: Error;
  public readonly timestamp: Date;
  public readonly retryable: boolean;

  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.UNKNOWN_ERROR,
    options: {
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.details = options.details || {};
    this.cause = options.cause;
    this.timestamp = new Date();
    this.retryable = ERROR_METADATA[code]?.retryable ?? false;

    // Maintain proper stack trace
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Get error metadata
   */
  getMetadata(): ErrorMetadata {
    return (
      ERROR_METADATA[this.code] || ERROR_METADATA[ERROR_CODES.UNKNOWN_ERROR]
    );
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
      retryable: this.retryable,
      cause: this.cause?.message,
      stack: this.stack,
    };
  }
}

// ============================================================================
// Specialized Error Classes
// ============================================================================

/**
 * Database connection errors
 */
export class ConnectionError extends MigrationError {
  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.CONNECTION_FAILED,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, code, options);
    this.name = 'ConnectionError';
  }
}

/**
 * Schema introspection errors
 */
export class IntrospectionError extends MigrationError {
  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.INTROSPECTION_FAILED,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, code, options);
    this.name = 'IntrospectionError';
  }
}

/**
 * Type mapping errors
 */
export class TypeMappingError extends MigrationError {
  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.TYPE_MAPPING_FAILED,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, code, options);
    this.name = 'TypeMappingError';
  }
}

/**
 * Data migration errors
 */
export class DataMigrationError extends MigrationError {
  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.MIGRATION_FAILED,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, code, options);
    this.name = 'DataMigrationError';
  }
}

/**
 * Convex API errors
 */
export class ConvexError extends MigrationError {
  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.CONVEX_API_ERROR,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, code, options);
    this.name = 'ConvexError';
  }
}

/**
 * Rate limit errors
 */
export class RateLimitError extends MigrationError {
  public readonly retryAfterMs?: number;

  constructor(
    message: string = 'Convex rate limit exceeded',
    options: { retryAfterMs?: number; details?: Record<string, unknown> } = {}
  ) {
    super(message, ERROR_CODES.CONVEX_RATE_LIMITED, {
      details: { ...options.details, retryAfterMs: options.retryAfterMs },
    });
    this.name = 'RateLimitError';
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends MigrationError {
  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.CONFIG_INVALID,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, code, options);
    this.name = 'ConfigurationError';
  }
}

/**
 * File system errors
 */
export class FileSystemError extends MigrationError {
  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.FS_WRITE_ERROR,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, code, options);
    this.name = 'FileSystemError';
  }
}

/**
 * Validation errors
 */
export class ValidationError extends MigrationError {
  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.VALIDATION_FAILED,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, code, options);
    this.name = 'ValidationError';
  }
}

/**
 * Dependency resolution errors (circular dependencies, etc.)
 */
export class DependencyError extends MigrationError {
  constructor(
    message: string,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, ERROR_CODES.CIRCULAR_DEPENDENCY, options);
    this.name = 'DependencyError';
  }
}

/**
 * Code generation errors
 */
export class GenerationError extends MigrationError {
  constructor(
    message: string,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, ERROR_CODES.FS_WRITE_ERROR, options);
    this.name = 'GenerationError';
  }
}

/**
 * Data transformation errors
 */
export class TransformError extends MigrationError {
  constructor(
    message: string,
    options: { details?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super(message, ERROR_CODES.ROW_TRANSFORM_FAILED, options);
    this.name = 'TransformError';
  }
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format options for error output
 */
export interface FormatErrorOptions {
  /** Show verbose output including stack trace */
  verbose?: boolean;
  /** Use colors in output */
  colors?: boolean;
  /** Include documentation links */
  includeDocs?: boolean;
  /** Include timestamp */
  includeTimestamp?: boolean;
}

/**
 * Format an error for console output with rich formatting
 */
export function formatError(
  error: Error,
  options: FormatErrorOptions = {}
): string {
  const {
    verbose = false,
    colors = true,
    includeDocs = true,
    includeTimestamp = false,
  } = options;

  const lines: string[] = [];
  const c = colors
    ? chalk
    : {
        red: (s: string) => s,
        yellow: (s: string) => s,
        cyan: (s: string) => s,
        gray: (s: string) => s,
        white: (s: string) => s,
        bold: { red: (s: string) => s, white: (s: string) => s },
        dim: (s: string) => s,
      };

  lines.push('');

  if (error instanceof MigrationError) {
    const metadata = error.getMetadata();

    // Error header with code
    lines.push(c.bold.red(`  [${error.code}] ${metadata.title}`));
    lines.push(c.gray('  ' + '\u2500'.repeat(50)));
    lines.push('');

    // Timestamp if requested
    if (includeTimestamp) {
      lines.push(c.gray(`  Time:  ${error.timestamp.toISOString()}`));
    }

    // Main message
    lines.push(c.white(`  Error: ${error.message}`));

    // Cause
    if (metadata.cause) {
      lines.push('');
      lines.push(c.yellow(`  Cause: ${metadata.cause}`));
    }

    // Details
    if (Object.keys(error.details).length > 0) {
      lines.push('');
      lines.push(c.gray('  Details:'));
      for (const [key, value] of Object.entries(error.details)) {
        const valueStr =
          typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value);
        if (valueStr.includes('\n')) {
          lines.push(c.gray(`    ${key}:`));
          for (const line of valueStr.split('\n')) {
            lines.push(c.gray(`      ${line}`));
          }
        } else {
          lines.push(c.gray(`    ${key}: ${valueStr}`));
        }
      }
    }

    // Fix suggestion
    if (metadata.fix) {
      lines.push('');
      lines.push(c.cyan(`  Fix:   ${metadata.fix}`));
    }

    // Documentation link
    if (includeDocs && metadata.docsUrl) {
      lines.push('');
      lines.push(c.dim(`  Docs:  ${metadata.docsUrl}`));
    }

    // Retryable indicator
    if (error.retryable) {
      lines.push('');
      lines.push(
        c.yellow('  This error is retryable and may resolve on retry.')
      );
    }

    // Original cause if present
    if (error.cause) {
      lines.push('');
      lines.push(c.gray(`  Original error: ${error.cause.message}`));
    }
  } else {
    // Generic error formatting
    lines.push(c.bold.red(`  Error: ${error.message}`));
  }

  // Stack trace for verbose mode
  if (verbose && error.stack) {
    lines.push('');
    lines.push(c.gray('  Stack trace:'));
    const stackLines = error.stack.split('\n').slice(1);
    for (const line of stackLines.slice(0, 10)) {
      lines.push(c.dim(`  ${line}`));
    }
    if (stackLines.length > 10) {
      lines.push(c.dim(`    ... ${stackLines.length - 10} more lines`));
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format error for JSON output (structured logging)
 */
export function formatErrorJson(error: Error): Record<string, unknown> {
  if (error instanceof MigrationError) {
    return error.toJSON();
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Error Helpers
// ============================================================================

/**
 * Creates an error from an unknown caught value
 */
export function toError(caught: unknown): Error {
  if (caught instanceof Error) {
    return caught;
  }
  if (typeof caught === 'string') {
    return new Error(caught);
  }
  if (typeof caught === 'object' && caught !== null) {
    return new Error(JSON.stringify(caught));
  }
  return new Error(String(caught));
}

/**
 * Wrap an unknown error with a specific error code
 */
export function wrapError(
  caught: unknown,
  code: ErrorCode,
  message?: string
): MigrationError {
  const originalError = toError(caught);
  return new MigrationError(message || originalError.message, code, {
    cause: originalError,
  });
}

/**
 * Checks if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  if (error instanceof MigrationError) {
    return error.retryable;
  }

  // Check for common retryable error patterns
  const message = error.message.toLowerCase();
  return (
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('503') ||
    message.includes('service unavailable') ||
    message.includes('network')
  );
}

/**
 * Get error code from an error (extracts from MigrationError or infers from message)
 */
export function getErrorCode(error: Error): ErrorCode {
  if (error instanceof MigrationError) {
    return error.code;
  }

  const message = error.message.toLowerCase();

  // Connection errors
  if (message.includes('econnrefused')) return ERROR_CODES.CONNECTION_REFUSED;
  if (message.includes('etimedout')) return ERROR_CODES.CONNECTION_TIMEOUT;
  if (message.includes('authentication') || message.includes('password')) {
    return ERROR_CODES.AUTHENTICATION_FAILED;
  }
  if (message.includes('ssl') || message.includes('tls'))
    return ERROR_CODES.SSL_ERROR;

  // Rate limit
  if (message.includes('rate limit') || message.includes('429')) {
    return ERROR_CODES.CONVEX_RATE_LIMITED;
  }

  // File system
  if (message.includes('enoent')) return ERROR_CODES.FS_PATH_NOT_FOUND;
  if (message.includes('eacces') || message.includes('permission denied')) {
    return ERROR_CODES.FS_PERMISSION_DENIED;
  }
  if (message.includes('enospc')) return ERROR_CODES.FS_DISK_FULL;

  return ERROR_CODES.UNKNOWN_ERROR;
}

/**
 * Create a connection error from a pg error
 */
export function createConnectionError(pgError: Error): ConnectionError {
  const message = pgError.message.toLowerCase();

  if (message.includes('econnrefused')) {
    return new ConnectionError(
      'Connection refused by PostgreSQL server',
      ERROR_CODES.CONNECTION_REFUSED,
      { cause: pgError, details: { originalMessage: pgError.message } }
    );
  }

  if (message.includes('etimedout')) {
    return new ConnectionError(
      'Connection to PostgreSQL timed out',
      ERROR_CODES.CONNECTION_TIMEOUT,
      { cause: pgError, details: { originalMessage: pgError.message } }
    );
  }

  if (message.includes('authentication') || message.includes('password')) {
    return new ConnectionError(
      'PostgreSQL authentication failed',
      ERROR_CODES.AUTHENTICATION_FAILED,
      { cause: pgError, details: { originalMessage: pgError.message } }
    );
  }

  if (message.includes('ssl')) {
    return new ConnectionError('SSL connection error', ERROR_CODES.SSL_ERROR, {
      cause: pgError,
      details: { originalMessage: pgError.message },
    });
  }

  return new ConnectionError(pgError.message, ERROR_CODES.CONNECTION_FAILED, {
    cause: pgError,
  });
}

/**
 * Create a Convex error from an API response
 */
export function createConvexError(
  apiError: Error,
  statusCode?: number
): ConvexError {
  if (statusCode === 401 || statusCode === 403) {
    return new ConvexError(
      'Convex authentication failed',
      ERROR_CODES.CONVEX_AUTH_FAILED,
      { cause: apiError, details: { statusCode } }
    );
  }

  if (statusCode === 429) {
    return new RateLimitError('Convex rate limit exceeded', {
      details: { originalMessage: apiError.message },
    });
  }

  if (statusCode === 404) {
    return new ConvexError(
      'Convex deployment not found',
      ERROR_CODES.CONVEX_DEPLOYMENT_NOT_FOUND,
      { cause: apiError, details: { statusCode } }
    );
  }

  return new ConvexError(apiError.message, ERROR_CODES.CONVEX_API_ERROR, {
    cause: apiError,
    details: { statusCode },
  });
}

// ============================================================================
// Error Aggregation
// ============================================================================

/**
 * Aggregate multiple errors into a summary
 */
export interface ErrorSummary {
  total: number;
  byCode: Map<ErrorCode, number>;
  byCategory: Map<string, number>;
  retryable: number;
  samples: MigrationError[];
}

/**
 * Create an error summary from a list of errors
 */
export function summarizeErrors(
  errors: Error[],
  maxSamples: number = 5
): ErrorSummary {
  const summary: ErrorSummary = {
    total: errors.length,
    byCode: new Map(),
    byCategory: new Map(),
    retryable: 0,
    samples: [],
  };

  for (const error of errors) {
    if (error instanceof MigrationError) {
      // Count by code
      const codeCount = summary.byCode.get(error.code) || 0;
      summary.byCode.set(error.code, codeCount + 1);

      // Count by category
      const metadata = error.getMetadata();
      const categoryCount = summary.byCategory.get(metadata.category) || 0;
      summary.byCategory.set(metadata.category, categoryCount + 1);

      // Count retryable
      if (error.retryable) {
        summary.retryable++;
      }

      // Collect samples
      if (summary.samples.length < maxSamples) {
        summary.samples.push(error);
      }
    }
  }

  return summary;
}

/**
 * Format error summary for display
 */
export function formatErrorSummary(
  summary: ErrorSummary,
  colors: boolean = true
): string {
  const c = colors
    ? chalk
    : {
        red: (s: string) => s,
        yellow: (s: string) => s,
        cyan: (s: string) => s,
        gray: (s: string) => s,
        white: (s: string) => s,
        bold: { red: (s: string) => s, white: (s: string) => s },
      };

  const lines: string[] = [];

  lines.push('');
  lines.push(c.bold.red(`  Error Summary: ${summary.total} errors`));
  lines.push(c.gray('  ' + '\u2500'.repeat(40)));
  lines.push('');

  // By category
  lines.push(c.white('  By Category:'));
  for (const [category, count] of summary.byCategory) {
    lines.push(c.gray(`    ${category}: ${count}`));
  }
  lines.push('');

  // By code (top 5)
  lines.push(c.white('  Top Error Codes:'));
  const sortedCodes = [...summary.byCode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [code, count] of sortedCodes) {
    const metadata = ERROR_METADATA[code];
    lines.push(
      c.gray(`    ${code} (${metadata?.title || 'Unknown'}): ${count}`)
    );
  }
  lines.push('');

  // Retryable
  if (summary.retryable > 0) {
    lines.push(c.yellow(`  Retryable errors: ${summary.retryable}`));
  }

  // Sample errors
  if (summary.samples.length > 0) {
    lines.push('');
    lines.push(c.white('  Sample Errors:'));
    for (const error of summary.samples) {
      lines.push(
        c.gray(`    [${error.code}] ${error.message.slice(0, 60)}...`)
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}
