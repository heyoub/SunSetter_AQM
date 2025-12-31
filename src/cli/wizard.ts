/**
 * Interactive Migration Wizard
 *
 * A comprehensive, production-quality interactive wizard for the PostgreSQL
 * to Convex migration tool. Features:
 * - Auto-detection when to show (no args or --wizard flag)
 * - Database connection testing
 * - Multi-select table selection
 * - Sensible defaults with customization
 * - Graceful Ctrl+C handling
 * - Non-TTY fallback
 *
 * Inspired by Convex's friendly CLI UX.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Pool } from 'pg';
import type { TableInfo } from '../introspector/schema-introspector.js';
import { SchemaIntrospector } from '../introspector/schema-introspector.js';
import type { MigrationConfig } from '../migration/types.js';
import { ProgressReporter } from './progress/reporter.js';
import {
  type IDatabaseConnection,
  type EnhancedPoolConfig,
} from '../config/database.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Migration mode options
 */
export type MigrationMode = 'schema-only' | 'schema-and-data' | 'data-only';

/**
 * Complete wizard result with all configuration
 */
export interface WizardResult {
  mode: MigrationMode;
  config: Partial<MigrationConfig>;
  selectedTables: string[];
  outputDir: string;
  confirmed: boolean;
  /** Whether the wizard was cancelled by user (Ctrl+C) */
  cancelled: boolean;
}

/**
 * Options for running the wizard
 */
export interface WizardOptions {
  /** Force wizard to run even if args provided */
  forceWizard?: boolean;
  /** Skip wizard even if no args (for testing) */
  skipWizard?: boolean;
  /** Pre-populate connection string */
  connectionString?: string;
  /** Pre-populated tables (if already introspected) */
  tables?: TableInfo[];
}

/**
 * Default wizard result for non-interactive fallback
 */
const DEFAULT_WIZARD_RESULT: WizardResult = {
  mode: 'schema-only',
  config: {},
  selectedTables: [],
  outputDir: './convex',
  confirmed: false,
  cancelled: true,
};

// ============================================================================
// Graceful Shutdown Handler
// ============================================================================

let isWizardActive = false;
let wizardAbortController: AbortController | null = null;

/**
 * Setup graceful shutdown for the wizard
 */
function setupWizardShutdownHandler(): void {
  const handleExit = () => {
    if (isWizardActive) {
      console.log('\n');
      console.log(chalk.yellow('  Wizard cancelled by user.'));
      console.log(chalk.gray('  Run with --help to see CLI options.'));
      console.log();

      if (wizardAbortController) {
        wizardAbortController.abort();
      }

      isWizardActive = false;
      process.exit(0);
    }
  };

  // Handle Ctrl+C
  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
}

/**
 * Cleanup shutdown handlers
 */
function cleanupWizardShutdownHandler(): void {
  isWizardActive = false;
  wizardAbortController = null;
}

// ============================================================================
// TTY Detection
// ============================================================================

/**
 * Check if running in interactive terminal
 */
export function isInteractiveTTY(): boolean {
  return Boolean(
    process.stdin.isTTY &&
      process.stdout.isTTY &&
      !process.env.CI &&
      !process.env.CONTINUOUS_INTEGRATION &&
      process.env.TERM !== 'dumb'
  );
}

/**
 * Check if wizard should auto-run based on CLI args
 */
export function shouldAutoRunWizard(args: string[]): boolean {
  // Check for --wizard flag
  if (args.includes('--wizard') || args.includes('-w')) {
    return true;
  }

  // If only help/version flags, don't run wizard
  if (
    args.includes('--help') ||
    args.includes('-h') ||
    args.includes('--version') ||
    args.includes('-V')
  ) {
    return false;
  }

  // If no connection string and no other meaningful options, offer wizard
  const hasConnectionArg = args.some(
    (arg) =>
      arg.includes('--connection') ||
      arg.includes('-c') ||
      arg.startsWith('postgresql://') ||
      arg.startsWith('postgres://')
  );

  const hasEnvConnection = Boolean(
    process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.PG_CONNECTION_STRING
  );

  // Auto-run wizard if:
  // 1. No connection provided via args AND
  // 2. No connection in environment AND
  // 3. Running in interactive TTY
  return !hasConnectionArg && !hasEnvConnection && isInteractiveTTY();
}

// ============================================================================
// Connection Testing
// ============================================================================

/**
 * Test database connection with detailed feedback
 */
