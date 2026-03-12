/**
 * Migrate Command - Production-Quality CLI
 *
 * Main CLI command for PostgreSQL to Convex migration with:
 * - Enhanced help text with examples
 * - Rich progress visualization with colors
 * - Comprehensive validation messages
 * - Structured logging support
 * - Graceful shutdown handling
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  DatabaseType,
  createAdapter,
  parseConnectionString,
  type DatabaseConfig,
  type DatabaseAdapter,
} from '../../adapters/index.js';
import {
  SchemaIntrospector,
  type TableInfo,
} from '../../introspector/schema-introspector.js';
import { normalizeTableInfo } from '../../introspector/normalize-schema.js';
import {
  MigrationEngine,
  createMigrationEngine,
} from '../../migration/migration-engine.js';
import { ConvexFunctionGenerator } from '../../generator/convex/index.js';
import { runWizard, MigrationMode } from '../interactive/wizard.js';
import {
  ProgressReporter,
  ExtendedLogLevel,
  ProgressReporterConfig,
} from '../progress/reporter.js';
import {
  formatError,
  MigrationError,
  ConfigurationError,
  ERROR_CODES,
  createConnectionError,
} from '../errors/index.js';
import type { MigrationConfig, MigrationEvent } from '../../migration/types.js';
import { EXIT_CODES } from '../exit-codes.js';
import {
  suggestTableNames,
  formatSuggestionMessage,
} from '../../utils/fuzzy-match.js';
// 110% Enhancement imports
import { SlackNotifier } from '../../migration/notifications.js';
import { ReactHooksGenerator } from '../../generator/convex/react-hooks-generator.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Active migration engine reference for signal handling
 */
let activeEngine: MigrationEngine | null = null;
let activeReporter: ProgressReporter | null = null;
let isShuttingDown = false;
let shutdownTimeoutHandle: NodeJS.Timeout | null = null;

/** Graceful shutdown timeout in milliseconds (default: 30 seconds) */
const SHUTDOWN_TIMEOUT_MS = 30000;

/**
 * Enhancement options for 110% features
 */
interface EnhancementOptions {
  verify?: boolean;
  reactHooks?: boolean;
  hooksOutput?: string;
  slackWebhook?: string;
}

/**
 * Command line options with improved typing
 */
interface MigrateOptions {
  connection?: string;
  dbType?: string;
  convexUrl?: string;
  convexKey?: string;
  output?: string;
  mode?: string;
  tables?: string;
  exclude?: string;
  batchSize?: string;
  rateLimit?: string;
  maxRetries?: string;
  dryRun?: boolean;
  resume?: boolean;
  rollback?: boolean;
  rollbackTables?: string;
  parallel?: boolean;
  parallelTables?: string;
  yes?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  debug?: boolean;
  json?: boolean;
  logFile?: string;
  timestamps?: boolean;
  noColor?: boolean;
  // 110% Enhancement flags
  slackWebhook?: string;
  maskPii?: boolean;
  verify?: boolean;
  reactHooks?: boolean;
  hooksOutput?: string;
}

// ============================================================================
// Signal Handling
// ============================================================================

/**
 * Setup signal handlers for graceful shutdown
 */
function setupSignalHandlers(): void {
  const handleSignal = async (signal: string) => {
    if (isShuttingDown) {
      // Force exit on second signal
      activeReporter?.error(`Force exit requested. Exiting immediately.`);
      if (shutdownTimeoutHandle) {
        clearTimeout(shutdownTimeoutHandle);
      }
      process.exit(1);
    }

    isShuttingDown = true;
    console.log(); // New line after ^C
    activeReporter?.warn(`${signal} received. Gracefully shutting down...`);
    activeReporter?.log('Press Ctrl+C again to force exit');
    activeReporter?.log(`Shutdown timeout: ${SHUTDOWN_TIMEOUT_MS / 1000}s`);

    // Set up shutdown timeout - force exit if graceful shutdown takes too long
    shutdownTimeoutHandle = setTimeout(() => {
      activeReporter?.error(
        `Shutdown timeout exceeded (${SHUTDOWN_TIMEOUT_MS / 1000}s). Forcing exit...`
      );
      activeReporter?.close();
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    if (activeEngine) {
      try {
        // Abort ongoing operations and save state
        activeEngine.abort();
        activeReporter?.info('Migration paused. Saving state for resume...');

        // Wait for state to be saved with a reasonable timeout
        const saveStatePromise = activeEngine.close();
        await Promise.race([
          saveStatePromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('State save timeout')), 10000)
          ),
        ]).catch((error) => {
          activeReporter?.warn(
            `State save incomplete: ${(error as Error).message}`
          );
        });

        activeReporter?.info('Database connections closed.');
        activeReporter?.success('State saved. Use --resume to continue later.');
      } catch (error) {
        activeReporter?.error(
          `Error during shutdown: ${(error as Error).message}`
        );
      }
    }

    // Clear the timeout since we're exiting normally
    if (shutdownTimeoutHandle) {
      clearTimeout(shutdownTimeoutHandle);
      shutdownTimeoutHandle = null;
    }

    activeReporter?.close();
    process.exit(EXIT_CODES.USER_CANCELLED);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // Handle uncaught exceptions gracefully
  process.on('uncaughtException', (error) => {
    activeReporter?.error(`Uncaught exception: ${error.message}`);
    if (activeEngine) {
      activeEngine.abort();
    }
    activeReporter?.close();
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    activeReporter?.error(`Unhandled rejection: ${message}`);
    if (activeEngine) {
      activeEngine.abort();
    }
    activeReporter?.close();
    process.exit(1);
  });
}

/**
 * Register the active migration engine for signal handling
 */
function registerActiveEngine(
  engine: MigrationEngine,
  reporter: ProgressReporter
): void {
  activeEngine = engine;
  activeReporter = reporter;
}

