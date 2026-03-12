/**
 * Interactive Migration Wizard
 *
 * Provides a guided, step-by-step experience for configuring
 * and running SQL database to Convex migrations.
 *
 * Features:
 * - Database connection testing with retry (up to 3 attempts)
 * - Graceful SIGINT/SIGTERM shutdown handling
 * - Non-TTY detection and fallback
 * - Multi-database support (PostgreSQL, MySQL, SQLite, MSSQL)
 *
 * Inspired by Convex's friendly CLI UX.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import type { TableInfo } from '../../introspector/schema-introspector.js';
import type { MigrationConfig } from '../../migration/types.js';
import { ProgressReporter } from '../progress/reporter.js';
import {
  authenticateConvex,
  detectExistingCredentials,
  saveCredentials,
} from '../auth/convex-auth.js';
import {
  createAdapter,
  parseConnectionString as parseConnStr,
  type DatabaseAdapter,
} from '../../adapters/index.js';
import { SchemaIntrospector } from '../../introspector/schema-introspector.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Migration mode options
 */
export type MigrationMode = 'schema-only' | 'schema-and-data' | 'data-only';

/**
 * Wizard configuration result
 */
export interface WizardResult {
  mode: MigrationMode;
  config: Partial<MigrationConfig>;
  selectedTables: string[];
  outputDir: string;
  confirmed: boolean;
  /** Whether the wizard was cancelled by user (Ctrl+C or explicit cancel) */
  cancelled: boolean;
}

/**
 * Default wizard result for non-interactive or cancelled flows
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
// Graceful Shutdown
// ============================================================================

let isWizardActive = false;

/**
 * Signal handler references so we can remove them on cleanup
 */
let sigintHandler: (() => void) | null = null;
let sigtermHandler: (() => void) | null = null;

/**
 * Setup graceful shutdown for the wizard.
 * When SIGINT/SIGTERM is received while the wizard is active,
 * prints a friendly message and exits cleanly.
 */
function setupWizardShutdownHandler(): void {
  const handleExit = () => {
    if (isWizardActive) {
      console.log('\n');
      console.log(chalk.yellow('  Wizard cancelled by user.'));
      console.log(chalk.gray('  Run with --help to see CLI options.'));
      console.log();

      isWizardActive = false;
      process.exit(0);
    }
  };

  sigintHandler = handleExit;
  sigtermHandler = handleExit;
  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
}

/**
 * Remove the shutdown handlers set up by setupWizardShutdownHandler
 */
function cleanupWizardShutdownHandler(): void {
  isWizardActive = false;
  if (sigintHandler) {
    process.removeListener('SIGINT', sigintHandler);
    sigintHandler = null;
  }
  if (sigtermHandler) {
    process.removeListener('SIGTERM', sigtermHandler);
    sigtermHandler = null;
  }
}

// ============================================================================
// TTY Detection
// ============================================================================

/**
 * Check if running in an interactive terminal.
 * Returns false in CI environments or dumb terminals.
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
 * Check if the wizard should auto-run based on CLI args.
 * Returns true when no connection info is provided and we're in an interactive TTY.
 */
export function shouldAutoRunWizard(args: string[]): boolean {
  // Explicit --wizard flag
  if (args.includes('--wizard') || args.includes('-w')) {
    return true;
  }

  // Don't run wizard for help/version
  if (
    args.includes('--help') ||
    args.includes('-h') ||
    args.includes('--version') ||
    args.includes('-V')
  ) {
    return false;
  }

  // Check if connection info was provided via args
  const hasConnectionArg = args.some(
    (arg) =>
      arg.includes('--connection') ||
      arg.includes('-c') ||
      arg.startsWith('postgresql://') ||
      arg.startsWith('postgres://') ||
      arg.startsWith('mysql://') ||
      arg.startsWith('sqlite://') ||
      arg.startsWith('mssql://')
  );

  // Check if connection info is in environment
  const hasEnvConnection = Boolean(
    process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.PG_CONNECTION_STRING
  );

  // Auto-run wizard if no connection provided and in interactive TTY
  return !hasConnectionArg && !hasEnvConnection && isInteractiveTTY();
}