async function testConnection(
  connectionString: string,
  reporter: ProgressReporter
): Promise<{ success: boolean; tables: TableInfo[]; error?: string }> {
  reporter.startSpinner('Testing connection...');

  const pool = new Pool({ connectionString });

  try {
    // Test basic connectivity
    await pool.query('SELECT 1');
    reporter.updateSpinner('Connected. Introspecting schema...');

    // Create a minimal connection wrapper for the introspector
    const dbConnection: IDatabaseConnection = {
      async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
        const result = await pool.query(sql, params);
        return result.rows as T[];
      },
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
      getConfig(): Omit<EnhancedPoolConfig, 'password'> {
        const poolWithConfig = pool as Pool & {
          options?: {
            host?: string;
            port?: number;
            database?: string;
            user?: string;
          };
        };
        return {
          host: poolWithConfig.options?.host || 'unknown',
          port: poolWithConfig.options?.port || 5432,
          database: poolWithConfig.options?.database || 'unknown',
          username: poolWithConfig.options?.user || 'unknown',
        } as Omit<EnhancedPoolConfig, 'password'>;
      },
    };

    // Introspect schema to get tables
    const introspector = new SchemaIntrospector(dbConnection);
    const schema = await introspector.introspectSchema('public');

    reporter.succeedSpinner(
      `Connected successfully! Found ${schema.tables.length} tables.`
    );

    await pool.end();

    return {
      success: true,
      tables: schema.tables,
    };
  } catch (error) {
    await pool.end().catch(() => {});

    const errorMessage = (error as Error).message;
    reporter.failSpinner(`Connection failed: ${errorMessage}`);

    return {
      success: false,
      tables: [],
      error: errorMessage,
    };
  }
}

/**
 * Parse connection string to show user-friendly info
 */
function parseConnectionString(connStr: string): {
  host: string;
  port: string;
  database: string;
  user: string;
} {
  try {
    const url = new URL(connStr);
    return {
      host: url.hostname || 'localhost',
      port: url.port || '5432',
      database: url.pathname.replace('/', '') || 'postgres',
      user: url.username || 'postgres',
    };
  } catch {
    return {
      host: 'unknown',
      port: '5432',
      database: 'unknown',
      user: 'unknown',
    };
  }
}

// ============================================================================
// Main Wizard Class
// ============================================================================

/**
 * Interactive wizard for migration configuration
 */
export class InteractiveWizard {
  private reporter: ProgressReporter;
  private tables: TableInfo[] = [];
  private connectionString: string = '';

  constructor(options: WizardOptions = {}) {
    this.reporter = new ProgressReporter({ logLevel: 'normal' });
    this.tables = options.tables || [];
    this.connectionString = options.connectionString || '';
  }

  /**
   * Run the full wizard flow
   */
  async run(): Promise<WizardResult> {
    // Check for non-TTY environment
    if (!isInteractiveTTY()) {
      return this.handleNonTTYFallback();
    }

    // Setup graceful shutdown
    isWizardActive = true;
    wizardAbortController = new AbortController();
    setupWizardShutdownHandler();

    try {
      // Print welcome
      this.printWelcome();

      // Step 1: Database connection (with test)
      const connectionResult = await this.promptDatabaseConnection();
      if (!connectionResult.success) {
        return { ...DEFAULT_WIZARD_RESULT, cancelled: true };
      }
      this.connectionString = connectionResult.connectionString;
      this.tables = connectionResult.tables;

      // Step 2: Migration mode
      const mode = await this.promptMigrationMode();

      // Step 3: Convex configuration (if data migration)
      let convexUrl = '';
      let convexDeployKey = '';
      if (mode !== 'schema-only') {
        const convexConfig = await this.promptConvexConfig();
        convexUrl = convexConfig.url;
        convexDeployKey = convexConfig.deployKey;
      }

      // Step 4: Table selection
      const selectedTables = await this.promptTableSelection();

      // Step 5: Output directory
      const outputDir = await this.promptOutputDir();

      // Step 6: Advanced options (batch size, rate limit, dry run)
      const advancedOptions = await this.promptAdvancedOptions(mode);

      // Step 7: Show summary and confirm
      const confirmed = await this.showSummaryAndConfirm({
        mode,
        connectionString: this.connectionString,
        convexUrl,
        selectedTables,
        outputDir,
        ...advancedOptions,
      });

      cleanupWizardShutdownHandler();

      return {
        mode,
        config: {
          connectionString: this.connectionString,
          convexUrl: convexUrl || undefined,
          convexDeployKey: convexDeployKey || undefined,
          ...advancedOptions,
        },
        selectedTables,
        outputDir,
        confirmed,
        cancelled: false,
      };
    } catch (error) {
      cleanupWizardShutdownHandler();

      // Handle user cancellation (Ctrl+C in inquirer)
      if (
        (error instanceof Error &&
          'isTtyError' in error &&
          (error as Record<string, unknown>).isTtyError === true) ||
        (error as Error).message.includes('canceled')
      ) {
        console.log();
        console.log(chalk.yellow('  Wizard cancelled.'));
        return { ...DEFAULT_WIZARD_RESULT, cancelled: true };
      }

      throw error;
    }
  }