/**
 * Unregister the active migration engine
 */
function unregisterActiveEngine(): void {
  activeEngine = null;
  activeReporter = null;
  isShuttingDown = false;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine log level from options
 */
function getLogLevel(options: MigrateOptions): ExtendedLogLevel {
  if (options.debug) return 'debug';
  if (options.verbose) return 'verbose';
  if (options.quiet) return 'quiet';
  return 'normal';
}

/**
 * Create reporter configuration from options
 */
function createReporterConfig(
  options: MigrateOptions
): Partial<ProgressReporterConfig> {
  return {
    logLevel: getLogLevel(options),
    json: options.json || false,
    logFile: options.logFile,
    showTimestamps: options.timestamps || false,
    colors: !options.noColor,
    interactive: process.stdout.isTTY && !options.json && !options.quiet,
  };
}

/**
 * Validate and parse numeric option
 */
function parseNumericOption(
  value: string | undefined,
  name: string,
  min: number,
  max: number,
  defaultValue: number,
  _reporter: ProgressReporter
): number {
  if (!value) return defaultValue;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new ConfigurationError(
      `Invalid ${name}: "${value}" is not a valid number`,
      ERROR_CODES.CONFIG_INVALID,
      { details: { option: name, value, expected: 'number' } }
    );
  }

  if (parsed < min || parsed > max) {
    throw new ConfigurationError(
      `Invalid ${name}: ${parsed} is out of range (${min}-${max})`,
      ERROR_CODES.CONFIG_INVALID,
      { details: { option: name, value: parsed, min, max } }
    );
  }

  return parsed;
}

/**
 * Get connection string from options or environment
 */
function getConnectionString(
  options: MigrateOptions,
  _reporter: ProgressReporter
): string {
  const connectionString =
    options.connection ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.PG_CONNECTION_STRING ||
    process.env.MYSQL_URL ||
    process.env.SQLITE_URL ||
    process.env.MSSQL_URL;

  if (!connectionString) {
    throw new ConfigurationError(
      'No database connection provided',
      ERROR_CODES.CONFIG_MISSING_REQUIRED,
      {
        details: {
          hint: 'Set DATABASE_URL environment variable or use --connection flag',
          envVars: [
            'DATABASE_URL',
            'POSTGRES_URL',
            'MYSQL_URL',
            'SQLITE_URL',
            'MSSQL_URL',
          ],
        },
      }
    );
  }

  return connectionString;
}

/**
 * Get database type from options or detect from connection string
 */
function getDatabaseType(
  options: MigrateOptions,
  connectionString: string,
  reporter: ProgressReporter
): DatabaseType {
  // Explicit --db-type flag takes precedence
  if (options.dbType) {
    const typeMap: Record<string, DatabaseType> = {
      postgresql: DatabaseType.POSTGRESQL,
      postgres: DatabaseType.POSTGRESQL,
      pg: DatabaseType.POSTGRESQL,
      mysql: DatabaseType.MYSQL,
      mariadb: DatabaseType.MYSQL,
      sqlite: DatabaseType.SQLITE,
      sqlite3: DatabaseType.SQLITE,
      mssql: DatabaseType.MSSQL,
      sqlserver: DatabaseType.MSSQL,
    };

    const dbType = typeMap[options.dbType.toLowerCase()];
    if (!dbType) {
      throw new ConfigurationError(
        `Invalid database type: "${options.dbType}"`,
        ERROR_CODES.CONFIG_INVALID,
        {
          details: {
            validTypes: Object.keys(typeMap),
            provided: options.dbType,
          },
        }
      );
    }
    return dbType;
  }

  // Try to detect from connection string protocol
  try {
    const config = parseConnectionString(connectionString);
    reporter.debug(`Detected database type: ${config.type}`);
    return config.type;
  } catch {
    // Default to PostgreSQL for backwards compatibility
    reporter.warn(
      'Could not detect database type from connection string. Defaulting to PostgreSQL.'
    );
    reporter.warn('Use --db-type to specify the database type explicitly.');
    return DatabaseType.POSTGRESQL;
  }
}

/**
 * Create a database adapter from options
 */
async function createDatabaseAdapterFromOptions(
  options: MigrateOptions,
  reporter: ProgressReporter
): Promise<DatabaseAdapter> {
  const connectionString = getConnectionString(options, reporter);
  const dbType = getDatabaseType(options, connectionString, reporter);

  reporter.debug(`Creating ${dbType} adapter`);

  let config: DatabaseConfig;

  try {
    // Try parsing as a connection string URL
    config = parseConnectionString(connectionString);
  } catch {
    // For non-URL connection strings, build config manually
    // This handles cases like "host:port/database" format
    config = {
      type: dbType,
      database: connectionString,
      // For SQLite, the connection string might be a file path
      filename: dbType === DatabaseType.SQLITE ? connectionString : undefined,
    };
  }

  // Ensure type matches what was detected/specified
  config.type = dbType;

  const adapter = createAdapter(config);
  await adapter.connect();

  return adapter;
}

/**
 * Build TableInfo array from adapter for multi-database support
 */
async function introspectWithAdapter(
  adapter: DatabaseAdapter,
  schemaName?: string
): Promise<TableInfo[]> {
  // Use the adapter's default schema if none specified
  const resolvedSchema = schemaName ?? adapter.getDefaultSchema();
  const schemas = await adapter.getSchemas();
  const targetSchema = schemas.includes(resolvedSchema)
    ? resolvedSchema
    : schemas[0] || adapter.getDefaultSchema();

  const tableNames = await adapter.getTables(targetSchema);
  const tables: TableInfo[] = [];

  for (const tableName of tableNames) {
    const columns = await adapter.getColumns(targetSchema, tableName);
    const primaryKeys = await adapter.getPrimaryKeys(targetSchema, tableName);
    const foreignKeys = await adapter.getForeignKeys(targetSchema, tableName);
    const indexes = await adapter.getIndexes(targetSchema, tableName);

    tables.push({
      tableName,
      schemaName: targetSchema,
      tableType: 'BASE TABLE',
      columns,
      primaryKeys,
      foreignKeys,
      indexes,
      checkConstraints: [],
      description: null,
      convexTableName: tableName,
    });
  }

  return tables.map(normalizeTableInfo);
}

