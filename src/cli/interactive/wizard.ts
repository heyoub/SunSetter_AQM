/**
 * Interactive Migration Wizard
 *
 * Provides a guided, step-by-step experience for configuring
 * and running PostgreSQL to Convex migrations.
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
  type ConvexCredentials,
} from '../auth/convex-auth.js';

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
}

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
    // Print welcome
    this.reporter.printWelcome('PostgreSQL to Convex Migration', '1.0.0');

    console.log();
    this.reporter.box(
      'This wizard will guide you through migrating your PostgreSQL\n' +
        'database to Convex. You can also use flags for non-interactive mode.'
    );
    console.log();

    // Step 1: Migration mode
    const mode = await this.selectMigrationMode();

    // Step 2: Database connection (if needed)
    let connectionString = '';
    if (mode !== 'data-only') {
      connectionString = await this.getConnectionString();
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
    };
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
   * Step 2: Get database connection string
   */
  private async getConnectionString(): Promise<string> {
    // Check for environment variable first
    const envConnection = process.env.DATABASE_URL || process.env.POSTGRES_URL;

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
        return envConnection;
      }
    }

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

    return connectionString;
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
            name: '📄 I\'ll set environment variables - Skip for now',
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
      console.log(chalk.yellow('⚠️  Remember to set these environment variables:'));
      console.log(chalk.dim('   CONVEX_URL=https://your-project.convex.cloud'));
      console.log(chalk.dim('   CONVEX_DEPLOY_KEY=prod:your-deploy-key'));
      console.log();
      return { url: '', deployKey: '' };
    }
  }

  /**
   * Browser-based authentication flow
   */
  private async authenticateWithBrowser(): Promise<{ url: string; deployKey: string }> {
    const result = await authenticateConvex({
      onStatusChange: (status) => console.log(status),
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
  private async getCredentialsManually(): Promise<{ url: string; deployKey: string }> {
    console.log();
    console.log(chalk.cyan('📋 Get your credentials from:'));
    console.log(chalk.dim('   https://dashboard.convex.dev → Your Project → Settings → Deploy Keys'));
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