  /**
   * Handle non-TTY environment
   */
  private handleNonTTYFallback(): WizardResult {
    console.log(chalk.yellow('Non-interactive environment detected.'));
    console.log();
    console.log(
      'To run the migration, please provide options via command line:'
    );
    console.log();
    console.log(
      chalk.cyan(
        '  convconv migrate --connection "postgresql://user:pass@host/db"'
      )
    );
    console.log();
    console.log('Or set environment variables:');
    console.log(chalk.gray('  DATABASE_URL=postgresql://user:pass@host/db'));
    console.log();
    console.log('Run with --help for all options:');
    console.log(chalk.gray('  convconv migrate --help'));
    console.log();

    return { ...DEFAULT_WIZARD_RESULT, cancelled: true };
  }

  /**
   * Print welcome banner
   */
  private printWelcome(): void {
    console.log();
    console.log(chalk.bold.cyan('  PostgreSQL to Convex Migration Wizard'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
    console.log();
    console.log(
      chalk.gray(
        '  This wizard will guide you through migrating your PostgreSQL'
      )
    );
    console.log(
      chalk.gray('  database to Convex. Press Ctrl+C to cancel at any time.')
    );
    console.log();
  }

  /**
   * Step 1: Prompt for database connection with test
   */
  private async promptDatabaseConnection(): Promise<{
    success: boolean;
    connectionString: string;
    tables: TableInfo[];
  }> {
    // Check for environment variable
    const envConnection =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.PG_CONNECTION_STRING;

    if (envConnection) {
      const { useEnv } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useEnv',
          message: `Found DATABASE_URL in environment. Use this connection?`,
          default: true,
        },
      ]);

      if (useEnv) {
        const result = await testConnection(envConnection, this.reporter);
        if (result.success) {
          return {
            success: true,
            connectionString: envConnection,
            tables: result.tables,
          };
        }

        // Connection failed, offer to enter manually
        console.log();
        console.log(
          chalk.yellow(
            '  Would you like to enter a different connection string?'
          )
        );
      }
    }

    // Prompt for connection string with retry loop
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      const { connectionString } = await inquirer.prompt([
        {
          type: 'input',
          name: 'connectionString',
          message: 'Enter PostgreSQL connection string:',
          default: 'postgresql://user:password@localhost:5432/database',
          validate: (input: string) => {
            if (
              !input.startsWith('postgresql://') &&
              !input.startsWith('postgres://')
            ) {
              return 'Connection string must start with postgresql:// or postgres://';
            }
            return true;
          },
        },
      ]);

      // Test connection
      const result = await testConnection(connectionString, this.reporter);

      if (result.success) {
        return {
          success: true,
          connectionString,
          tables: result.tables,
        };
      }

      attempts++;