// ============================================================================
// Command Creation
// ============================================================================

/**
 * Create the migrate command with enhanced help and options
 */
export function createMigrateCommand(): Command {
  const command = new Command('migrate')
    .description(
      `Migrate SQL database to Convex (PostgreSQL, MySQL, SQLite, SQL Server)

${chalk.bold('Examples:')}
  ${chalk.gray('# PostgreSQL migration')}
  $ convconv migrate --connection "postgresql://user:pass@localhost/db"

  ${chalk.gray('# MySQL migration')}
  $ convconv migrate --connection "mysql://user:pass@localhost/db"

  ${chalk.gray('# SQLite migration')}
  $ convconv migrate --connection "sqlite://./mydb.sqlite"

  ${chalk.gray('# SQL Server migration')}
  $ convconv migrate --connection "mssql://user:pass@localhost/db"

  ${chalk.gray('# Explicit database type')}
  $ convconv migrate -c "host:port/db" --db-type mysql

  ${chalk.gray('# Full migration with data transfer')}
  $ convconv migrate -m schema-and-data --convex-url https://your-app.convex.cloud

  ${chalk.gray('# Migrate specific tables only')}
  $ convconv migrate -t users,posts,comments

${chalk.bold('Environment Variables:')}
  DATABASE_URL       Database connection string
  CONVEX_URL         Convex deployment URL
  CONVEX_DEPLOY_KEY  Convex deploy key for data migration
`
    )
    .addHelpText(
      'after',
      `
${chalk.bold('Migration Modes:')}
  ${chalk.cyan('schema-only')}      Generate Convex schema and functions (default)
  ${chalk.cyan('schema-and-data')}  Generate schema and migrate all data
  ${chalk.cyan('data-only')}        Migrate data to existing Convex schema

${chalk.bold('Output Files:')}
  schema.ts          Convex table definitions and indexes
  <table>/queries.ts Query functions for each table
  <table>/mutations.ts Mutation functions for each table
  validators.ts      Reusable validator definitions
  types.ts           TypeScript type definitions

${chalk.bold('Rate Limiting:')}
  The tool automatically respects Convex rate limits using
  adaptive batching. If you hit rate limits, batch size will
  be automatically reduced and retried with exponential backoff.

${chalk.bold('Resumable Migration:')}
  If a migration is interrupted, use --resume to continue
  from the last checkpoint. State is saved in .migration/

${chalk.bold('Rollback:')}
  Use --rollback to undo a migration. The tool tracks all
  migrated documents and can delete them from Convex.
  Use --rollback-tables to rollback specific tables only.

${chalk.bold('Parallel Migration:')}
  Use --parallel to migrate independent tables concurrently.
  Tables are organized by dependency levels and migrated in
  parallel within each level. Use --parallel-tables to control
  concurrency (default: 4).
`
    )

    // Connection options
    .option(
      '-c, --connection <string>',
      'Database connection string (auto-detects type from protocol)',
      undefined
    )
    .option(
      '--db-type <type>',
      'Database type: postgresql, mysql, sqlite, mssql (auto-detected if not specified)',
      undefined
    )
    .option('--convex-url <string>', 'Convex deployment URL', undefined)
    .option(
      '--convex-key <string>',
      'Convex deploy key for data migration',
      undefined
    )

    // Output options
    .option(
      '-o, --output <dir>',
      'Output directory for generated files',
      './convex'
    )
    .option(
      '-m, --mode <mode>',
      'Migration mode: schema-only, schema-and-data, data-only',
      'schema-only'
    )

    // Table selection
    .option('-t, --tables <list>', 'Comma-separated list of tables to include')
    .option('-e, --exclude <list>', 'Comma-separated list of tables to exclude')

    // Performance tuning
    .option(
      '-b, --batch-size <number>',
      'Batch size for data migration (10-500)',
      '100'
    )
    .option(
      '-r, --rate-limit <number>',
      'Rate limit in requests per second (1-1000)',
      '100'
    )
    .option('--max-retries <number>', 'Maximum retries per batch (0-10)', '5')

    // Execution control
    .option('-n, --dry-run', 'Preview changes without writing files or data')
    .option('--resume', 'Resume a previously interrupted migration')
    .option('--rollback', 'Rollback a previously completed migration')
    .option(
      '--rollback-tables <list>',
      'Comma-separated list of tables to rollback (default: all)'
    )
    .option('--parallel', 'Enable parallel table migration')
    .option(
      '--parallel-tables <number>',
      'Maximum number of tables to migrate in parallel (1-8)',
      '4'
    )
    .option('-y, --yes', 'Skip confirmation prompts (use defaults)')

    // Logging options
    .option('-v, --verbose', 'Enable verbose output')
    .option('-q, --quiet', 'Minimal output (errors only)')
    .option('--debug', 'Enable debug output (very verbose)')
    .option('--json', 'Output logs as JSON (for CI/CD)')
    .option('--log-file <path>', 'Write logs to file')
    .option('--timestamps', 'Include timestamps in log output')
    .option('--no-color', 'Disable colored output')

    // 110% Enhancement options
    .option(
      '--slack-webhook <url>',
      'Slack webhook URL for migration notifications'
    )
    .option('--mask-pii', 'Enable PII data masking during migration')
    .option('--verify', 'Run post-migration verification')
    .option('--react-hooks', 'Generate React hooks for Convex functions')
    .option(
      '--hooks-output <dir>',
      'Output directory for React hooks',
      './src/hooks'
    )

    .action(runMigrateCommand);

  return command;
}

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Run the migrate command
 */