// ============================================================================
// Connection Testing
// ============================================================================

/**
 * Test a database connection using the adapter system.
 * Works with all supported database types (PostgreSQL, MySQL, SQLite, MSSQL).
 *
 * On success, also introspects the schema to discover tables.
 */
async function testConnection(
  connectionString: string,
  reporter: ProgressReporter
): Promise<{ success: boolean; tables: TableInfo[]; error?: string }> {
  reporter.startSpinner('Testing connection...');

  let adapter: DatabaseAdapter | null = null;

  try {
    const config = parseConnStr(connectionString);
    adapter = createAdapter(config);

    // Test basic connectivity
    await adapter.connect();
    const isAlive = await adapter.testConnection();
    if (!isAlive) {
      throw new Error('Connection test returned false');
    }

    reporter.updateSpinner('Connected. Introspecting schema...');

    // Introspect schema to discover tables (use DB-appropriate default schema)
    const introspector = new SchemaIntrospector(adapter);
    const schema = await introspector.introspectSchema(adapter.getDefaultSchema());

    reporter.succeedSpinner(
      `Connected successfully! Found ${schema.tables.length} tables.`
    );

    await adapter.disconnect();

    return {
      success: true,
      tables: schema.tables,
    };
  } catch (error) {
    if (adapter) {
      await adapter.disconnect().catch(() => {});
    }

    const errorMessage = (error as Error).message;
    reporter.failSpinner(`Connection failed: ${errorMessage}`);

    return {
      success: false,
      tables: [],
      error: errorMessage,
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
  private tables: TableInfo[];

  constructor(tables: TableInfo[] = []) {
    this.reporter = new ProgressReporter({ logLevel: 'normal' });
    this.tables = tables;
  }

  /**
   * Set available tables for selection
   */
  setTables(tables: TableInfo[]): void {
    this.tables = tables;
  }

  /**
   * Run the full wizard
   */
  async run(): Promise<WizardResult> {
    // Check for non-TTY environment
    if (!isInteractiveTTY()) {
      return this.handleNonTTYFallback();
    }

    // Setup graceful shutdown
    isWizardActive = true;
    setupWizardShutdownHandler();

    try {
      // Print welcome
      this.reporter.printWelcome('PostgreSQL to Convex Migration', '1.6.0');

      console.log();
      this.reporter.box(
        'This wizard will guide you through migrating your PostgreSQL\n' +
          'database to Convex. You can also use flags for non-interactive mode.'
      );
      console.log();

      // Step 1: Migration mode
      const mode = await this.selectMigrationMode();

      // Step 2: Database connection with test + retry
      // All modes need a source DB connection (data-only still reads FROM the source)
      const connectionResult = await this.promptDatabaseConnection();
      if (!connectionResult.success) {
        cleanupWizardShutdownHandler();
        return { ...DEFAULT_WIZARD_RESULT, cancelled: true };
      }
      const connectionString = connectionResult.connectionString;
      // Use introspected tables if we got them from the connection test
      if (connectionResult.tables.length > 0) {
        this.tables = connectionResult.tables;
      }

      // Step 3: Convex configuration (if data migration)
      let convexUrl = '';
      let convexDeployKey = '';
      if (mode !== 'schema-only') {
        const convexConfig = await this.getConvexConfig();
        convexUrl = convexConfig.url;
        convexDeployKey = convexConfig.deployKey;
      }

      // Step 4: Table selection
      const selectedTables = await this.selectTables();

      // Step 5: Output directory
      const outputDir = await this.getOutputDir();

      // Step 6: Advanced options
      const advancedOptions = await this.getAdvancedOptions(mode);

      // Step 7: Confirmation
      const confirmed = await this.confirmMigration({
        mode,
        connectionString,
        convexUrl,
        selectedTables,
        outputDir,
        ...advancedOptions,
      });

      cleanupWizardShutdownHandler();

      return {
        mode,
        config: {
          connectionString,
          convexUrl,
          convexDeployKey,
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
        (error as Error).message?.includes('canceled')
      ) {
        console.log();
        console.log(chalk.yellow('  Wizard cancelled.'));
        return { ...DEFAULT_WIZARD_RESULT, cancelled: true };
      }

      throw error;
    }
  }

  /**
   * Handle non-TTY environment with helpful fallback message
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
        '  sunsetter migrate --connection "postgresql://user:pass@host/db"'
      )
    );
    console.log();
    console.log('Or set environment variables:');
    console.log(chalk.gray('  DATABASE_URL=postgresql://user:pass@host/db'));
    console.log();
    console.log('Run with --help for all options:');
    console.log(chalk.gray('  sunsetter migrate --help'));
    console.log();

    return { ...DEFAULT_WIZARD_RESULT, cancelled: true };
  }

  /**
   * Step 1: Select migration mode
   */
  private async selectMigrationMode(): Promise<MigrationMode> {
    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'What would you like to migrate?',
        choices: [
          {
            name: 'Schema + Data → Generate Convex schema and migrate all data',
            value: 'schema-and-data',
          },
          {
            name: 'Schema Only → Generate Convex schema, queries, mutations, and types',
            value: 'schema-only',
          },
          {
            name: 'Data Only → Migrate data using existing Convex schema',
            value: 'data-only',
          },
        ],
        default: 'schema-only',
      },
    ]);

    return mode;
  }

  /**
   * Step 2: Prompt for database connection with test and retry.
   *
   * Tests the connection after the user enters it. If the connection fails,
   * retries up to 3 times with the option to re-enter the connection string.
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
          message: 'Enter database connection string:',
          default: 'postgresql://user:password@localhost:5432/database',
          validate: (input: string) => {
            const validProtocols = [
              'postgresql://',
              'postgres://',
              'mysql://',
              'mariadb://',
              'sqlite://',
              'sqlite3://',
              'mssql://',
              'sqlserver://',
            ];

            const isValid = validProtocols.some((protocol) =>
              input.startsWith(protocol)
            );

            if (!isValid) {
              return `Connection string must start with one of: ${validProtocols.join(', ')}`;
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
   * Step 3: Get Convex configuration
   * Uses the smart auth flow: detect existing → browser auth → manual fallback
   */
  private async getConvexConfig(): Promise<{ url: string; deployKey: string }> {
    // First, check for existing credentials
    const existing = await detectExistingCredentials();

    if (existing?.credentials?.deployKey) {
      console.log();
      console.log(chalk.green('✓') + ' Found existing Convex credentials');
      console.log(chalk.dim(`  Source: ${existing.source}`));
      console.log(chalk.dim(`  URL: ${existing.credentials.deploymentUrl}`));
      console.log();

      const { useExisting } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useExisting',
          message: 'Use these existing credentials?',
          default: true,
        },
      ]);

      if (useExisting) {
        return {
          url: existing.credentials.deploymentUrl,
          deployKey: existing.credentials.deployKey,
        };
      }
    }

    // No existing credentials, offer auth methods
    console.log();
    console.log(chalk.cyan('🔐 Convex Authentication'));
    console.log(chalk.dim('   You need Convex credentials to migrate data.'));
    console.log();

    const { authMethod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'authMethod',
        message: 'How would you like to authenticate?',
        choices: [
          {
            name: '🌐 Open browser (recommended) - Opens Convex dashboard in your browser',
            value: 'browser',
          },
          {
            name: '⌨️  Enter manually - Paste credentials from the dashboard',
            value: 'manual',
          },
          {
            name: "📄 I'll set environment variables - Skip for now",
            value: 'skip',
          },
        ],
        default: 'browser',
      },
    ]);

    if (authMethod === 'browser') {
      return this.authenticateWithBrowser();
    } else if (authMethod === 'manual') {
      return this.getCredentialsManually();
    } else {
      // Skip - user will set env vars
      console.log();
      console.log(
        chalk.yellow('⚠️  Remember to set these environment variables:')
      );
      console.log(chalk.dim('   CONVEX_URL=https://your-project.convex.cloud'));
      console.log(chalk.dim('   CONVEX_DEPLOY_KEY=prod:your-deploy-key'));
      console.log();
      return { url: '', deployKey: '' };
    }
  }

  /**
   * Browser-based authentication flow
   */
  private async authenticateWithBrowser(): Promise<{
    url: string;
    deployKey: string;
  }> {
    const result = await authenticateConvex({
      onStatusChange: (status: string) => console.log(status),
    });

    if (result.success && result.credentials) {
      // Offer to save credentials
      const { saveToEnv } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'saveToEnv',
          message: 'Save credentials to .env.local for future use?',
          default: true,
        },
      ]);

      if (saveToEnv) {
        await saveCredentials(result.credentials);
        console.log(chalk.green('✓') + ' Credentials saved to .env.local');
      }

      return {
        url: result.credentials.deploymentUrl,
        deployKey: result.credentials.deployKey,
      };
    } else {
      console.log(chalk.red('✗') + ` Authentication failed: ${result.error}`);
      console.log(chalk.dim('  Falling back to manual entry...'));
      console.log();
      return this.getCredentialsManually();
    }
  }

  /**
   * Manual credential entry
   */
  private async getCredentialsManually(): Promise<{
    url: string;
    deployKey: string;
  }> {
    console.log();
    console.log(chalk.cyan('📋 Get your credentials from:'));
    console.log(
      chalk.dim(
        '   https://dashboard.convex.dev → Your Project → Settings → Deploy Keys'
      )
    );
    console.log();

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Deployment URL:',
        default: 'https://your-project.convex.cloud',
        validate: (input: string) => {
          if (!input.includes('convex.cloud') && !input.includes('localhost')) {
            return 'Please enter a valid Convex deployment URL (must contain convex.cloud)';
          }
          return true;
        },
      },
      {
        type: 'password',
        name: 'deployKey',
        message: 'Deploy Key:',
        mask: '*',
        validate: (input: string) => {
          if (!input || input.length < 10) {
            return 'Please enter a valid deploy key (should start with prod: or dev:)';
          }
          return true;
        },
      },
    ]);

    // Offer to save
    const { saveToEnv } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'saveToEnv',
        message: 'Save credentials to .env.local?',
        default: true,
      },
    ]);

    if (saveToEnv) {
      await saveCredentials({
        deploymentUrl: answers.url,
        deployKey: answers.deployKey,
      });
      console.log(chalk.green('✓') + ' Credentials saved to .env.local');
    }

    return answers;
  }

  /**
   * Step 4: Select tables to migrate
   */
  private async selectTables(): Promise<string[]> {
    if (this.tables.length === 0) {
      return [];
    }

    const { selectAll } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'selectAll',
        message: `Found ${this.tables.length} tables. Migrate all of them?`,
        default: true,
      },
    ]);

    if (selectAll) {
      return this.tables.map((t) => t.tableName);
    }

    const { selectedTables } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedTables',
        message: 'Select tables to migrate:',
        choices: this.tables.map((t) => ({
          name: `${t.tableName} (${t.columns.length} columns)`,
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
   * Step 5: Get output directory
   */
  private async getOutputDir(): Promise<string> {
    const { outputChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'outputChoice',
        message: 'Where should the generated Convex code be saved?',
        choices: [
          {
            name: 'Standard (./convex) - Recommended for Convex projects',
            value: './convex',
          },
          {
            name: 'Safe Output (./out) - Prevents accidental deletion in dist/',
            value: './out',
          },
          {
            name: 'Custom Path - Enter a custom directory path',
            value: 'custom',
          },
        ],
        default: './convex',
      },
    ]);

    if (outputChoice === 'custom') {
      const { customPath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customPath',
          message: 'Enter custom output directory:',
          default: './generated-convex',
          validate: (input: string) => {
            if (!input.trim()) return 'Path cannot be empty';
            return true;
          },
        },
      ]);
      return customPath;
    }

    return outputChoice;
  }

  /**
   * Step 6: Get advanced options
   */
  private async getAdvancedOptions(
    mode: MigrationMode
  ): Promise<Partial<MigrationConfig>> {
    const { showAdvanced } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'showAdvanced',
        message: 'Configure advanced options?',
        default: false,
      },
    ]);

    if (!showAdvanced) {
      return {
        batchSize: 100,
        maxRetries: 3,
        dryRun: false,
      };
    }

    const options: Partial<MigrationConfig> = {};

    // Batch size (for data migration)
    if (mode !== 'schema-only') {
      const { batchSize } = await inquirer.prompt([
        {
          type: 'number',
          name: 'batchSize',
          message: 'Batch size for data migration:',
          default: 100,
          validate: (input: number) => {
            if (input < 1 || input > 1000) {
              return 'Batch size must be between 1 and 1000';
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
        },
      ]);
      options.rateLimit = rateLimit;

      const { maxRetries } = await inquirer.prompt([
        {
          type: 'number',
          name: 'maxRetries',
          message: 'Maximum retries per batch:',
          default: 3,
        },
      ]);
      options.maxRetries = maxRetries;
    }

    // Dry run option
    const { dryRun } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'dryRun',
        message: 'Enable dry run mode (preview without writing)?',
        default: false,
      },
    ]);
    options.dryRun = dryRun;

    return options;
  }

  /**
   * Step 7: Confirm migration
   */
  private async confirmMigration(summary: {
    mode: MigrationMode;
    connectionString: string;
    convexUrl: string;
    selectedTables: string[];
    outputDir: string;
    dryRun?: boolean;
  }): Promise<boolean> {
    console.log();
    this.reporter.box(this.formatSummary(summary));
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

  /**
   * Format migration summary
   */
  private formatSummary(summary: {
    mode: MigrationMode;
    connectionString: string;
    convexUrl: string;
    selectedTables: string[];
    outputDir: string;
    dryRun?: boolean;
  }): string {
    const modeLabel = {
      'schema-only': 'Schema Only',
      'schema-and-data': 'Schema + Data',
      'data-only': 'Data Only',
    }[summary.mode];

    const maskedConnection = summary.connectionString.replace(
      /(:\/\/[^:]+:)[^@]+(@)/,
      '$1****$2'
    );

    const lines = [
      'Migration Summary',
      '─'.repeat(40),
      `Mode:       ${modeLabel}`,
      `Database:   ${maskedConnection}`,
    ];

    if (summary.convexUrl) {
      lines.push(`Convex:     ${summary.convexUrl}`);
    }

    lines.push(`Output:     ${summary.outputDir}`);
    lines.push(`Tables:     ${summary.selectedTables.length} selected`);

    if (summary.dryRun) {
      lines.push(`Dry Run:    Yes (no data will be written)`);
    }

    return lines.join('\n');
  }

  /**
   * Show table selection with details
   */
  async showTableDetails(): Promise<void> {
    if (this.tables.length === 0) {
      console.log('No tables available.');
      return;
    }

    console.log('\nAvailable Tables:');
    console.log('─'.repeat(60));

    for (const table of this.tables) {
      const fkCount = table.foreignKeys.length;
      const idxCount = table.indexes.length;
      console.log(
        `  ${table.tableName.padEnd(30)} ${table.columns.length} cols | ${fkCount} FKs | ${idxCount} indexes`
      );
    }

    console.log('─'.repeat(60));
    console.log(`Total: ${this.tables.length} tables\n`);
  }

  /**
   * Quick confirmation for non-interactive mode
   */
  async quickConfirm(message: string): Promise<boolean> {
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message,
        default: true,
      },
    ]);

    return confirmed;
  }

  /**
   * Select single option from list
   */
  async selectOption<T>(
    message: string,
    choices: { name: string; value: T }[]
  ): Promise<T> {
    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message,
        choices,
      },
    ]);

    return selected;
  }

  /**
   * Get text input
   */
  async getInput(
    message: string,
    defaultValue?: string,
    validate?: (input: string) => boolean | string
  ): Promise<string> {
    const { value } = await inquirer.prompt([
      {
        type: 'input',
        name: 'value',
        message,
        default: defaultValue,
        validate,
      },
    ]);

    return value;
  }

  /**
   * Get password input
   */
  async getPassword(message: string): Promise<string> {
    const { value } = await inquirer.prompt([
      {
        type: 'password',
        name: 'value',
        message,
        mask: '*',
      },
    ]);

    return value;
  }
}

/**
 * Create and run the interactive wizard
 */
export async function runWizard(
  tables: TableInfo[] = []
): Promise<WizardResult> {
  const wizard = new InteractiveWizard(tables);
  return wizard.run();
}