      if (attempts < maxAttempts) {
        const { retry } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'retry',
            message: 'Would you like to try a different connection string?',
            default: true,
          },
        ]);

        if (!retry) {
          return { success: false, connectionString: '', tables: [] };
        }
      }
    }

    console.log(chalk.red('  Maximum connection attempts reached.'));
    return { success: false, connectionString: '', tables: [] };
  }

  /**
   * Step 2: Prompt for migration mode
   */
  private async promptMigrationMode(): Promise<MigrationMode> {
    console.log();

    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'What would you like to migrate?',
        choices: [
          {
            name: `${chalk.green('Schema Only')} - Generate Convex schema, queries, mutations, and types`,
            value: 'schema-only',
          },
          {
            name: `${chalk.yellow('Schema + Data')} - Generate schema AND migrate all data to Convex`,
            value: 'schema-and-data',
          },
          {
            name: `${chalk.blue('Data Only')} - Migrate data using existing Convex schema`,
            value: 'data-only',
          },
        ],
        default: 'schema-only',
      },
    ]);

    return mode;
  }

  /**
   * Step 3: Prompt for Convex configuration
   */
  private async promptConvexConfig(): Promise<{
    url: string;
    deployKey: string;
  }> {
    console.log();
    console.log(
      chalk.gray('  Data migration requires Convex deployment credentials.')
    );

    // Check for environment variables
    const envUrl = process.env.CONVEX_URL;
    const envKey = process.env.CONVEX_DEPLOY_KEY;

    if (envUrl && envKey) {
      const { useEnv } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useEnv',
          message: 'Found Convex credentials in environment. Use these?',
          default: true,
        },
      ]);

      if (useEnv) {
        return { url: envUrl, deployKey: envKey };
      }
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Convex deployment URL:',
        default: envUrl || 'https://your-project.convex.cloud',
        validate: (input: string) => {
          if (!input.includes('.convex.') && !input.includes('localhost')) {
            return 'Please enter a valid Convex deployment URL';
          }
          return true;
        },
      },
      {
        type: 'password',
        name: 'deployKey',
        message: 'Convex deploy key:',
        mask: '*',
        validate: (input: string) => {
          if (!input || input.length < 10) {
            return 'Please enter a valid deploy key (get it from your Convex dashboard)';
          }
          return true;
        },
      },
    ]);

    return answers;
  }

  /**
   * Step 4: Prompt for table selection
   */
  private async promptTableSelection(): Promise<string[]> {
    console.log();

    if (this.tables.length === 0) {
      console.log(chalk.yellow('  No tables found in the database.'));
      return [];
    }

    // Show table summary
    console.log(chalk.gray(`  Found ${this.tables.length} tables:`));
    console.log();

    // Group tables by rough size (column count as proxy)
    const smallTables = this.tables.filter((t) => t.columns.length <= 5);
    const mediumTables = this.tables.filter(
      (t) => t.columns.length > 5 && t.columns.length <= 15
    );
    const largeTables = this.tables.filter((t) => t.columns.length > 15);

    if (smallTables.length > 0) {
      console.log(
        chalk.gray(`    Small (1-5 cols): ${smallTables.length} tables`)
      );
    }
    if (mediumTables.length > 0) {
      console.log(
        chalk.gray(`    Medium (6-15 cols): ${mediumTables.length} tables`)
      );
    }
    if (largeTables.length > 0) {
      console.log(
        chalk.gray(`    Large (15+ cols): ${largeTables.length} tables`)
      );
    }
    console.log();

    // Ask if user wants all tables
    const { selectAll } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'selectAll',
        message: `Migrate all ${this.tables.length} tables?`,
        default: true,
      },
    ]);

    if (selectAll) {
      return this.tables.map((t) => t.tableName);
    }

    // Multi-select tables
    const { selectedTables } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedTables',
        message: 'Select tables to migrate:',
        choices: this.tables.map((t) => ({
          name: `${t.tableName} (${t.columns.length} columns${t.foreignKeys.length > 0 ? `, ${t.foreignKeys.length} FKs` : ''})`,
          value: t.tableName,
          checked: true,
        })),
        pageSize: 15,
        validate: (input: string[]) => {
          if (input.length === 0) {
            return 'Please select at least one table';
          }
          return true;
        },
      },
    ]);

    return selectedTables;
  }

  /**
   * Step 5: Prompt for output directory
   */
  private async promptOutputDir(): Promise<string> {
    const { outputDir } = await inquirer.prompt([
      {
        type: 'input',
        name: 'outputDir',
        message: 'Output directory for generated Convex code:',
        default: './convex',
      },
    ]);

    return outputDir;
  }

  /**
   * Step 6: Prompt for advanced options
   */
  private async promptAdvancedOptions(
    mode: MigrationMode
  ): Promise<Partial<MigrationConfig>> {
    const { showAdvanced } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'showAdvanced',
        message: 'Configure advanced options? (batch size, rate limit, etc.)',
        default: false,
      },
    ]);

    if (!showAdvanced) {
      return {
        batchSize: 100,
        rateLimit: 100,
        maxRetries: 3,
        dryRun: false,
      };
    }

    const options: Partial<MigrationConfig> = {};

    // Batch size and rate limit (for data migration)
    if (mode !== 'schema-only') {
      console.log();
      console.log(chalk.gray('  Data Migration Settings'));
      console.log(chalk.gray('  ' + '\u2500'.repeat(25)));

      const { batchSize } = await inquirer.prompt([
        {
          type: 'number',
          name: 'batchSize',
          message: 'Batch size (rows per insert):',
          default: 100,
          validate: (input: number) => {
            if (isNaN(input) || input < 1 || input > 500) {
              return 'Batch size must be between 1 and 500';
            }
            return true;
          },
        },
      ]);
      options.batchSize = batchSize;

      const { rateLimit } = await inquirer.prompt([
        {
          type: 'number',
          name: 'rateLimit',
          message: 'Rate limit (requests per second):',
          default: 100,
          validate: (input: number) => {
            if (isNaN(input) || input < 1 || input > 1000) {
              return 'Rate limit must be between 1 and 1000';
            }
            return true;
          },
        },
      ]);
      options.rateLimit = rateLimit;

      const { maxRetries } = await inquirer.prompt([
        {
          type: 'number',
          name: 'maxRetries',
          message: 'Max retries per batch:',
          default: 3,
          validate: (input: number) => {
            if (isNaN(input) || input < 0 || input > 10) {
              return 'Max retries must be between 0 and 10';
            }
            return true;
          },
        },
      ]);
      options.maxRetries = maxRetries;
    }

    // Dry run option
    console.log();
    const { dryRun } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'dryRun',
        message: 'Enable dry run mode? (preview without writing files/data)',
        default: false,
      },
    ]);
    options.dryRun = dryRun;

    return options;
  }

  /**
   * Step 7: Show summary and confirm
   */
  private async showSummaryAndConfirm(summary: {
    mode: MigrationMode;
    connectionString: string;
    convexUrl: string;
    selectedTables: string[];
    outputDir: string;
    dryRun?: boolean;
    batchSize?: number;
    rateLimit?: number;
  }): Promise<boolean> {
    console.log();
    console.log(chalk.bold.white('  Migration Summary'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
    console.log();

    // Mode
    const modeLabels = {
      'schema-only': chalk.green('Schema Only'),
      'schema-and-data': chalk.yellow('Schema + Data'),
      'data-only': chalk.blue('Data Only'),
    };
    console.log(`  ${chalk.white('Mode:')}        ${modeLabels[summary.mode]}`);

    // Connection (masked)
    const connInfo = parseConnectionString(summary.connectionString);
    console.log(
      `  ${chalk.white('Database:')}    ${connInfo.user}@${connInfo.host}:${connInfo.port}/${connInfo.database}`
    );

    // Convex URL
    if (summary.convexUrl) {
      console.log(`  ${chalk.white('Convex:')}      ${summary.convexUrl}`);
    }

    // Output
    console.log(`  ${chalk.white('Output:')}      ${summary.outputDir}`);

    // Tables
    console.log(
      `  ${chalk.white('Tables:')}      ${summary.selectedTables.length} selected`
    );
    if (summary.selectedTables.length <= 5) {
      for (const table of summary.selectedTables) {
        console.log(chalk.gray(`              - ${table}`));
      }
    } else {
      for (const table of summary.selectedTables.slice(0, 3)) {
        console.log(chalk.gray(`              - ${table}`));
      }
      console.log(
        chalk.gray(
          `              ... and ${summary.selectedTables.length - 3} more`
        )
      );
    }

    // Advanced options
    if (summary.batchSize && summary.batchSize !== 100) {
      console.log(`  ${chalk.white('Batch Size:')} ${summary.batchSize}`);
    }
    if (summary.rateLimit && summary.rateLimit !== 100) {
      console.log(`  ${chalk.white('Rate Limit:')} ${summary.rateLimit} req/s`);
    }

    // Dry run warning
    if (summary.dryRun) {
      console.log();
      console.log(
        chalk.yellow('  DRY RUN MODE - No files or data will be written')
      );
    }

    console.log();
    console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
    console.log();

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Proceed with migration?',
        default: true,
      },
    ]);

    return confirmed;
  }
}