async function runMigrateCommand(options: MigrateOptions): Promise<void> {
  const reporter = new ProgressReporter(createReporterConfig(options));

  // Setup signal handlers for graceful shutdown
  setupSignalHandlers();

  try {
    // Show welcome banner
    reporter.printWelcome('PostgreSQL to Convex Migration', '1.6.0');

    // Check for rollback mode first
    if (options.rollback) {
      await runRollbackMode(options, reporter);
      return;
    }

    // Determine if interactive mode
    const isInteractive =
      !options.yes && !options.connection && process.stdin.isTTY;

    let config: Partial<MigrationConfig>;
    let mode: MigrationMode;
    let outputDir: string;

    // Enhancement flags (from CLI options directly)
    const verify = options.verify;
    const reactHooks = options.reactHooks;
    const hooksOutput = options.hooksOutput || './src/hooks';

    if (isInteractive) {
      // Run interactive wizard
      const result = await runInteractiveMode(options, reporter);
      if (!result) return;

      config = result.config;
      mode = result.mode;
      outputDir = result.outputDir;
    } else {
      // Parse command line options
      const result = parseCommandLineOptions(options, reporter);
      config = result.config;
      mode = result.mode;
      outputDir = result.outputDir;
    }

    // Add parallel and resume config
    if (options.parallel) {
      config.parallel = {
        enabled: true,
        maxParallelTables: parseNumericOption(
          options.parallelTables,
          'parallel-tables',
          1,
          8,
          4,
          reporter
        ),
      };
    }

    // Log configuration in debug mode
    reporter.debug('Migration configuration', {
      mode,
      outputDir,
      batchSize: config.batchSize,
      rateLimit: config.rateLimit,
      dryRun: config.dryRun,
      parallel: config.parallel,
      resume: config.resume,
    });

    // Execute migration based on mode
    reporter.section(`Starting ${mode} migration`);

    // Enhancement options bundle
    const enhancementOptions = {
      verify,
      reactHooks,
      hooksOutput,
      slackWebhook: options.slackWebhook,
    };

    switch (mode) {
      case 'schema-only':
        await runSchemaOnlyMigration(
          config,
          outputDir,
          reporter,
          enhancementOptions,
          options
        );
        break;

      case 'schema-and-data':
        await runFullMigration(config, outputDir, reporter, enhancementOptions);
        break;

      case 'data-only':
        await runDataOnlyMigration(config, reporter, enhancementOptions);
        break;
    }
  } catch (error: unknown) {
    if (error instanceof MigrationError) {
      console.error(
        formatError(error, {
          verbose: options.verbose || options.debug,
          colors: !options.noColor,
        })
      );
    } else {
      reporter.error('Unexpected error', error as Error);
    }
    const exitCode =
      error instanceof ConfigurationError
        ? EXIT_CODES.CONFIG_ERROR
        : error instanceof MigrationError
          ? EXIT_CODES.MIGRATION_ERROR
          : EXIT_CODES.ERROR;
    process.exit(exitCode);
  } finally {
    reporter.close();
  }
}

/**
 * Run interactive mode with wizard
 *
 * The wizard handles its own DB connection prompting, testing, and
 * schema introspection — so we do NOT call getConnectionString() here.
 * That helper throws when no connection is supplied, which is exactly
 * the case interactive mode is designed for.
 */
async function runInteractiveMode(
  _options: MigrateOptions,
  reporter: ProgressReporter
): Promise<{
  config: Partial<MigrationConfig>;
  mode: MigrationMode;
  outputDir: string;
} | null> {
  // The wizard prompts for connection, tests it, and introspects tables
  const wizardResult = await runWizard();

  if (!wizardResult.confirmed) {
    reporter.log('Migration cancelled.');
    return null;
  }

  return {
    config: {
      ...wizardResult.config,
      includeTables: wizardResult.selectedTables,
    },
    mode: wizardResult.mode,
    outputDir: wizardResult.outputDir,
  };
}

/**
 * Parse command line options into migration configuration
 */
function parseCommandLineOptions(
  options: MigrateOptions,
  reporter: ProgressReporter
): {
  config: Partial<MigrationConfig>;
  mode: MigrationMode;
  outputDir: string;
} {
  const connectionString = getConnectionString(options, reporter);

  // Validate and parse numeric options
  const batchSize = parseNumericOption(
    options.batchSize,
    'batch-size',
    10,
    500,
    100,
    reporter
  );
  const rateLimit = parseNumericOption(
    options.rateLimit,
    'rate-limit',
    1,
    1000,
    100,
    reporter
  );
  const maxRetries = parseNumericOption(
    options.maxRetries,
    'max-retries',
    0,
    10,
    5,
    reporter
  );

  // Validate mode
  const validModes = ['schema-only', 'schema-and-data', 'data-only'];
  if (options.mode && !validModes.includes(options.mode)) {
    throw new ConfigurationError(
      `Invalid migration mode: "${options.mode}"`,
      ERROR_CODES.CONFIG_INVALID,
      {
        details: {
          validModes,
          provided: options.mode,
        },
      }
    );
  }

  const mode = (options.mode as MigrationMode) || 'schema-only';
  const outputDir = options.output || './convex';

  // Parse table lists
  const includeTables = options.tables
    ? options.tables
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const excludeTables = options.exclude
    ? options.exclude
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const config: Partial<MigrationConfig> = {
    connectionString,
    convexUrl: options.convexUrl || process.env.CONVEX_URL,
    convexDeployKey: options.convexKey || process.env.CONVEX_DEPLOY_KEY,
    batchSize,
    rateLimit,
    maxRetries,
    dryRun: options.dryRun || false,
    resume: options.resume || false,
    includeTables,
    excludeTables,
    logLevel: getLogLevel(options) as 'quiet' | 'normal' | 'verbose',
  };

  // 110% Enhancement options
  if (options.slackWebhook) {
    config.slackNotifications = {
      webhookUrl: options.slackWebhook,
      notifyOnStart: true,
      notifyOnComplete: true,
      notifyOnFailure: true,
      notifyOnTableComplete: false, // Too noisy by default
    };
  }

  if (options.maskPii) {
    config.dataMasking = {
      enabled: true,
      tables: [], // Will auto-detect PII fields
    };
  }

  return { config, mode, outputDir };
}

