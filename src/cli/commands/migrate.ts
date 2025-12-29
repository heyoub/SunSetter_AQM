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
import { Pool } from 'pg';
import chalk from 'chalk';
import {
  SchemaIntrospector,
  TableInfo,
} from '../../introspector/schema-introspector.js';
import { DatabaseConnection } from '../../config/database.js';
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

// ============================================================================
// Types
// ============================================================================

/**
 * Active migration engine reference for signal handling
 */
let activeEngine: MigrationEngine | null = null;
let activeReporter: ProgressReporter | null = null;
let isShuttingDown = false;

/**
 * Command line options with improved typing
 */
interface MigrateOptions {
  connection?: string;
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
  yes?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  debug?: boolean;
  json?: boolean;
  logFile?: string;
  timestamps?: boolean;
  noColor?: boolean;
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
      process.exit(1);
    }

    isShuttingDown = true;
    console.log(); // New line after ^C
    activeReporter?.warn(`${signal} received. Gracefully shutting down...`);
    activeReporter?.log('Press Ctrl+C again to force exit');

    if (activeEngine) {
      try {
        activeEngine.abort();
        activeReporter?.info('Migration paused. State saved for resume.');

        await activeEngine.close();
        activeReporter?.info('Database connections closed.');
      } catch (error) {
        activeReporter?.error(
          `Error during shutdown: ${(error as Error).message}`
        );
      }
    }

    activeReporter?.close();
    process.exit(0);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
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
 * Create a DatabaseConnection wrapper for a Pool
 */
function createDbConnectionWrapper(pool: Pool): DatabaseConnection {
  return {
    pool,
    config: {} as any,
    async testConnection(): Promise<boolean> {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
    getConfig() {
      return {} as any;
    },
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
  } as unknown as DatabaseConnection;
}

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
    process.env.PG_CONNECTION_STRING;

  if (!connectionString) {
    throw new ConfigurationError(
      'No database connection provided',
      ERROR_CODES.CONFIG_MISSING_REQUIRED,
      {
        details: {
          hint: 'Set DATABASE_URL environment variable or use --connection flag',
          envVars: ['DATABASE_URL', 'POSTGRES_URL', 'PG_CONNECTION_STRING'],
        },
      }
    );
  }

  return connectionString;
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
      `Migrate PostgreSQL database to Convex

${chalk.bold('Examples:')}
  ${chalk.gray('# Generate Convex schema from PostgreSQL')}
  $ convconv migrate --connection "postgresql://user:pass@localhost/db"

  ${chalk.gray('# Full migration with data transfer')}
  $ convconv migrate -m schema-and-data --convex-url https://your-app.convex.cloud

  ${chalk.gray('# Migrate specific tables only')}
  $ convconv migrate -t users,posts,comments

  ${chalk.gray('# Resume interrupted migration')}
  $ convconv migrate --resume

  ${chalk.gray('# Dry run to preview changes')}
  $ convconv migrate --dry-run -v

${chalk.bold('Environment Variables:')}
  DATABASE_URL       PostgreSQL connection string
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
`
    )

    // Connection options
    .option(
      '-c, --connection <string>',
      'PostgreSQL connection string',
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
    .option('-y, --yes', 'Skip confirmation prompts (use defaults)')

    // Logging options
    .option('-v, --verbose', 'Enable verbose output')
    .option('-q, --quiet', 'Minimal output (errors only)')
    .option('--debug', 'Enable debug output (very verbose)')
    .option('--json', 'Output logs as JSON (for CI/CD)')
    .option('--log-file <path>', 'Write logs to file')
    .option('--timestamps', 'Include timestamps in log output')
    .option('--no-color', 'Disable colored output')

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
    reporter.printWelcome('PostgreSQL to Convex Migration', '1.0.0');

    // Determine if interactive mode
    const isInteractive =
      !options.yes && !options.connection && process.stdin.isTTY;

    let config: Partial<MigrationConfig>;
    let mode: MigrationMode;
    let outputDir: string;

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

    // Log configuration in debug mode
    reporter.debug('Migration configuration', {
      mode,
      outputDir,
      batchSize: config.batchSize,
      rateLimit: config.rateLimit,
      dryRun: config.dryRun,
    });

    // Execute migration based on mode
    reporter.section(`Starting ${mode} migration`);

    switch (mode) {
      case 'schema-only':
        await runSchemaOnlyMigration(config, outputDir, reporter);
        break;

      case 'schema-and-data':
        await runFullMigration(config, outputDir, reporter);
        break;

      case 'data-only':
        await runDataOnlyMigration(config, reporter);
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
    process.exit(1);
  } finally {
    reporter.close();
  }
}