// ============================================================================
// Main Export Function
// ============================================================================

/**
 * Run the interactive wizard
 *
 * This is the main entry point for the wizard. It handles:
 * - Non-TTY detection and fallback
 * - Graceful Ctrl+C handling
 * - Full migration configuration flow
 *
 * @param options - Optional configuration for the wizard
 * @returns Complete wizard result with migration configuration
 *
 * @example
 * ```typescript
 * import { runWizard, shouldAutoRunWizard } from './wizard.js';
 *
 * // Check if wizard should run
 * if (shouldAutoRunWizard(process.argv.slice(2))) {
 *   const result = await runWizard();
 *   if (result.confirmed) {
 *     // Use result.config for migration
 *   }
 * }
 * ```
 */
export async function runWizard(
  options: WizardOptions = {}
): Promise<WizardResult> {
  // If tables are already provided, pass them to the wizard
  const wizard = new InteractiveWizard(options);
  return wizard.run();
}

/**
 * Legacy compatibility: Run wizard with pre-introspected tables
 *
 * @deprecated Use runWizard(options) instead
 */
export async function runWizardWithTables(
  tables: TableInfo[]
): Promise<WizardResult> {
  const wizard = new InteractiveWizard({ tables });
  return wizard.run();
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { MigrationMode as WizardMigrationMode };