// ============================================================================
// Migration Execution
// ============================================================================

/**
 * Run schema-only migration (generate code)
 */
async function runSchemaOnlyMigration(
  config: Partial<MigrationConfig>,
  outputDir: string,
  reporter: ProgressReporter,
  enhancementOptions: EnhancementOptions = {},
  options?: MigrateOptions
): Promise<void> {
  reporter.startSpinner('Connecting to database...');

  // Use multi-database adapter pattern
  const adapter = await createDatabaseAdapterFromOptions(
    options || { connection: config.connectionString },
    reporter
  );

  try {
    const isConnected = await adapter.testConnection();
    if (!isConnected) {
      throw new ConfigurationError('Failed to connect to database');
    }
    reporter.succeedSpinner('Connected to database');

    // Introspect schema using adapter
    reporter.startSpinner('Introspecting schema...');
    let tables = await introspectWithAdapter(adapter);

    // Apply filters with fuzzy matching for invalid table names
    if (config.includeTables && config.includeTables.length > 0) {
      const availableTableNames = tables.map((t) => t.tableName);
      const validTables: TableInfo[] = [];
      const invalidTables: string[] = [];

      for (const requestedTable of config.includeTables) {
        const found = tables.find((t) => t.tableName === requestedTable);
        if (found) {
          validTables.push(found);
        } else {
          invalidTables.push(requestedTable);
        }
      }

      // Show suggestions for invalid table names
      if (invalidTables.length > 0) {
        reporter.warn('Some requested tables were not found:');
        for (const invalidTable of invalidTables) {
          const result = suggestTableNames(
            invalidTable,
            availableTableNames,
            3
          );
          const message = formatSuggestionMessage(
            invalidTable,
            result.suggestions
          );
          reporter.warn(message);
        }
      }

      tables = validTables;
      reporter.debug(`Filtered to ${tables.length} tables (include list)`);
    }

    if (config.excludeTables && config.excludeTables.length > 0) {
      const excludeSet = new Set(config.excludeTables);
      tables = tables.filter((t: TableInfo) => !excludeSet.has(t.tableName));
      reporter.debug(`Filtered to ${tables.length} tables (exclude list)`);
    }

    reporter.succeedSpinner(`Introspected ${tables.length} tables`);

    // Show table list in verbose mode
    if (tables.length > 0) {
      reporter.verbose('Tables to process:');
      for (const table of tables) {
        reporter.verbose(
          `  - ${table.tableName} (${table.columns.length} columns)`
        );
      }
    }

    // Generate Convex code
    reporter.startSpinner('Generating Convex schema and functions...');

    const generator = new ConvexFunctionGenerator({ outputDir });
    const output = generator.generate(tables);

    if (!config.dryRun) {
      await generator.writeToFileSystem(output);
    }

    reporter.succeedSpinner('Code generation complete');

    // Print files generated
    if (!config.dryRun) {
      reporter.subsection('Files Generated:');
      reporter.fileGenerated(`${outputDir}/schema.ts`);
      for (const [tableName] of output.tables) {
        reporter.fileGenerated(`${outputDir}/${tableName}/queries.ts`);
        reporter.fileGenerated(`${outputDir}/${tableName}/mutations.ts`);
      }
      if (output.stats.totalValidators > 0) {
        reporter.fileGenerated(`${outputDir}/validators.ts`);
      }
      if (output.stats.totalTypes > 0) {
        reporter.fileGenerated(`${outputDir}/types.ts`);
      }
    }

    // Print summary
    const summaryData: Record<string, string | number> = {
      'Tables processed': tables.length,
      'Queries generated': output.stats.totalQueries,
      'Mutations generated': output.stats.totalMutations,
      'Validators generated': output.stats.totalValidators,
      'Types generated': output.stats.totalTypes,
      'Output directory': outputDir,
    };

    // Generate React hooks if requested
    if (enhancementOptions.reactHooks && !config.dryRun) {
      reporter.startSpinner('Generating React hooks...');
      try {
        const hooksOutputDir = enhancementOptions.hooksOutput || './src/hooks';
        const hooksGenerator = new ReactHooksGenerator({
          outputDir: hooksOutputDir,
          separateFiles: true,
          includeComments: true,
          useReactQuery: false,
          generateOptimisticUpdates: true,
          convexFunctionsPath: outputDir,
        });

        // Convert output tables to definitions for hooks generator
        const tableDefinitions = Array.from(output.tables.entries()).map(
          ([tableName]) => ({
            tableName,
            fields: [],
            indexes: [],
            relationships: [],
            originalTableName: tableName,
            schemaName: adapter.getDefaultSchema(),
          })
        );

        const hooksResult = hooksGenerator.generate(tableDefinitions);

        // Write hooks files
        const fs = await import('fs/promises');
        const path = await import('path');
        await fs.mkdir(hooksOutputDir, { recursive: true });

        for (const [filename, content] of hooksResult.files) {
          const filePath = path.join(hooksOutputDir, filename);
          await fs.writeFile(filePath, content, 'utf-8');
        }

        reporter.succeedSpinner(
          `Generated ${hooksResult.hookCount} React hooks`
        );
        summaryData['React hooks generated'] = hooksResult.hookCount;
        reporter.fileGenerated(`${hooksOutputDir}/index.ts`);
      } catch (error) {
        reporter.warnSpinner(
          `React hooks generation skipped: ${(error as Error).message}`
        );
      }
    }

    reporter.printSummary(summaryData);

    if (config.dryRun) {
      reporter.box('Dry Run - No files were written', 'warning');
    } else {
      reporter.box(
        `Generated Convex code in ${outputDir}/\n\nNext steps:\n  1. Review the generated schema.ts\n  2. Run \`npx convex dev\` to deploy\n  3. Update your app to use the new Convex functions`,
        'success'
      );
    }
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Run full migration (schema + data)
 */
async function runFullMigration(
  config: Partial<MigrationConfig>,
  outputDir: string,
  reporter: ProgressReporter,
  enhancementOptions: EnhancementOptions = {}
): Promise<void> {
  // Validate Convex credentials
  if (!config.convexUrl) {
    throw new ConfigurationError(
      'Convex URL is required for data migration',
      ERROR_CODES.CONFIG_MISSING_REQUIRED,
      {
        details: {
          hint: 'Set CONVEX_URL environment variable or use --convex-url flag',
        },
      }
    );
  }

  if (!config.convexDeployKey) {
    throw new ConfigurationError(
      'Convex deploy key is required for data migration',
      ERROR_CODES.CONFIG_MISSING_REQUIRED,
      {
        details: {
          hint: 'Set CONVEX_DEPLOY_KEY environment variable or use --convex-key flag',
        },
      }
    );
  }

  // Initialize Slack notifier if webhook provided
  let slackNotifier: SlackNotifier | null = null;
  if (
    enhancementOptions.slackWebhook ||
    config.slackNotifications?.webhookUrl
  ) {
    const webhookUrl =
      enhancementOptions.slackWebhook || config.slackNotifications?.webhookUrl;
    if (webhookUrl) {
      slackNotifier = new SlackNotifier({
        webhookUrl,
        notifyOnStart: true,
        notifyOnComplete: true,
        notifyOnFailure: true,
        notifyOnTableComplete: false,
      });
      reporter.debug('Slack notifications enabled');
    }
  }

  reporter.startSpinner('Initializing migration engine...');

  const engine = await createMigrationEngine({
    ...config,
    stateDir: './.migration',
  });

  // Register engine for signal handling
  registerActiveEngine(engine, reporter);

  // Send start notification
  if (slackNotifier) {
    await slackNotifier.notifyMigrationStart({
      migrationId: 'migration',
      totalTables: 0, // Will be updated after introspection
      totalRows: 0,
    });
  }

  // Set up event handlers for progress
  engine.onEvent((event: MigrationEvent) => {
    handleMigrationEvent(event, reporter);
  });

  try {
    reporter.succeedSpinner('Migration engine initialized');

    // Introspect
    reporter.startSpinner('Introspecting database...');
    const tables = await engine.introspect();
    reporter.succeedSpinner(`Found ${tables.length} tables`);

    // Validate
    reporter.startSpinner('Validating schema...');
    const validation = await engine.validate();

    if (!validation.valid) {
      reporter.failSpinner('Validation failed');
      reporter.subsection('Validation Errors:');
      for (const error of validation.errors) {
        reporter.error(`${error.table}: ${error.message}`);
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    if (validation.warnings.length > 0) {
      reporter.warnSpinner(
        `Validated with ${validation.warnings.length} warnings`
      );
      reporter.subsection('Warnings:');
      for (const warning of validation.warnings) {
        reporter.warn(`${warning.table}: ${warning.message}`);
      }
    } else {
      reporter.succeedSpinner('Schema validated');
    }

    // Generate schema first
    reporter.startSpinner('Generating Convex code...');
    const schemaResult = await engine.generateSchema(outputDir);
    reporter.succeedSpinner(
      `Generated ${schemaResult.functionsGenerated} functions`
    );

    // Run data migration
    reporter.section('Data Migration');
    reporter.log('');

    const report = await engine.migrate();

    // Print detailed report
    reporter.subsection('Table Results:');
    for (const tableReport of report.tables) {
      const status =
        tableReport.status === 'completed'
          ? chalk.green('DONE')
          : tableReport.status === 'failed'
            ? chalk.red('FAIL')
            : chalk.yellow(tableReport.status.toUpperCase());

      const rowInfo = `${tableReport.migratedRows}/${tableReport.totalRows} rows`;
      reporter.log(`  ${status} ${tableReport.tableName}: ${rowInfo}`);

      if (tableReport.status === 'failed' && tableReport.errors.length > 0) {
        for (const error of tableReport.errors.slice(0, 3)) {
          reporter.error(`       ${error.message}`);
        }
        if (tableReport.errors.length > 3) {
          reporter.log(
            `       ... and ${tableReport.errors.length - 3} more errors`
          );
        }
      }
    }

    // Print summary
    reporter.printSummary({
      Status: report.status,
      Duration: `${Math.round(report.duration / 1000)}s`,
      'Tables migrated': report.tables.filter((t) => t.status === 'completed')
        .length,
      'Total rows': report.totalRows,
      'Migrated rows': report.migratedRows,
      'Failed rows': report.failedRows,
    });

    // Send Slack completion notification
    if (slackNotifier) {
      if (report.status === 'completed' || report.status === 'partial') {
        await slackNotifier.notifyMigrationComplete({
          migrationId: 'migration',
          duration: report.duration,
          tablesCompleted: report.tables.filter((t) => t.status === 'completed')
            .length,
          migratedRows: report.migratedRows,
          failedRows: report.failedRows,
        });
      } else {
        await slackNotifier.notifyMigrationFailure({
          migrationId: 'migration',
          error: 'Migration failed',
          tablesCompleted: report.tables.filter((t) => t.status === 'completed')
            .length,
          tablesFailed: report.tables.filter((t) => t.status === 'failed')
            .length,
        });
      }
    }

    // Run post-migration verification if requested
    if (enhancementOptions.verify && report.status === 'completed') {
      reporter.section('Post-Migration Verification');
      reporter.startSpinner('Running verification checks...');

      try {
        // Basic verification: compare migrated counts
        const verificationResults: Array<{
          table: string;
          expected: number;
          actual: number;
          match: boolean;
        }> = [];

        for (const tableReport of report.tables) {
          verificationResults.push({
            table: tableReport.tableName,
            expected: tableReport.totalRows,
            actual: tableReport.migratedRows,
            match: tableReport.migratedRows === tableReport.totalRows,
          });
        }

        reporter.succeedSpinner('Verification complete');

        // Print verification results
        reporter.subsection('Verification Results:');
        let allPassed = true;

        for (const result of verificationResults) {
          const status = result.match ? chalk.green('PASS') : chalk.red('FAIL');
          reporter.log(
            `  ${status} ${result.table}: ${result.actual}/${result.expected} rows`
          );
          if (!result.match) allPassed = false;
        }

        reporter.log('');
        if (allPassed) {
          reporter.success(
            'All tables verified: row counts match expected values'
          );
        } else {
          reporter.warn(
            'Some tables have mismatched row counts. Review results above.'
          );
        }
      } catch (error) {
        reporter.warnSpinner(
          `Verification skipped: ${(error as Error).message}`
        );
      }
    }

    if (report.status === 'completed') {
      reporter.box('Migration completed successfully!', 'success');
    } else if (report.status === 'partial') {
      reporter.box(
        'Migration completed with some failures.\nUse --resume to retry failed tables.',
        'warning'
      );
    } else {
      reporter.box('Migration failed. Check errors above.', 'error');
      // Send error notification before exiting
      if (slackNotifier) {
        await slackNotifier.notifyMigrationFailure({
          migrationId: 'migration',
          error: 'Migration failed',
          tablesCompleted: report.tables.filter((t) => t.status === 'completed')
            .length,
          tablesFailed: report.tables.filter((t) => t.status === 'failed')
            .length,
        });
      }
      process.exit(EXIT_CODES.MIGRATION_ERROR);
    }
  } finally {
    unregisterActiveEngine();
    await engine.close();
  }
}

/**
 * Run data-only migration (skip code generation, migrate data to existing Convex schema)
 */
async function runDataOnlyMigration(
  config: Partial<MigrationConfig>,
  reporter: ProgressReporter,
  enhancementOptions: EnhancementOptions
): Promise<void> {
  reporter.startSpinner('Initializing migration engine...');

  const engine = await createMigrationEngine({
    ...config,
    stateDir: './.migration',
  });

  registerActiveEngine(engine, reporter);

  engine.onEvent((event: MigrationEvent) => {
    handleMigrationEvent(event, reporter);
  });

  try {
    reporter.succeedSpinner('Migration engine initialized');

    // Introspect
    reporter.startSpinner('Introspecting database...');
    const tables = await engine.introspect();
    reporter.succeedSpinner(`Found ${tables.length} tables`);

    // Validate
    reporter.startSpinner('Validating schema...');
    const validation = await engine.validate();

    if (!validation.valid) {
      reporter.failSpinner('Validation failed');
      reporter.subsection('Validation Errors:');
      for (const error of validation.errors) {
        reporter.error(`${error.table}: ${error.message}`);
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    if (validation.warnings.length > 0) {
      reporter.warnSpinner(
        `Validated with ${validation.warnings.length} warnings`
      );
    } else {
      reporter.succeedSpinner('Schema validated');
    }

    // Skip code generation — data-only mode assumes Convex schema already deployed
    reporter.info('Skipping code generation (data-only mode)');

    // Run data migration
    reporter.section('Data Migration');
    reporter.log('');

    const report = await engine.migrate();

    // Print results
    reporter.subsection('Table Results:');
    for (const tableReport of report.tables) {
      const status =
        tableReport.status === 'completed'
          ? chalk.green('DONE')
          : tableReport.status === 'failed'
            ? chalk.red('FAIL')
            : chalk.yellow(tableReport.status.toUpperCase());

      reporter.log(
        `  ${status} ${tableReport.tableName}: ${tableReport.migratedRows}/${tableReport.totalRows} rows`
      );
    }

    reporter.printSummary({
      Status: report.status,
      Duration: `${Math.round(report.duration / 1000)}s`,
      'Tables migrated': report.tables.filter((t) => t.status === 'completed')
        .length,
      'Total rows': report.totalRows,
    });

    if (report.status === 'completed') {
      reporter.box('Data migration completed successfully!', 'success');
    } else if (report.status === 'partial') {
      reporter.box(
        'Data migration completed with some failures.\nUse --resume to retry failed tables.',
        'warning'
      );
    } else {
      reporter.box('Data migration failed. Check errors above.', 'error');
      process.exit(EXIT_CODES.MIGRATION_ERROR);
    }
  } finally {
    unregisterActiveEngine();
    await engine.close();
  }
}

// ============================================================================
// Event Handling
// ============================================================================

/**
 * Handle migration events for progress display
 */
function handleMigrationEvent(
  event: MigrationEvent,
  reporter: ProgressReporter
): void {
  const data = (event.data as Record<string, unknown>) || {};

  switch (event.type) {
    case 'migration:start':
      reporter.log('Starting migration...');
      break;

    case 'table:start':
      reporter.log(`Migrating ${event.table}...`);
      if (typeof data.totalRows === 'number' && data.totalRows > 0) {
        reporter.startProgressBar(data.totalRows, 'rows');
      }
      break;

    case 'batch:start':
      reporter.debug(
        `${event.table} batch ${event.batch}: ${data.rowCount} rows`
      );
      break;

    case 'batch:complete':
      if (typeof data.migrated === 'number') {
        reporter.updateProgressBar(data.migrated as number);
      }
      reporter.debug(`${event.table} batch ${event.batch} complete`, {
        migrated: data.migrated,
        failed: data.failed,
      });
      break;

    case 'table:complete':
      reporter.stopProgressBar();
      reporter.success(`${event.table}: ${data.migrated || 0} rows migrated`);
      break;

    case 'table:error':
      reporter.stopProgressBar();
      reporter.error(
        `${event.table}: ${event.error?.message || 'Unknown error'}`
      );
      break;

    case 'row:success':
      reporter.debug(
        `${event.table} row ${event.row}: inserted as ${data.convexId}`
      );
      break;

    case 'row:error':
      reporter.debug(
        `${event.table} row ${event.row}: ${event.error?.message}`
      );
      break;

    case 'migration:complete':
      reporter.log('Migration complete.');
      break;

    case 'migration:error':
      reporter.error(`Migration failed: ${event.error?.message}`);
      break;
  }
}

// ============================================================================
// Rollback Mode
// ============================================================================

/**
 * Run rollback mode to undo a previous migration
 */
async function runRollbackMode(
  options: MigrateOptions,
  reporter: ProgressReporter
): Promise<void> {
  reporter.section('Migration Rollback');

  // Validate Convex credentials
  const convexUrl = options.convexUrl || process.env.CONVEX_URL;
  const convexKey = options.convexKey || process.env.CONVEX_DEPLOY_KEY;

  if (!convexUrl) {
    throw new ConfigurationError(
      'Convex URL is required for rollback',
      ERROR_CODES.CONFIG_MISSING_REQUIRED,
      {
        details: {
          hint: 'Set CONVEX_URL environment variable or use --convex-url flag',
        },
      }
    );
  }

  if (!convexKey) {
    throw new ConfigurationError(
      'Convex deploy key is required for rollback',
      ERROR_CODES.CONFIG_MISSING_REQUIRED,
      {
        details: {
          hint: 'Set CONVEX_DEPLOY_KEY environment variable or use --convex-key flag',
        },
      }
    );
  }

  reporter.startSpinner('Initializing migration engine for rollback...');

  const connectionString = getConnectionString(options, reporter);
  const engine = await createMigrationEngine({
    connectionString,
    convexUrl,
    convexDeployKey: convexKey,
    stateDir: './.migration',
  });

  // Register engine for signal handling
  registerActiveEngine(engine, reporter);

  try {
    reporter.succeedSpinner('Migration engine initialized');

    // Get rollback summary first
    reporter.startSpinner('Loading rollback state...');
    const summary = await engine.getRollbackSummary();

    const tableNames = Object.keys(summary.byTable);
    if (!summary || tableNames.length === 0) {
      reporter.failSpinner('No rollback state found');
      reporter.box(
        'No rollback state available.\nRollback is only possible for migrations that completed with rollback tracking enabled.',
        'warning'
      );
      return;
    }

    reporter.succeedSpinner(
      `Found rollback state with ${tableNames.length} tables`
    );

    // Show what will be rolled back
    reporter.subsection('Tables to rollback:');
    let totalDocs = 0;
    for (const tableName of tableNames) {
      const docCount = summary.byTable[tableName];
      reporter.log(`  ${tableName}: ${docCount} documents`);
      totalDocs += docCount;
    }
    reporter.log(`  Total: ${totalDocs} documents`);

    // Parse rollback tables option
    const rollbackTables = options.rollbackTables
      ? options.rollbackTables
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;

    if (rollbackTables && rollbackTables.length > 0) {
      reporter.log('');
      reporter.log(`Rolling back only: ${rollbackTables.join(', ')}`);
    }

    // Confirm if not using --yes
    if (!options.yes && process.stdin.isTTY) {
      reporter.log('');
      reporter.warn('This will DELETE all migrated documents from Convex!');
      reporter.log('Press Ctrl+C to cancel or wait 5 seconds to continue...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Perform rollback
    reporter.section('Rolling Back');
    reporter.startSpinner('Deleting migrated documents...');

    const result = await engine.rollback({
      tables: rollbackTables,
      dryRun: options.dryRun,
    });

    reporter.succeedSpinner('Rollback complete');

    // Print results
    reporter.subsection('Rollback Results:');
    for (const tableResult of result.tablesRolledBack) {
      const status = tableResult.success
        ? chalk.green('OK')
        : chalk.red('FAIL');
      reporter.log(
        `  ${status} ${tableResult.tableName}: ${tableResult.deletedCount} deleted`
      );
      if (!tableResult.success && tableResult.errors.length > 0) {
        reporter.error(`       ${tableResult.errors[0].message}`);
      }
    }

    // Print summary
    reporter.printSummary({
      Status: result.success ? 'Completed' : 'Partial',
      Duration: `${Math.round(result.duration / 1000)}s`,
      'Tables rolled back': result.tablesRolledBack.filter((t) => t.success)
        .length,
      'Documents deleted': result.tablesRolledBack.reduce(
        (sum, t) => sum + t.deletedCount,
        0
      ),
      Errors: result.errors.length,
    });

    if (result.success) {
      reporter.box('Rollback completed successfully!', 'success');
    } else {
      reporter.box('Rollback completed with some errors.', 'warning');
    }
  } finally {
    unregisterActiveEngine();
    await engine.close();
  }
}