/**
 * Run interactive mode with wizard
 */
async function runInteractiveMode(
  options: MigrateOptions,
  reporter: ProgressReporter
): Promise<{
  config: Partial<MigrationConfig>;
  mode: MigrationMode;
  outputDir: string;
} | null> {
  const connectionString = getConnectionString(options, reporter);

  // Connect and introspect
  reporter.startSpinner('Connecting to database...');
  const pool = new Pool({ connectionString });

  try {
    await pool.query('SELECT 1');
    reporter.succeedSpinner('Connected to database');
  } catch (error) {
    reporter.failSpinner('Failed to connect to database');
    throw createConnectionError(error as Error);
  }

  reporter.startSpinner('Introspecting schema...');
  const dbConnection = createDbConnectionWrapper(pool);
  const introspector = new SchemaIntrospector(dbConnection);
  const schema = await introspector.introspectSchema('public');
  const tables = schema.tables;
  reporter.succeedSpinner(`Found ${tables.length} tables`);

  await pool.end();

  // Run wizard
  const wizardResult = await runWizard(tables);

  if (!wizardResult.confirmed) {
    reporter.log('Migration cancelled.');
    return null;
  }

  return {
    config: {
      connectionString,
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
  reporter: ProgressReporter
): Promise<void> {
  reporter.startSpinner('Connecting to database...');

  const pool = new Pool({ connectionString: config.connectionString });

  try {
    await pool.query('SELECT 1');
    reporter.succeedSpinner('Connected to database');

    // Introspect schema
    reporter.startSpinner('Introspecting schema...');
    const dbConnection = createDbConnectionWrapper(pool);
    const introspector = new SchemaIntrospector(dbConnection);
    const schema = await introspector.introspectSchema('public');
    let tables = schema.tables;

    // Apply filters
    if (config.includeTables && config.includeTables.length > 0) {
      const includeSet = new Set(config.includeTables);
      tables = tables.filter((t: TableInfo) => includeSet.has(t.tableName));
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
    reporter.printSummary({
      'Tables processed': tables.length,
      'Queries generated': output.stats.totalQueries,
      'Mutations generated': output.stats.totalMutations,
      'Validators generated': output.stats.totalValidators,
      'Types generated': output.stats.totalTypes,
      'Output directory': outputDir,
    });

    if (config.dryRun) {
      reporter.box('Dry Run - No files were written', 'warning');
    } else {
      reporter.box(
        `Generated Convex code in ${outputDir}/\n\nNext steps:\n  1. Review the generated schema.ts\n  2. Run \`npx convex dev\` to deploy\n  3. Update your app to use the new Convex functions`,
        'success'
      );
    }
  } finally {
    await pool.end();
  }
}

/**
 * Run full migration (schema + data)
 */
async function runFullMigration(
  config: Partial<MigrationConfig>,
  outputDir: string,
  reporter: ProgressReporter
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

  reporter.startSpinner('Initializing migration engine...');

  const engine = await createMigrationEngine({
    ...config,
    stateDir: './.migration',
  });

  // Register engine for signal handling
  registerActiveEngine(engine, reporter);

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
      process.exit(1);
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

    if (report.status === 'completed') {
      reporter.box('Migration completed successfully!', 'success');
    } else if (report.status === 'partial') {
      reporter.box(
        'Migration completed with some failures.\nUse --resume to retry failed tables.',
        'warning'
      );
    } else {
      reporter.box('Migration failed. Check errors above.', 'error');
      process.exit(1);
    }
  } finally {
    unregisterActiveEngine();
    await engine.close();
  }
}

/**
 * Run data-only migration
 */
async function runDataOnlyMigration(
  config: Partial<MigrationConfig>,
  reporter: ProgressReporter
): Promise<void> {
  reporter.box(
    'Data-only migration not yet implemented.\nPlease use schema-and-data mode for now.',
    'warning'
  );
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
