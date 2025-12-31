#!/usr/bin/env node
/**
 * SunSetter AQM+ TUI Application
 *
 * Main entry point for the Terminal User Interface mode.
 * Launch with: sunsetter-aqm --tui or sunsetter-aqm -i
 */

import chalk from 'chalk';
import { printLogo, sunsetGradient, APP_NAME } from './branding.js';
import { showWelcomeScreen } from './screens/welcome.js';
import { TableInfo as TableSelectorInfo } from './screens/table-selector.js';
import { parseConnectionString, createAdapter } from '../adapters/index.js';
import { SchemaIntrospector } from '../introspector/schema-introspector.js';
import { DatabaseConnection } from '../config/database.js';
import { ConvexFunctionGenerator } from '../generator/convex/index.js';
import {
  findTsConfig,
  typecheck,
  formatTypecheckResult,
} from '../utils/typecheck.js';
import {
  authenticateConvex,
  detectExistingCredentials,
  saveCredentials,
  validateCredentials,
} from '../cli/auth/convex-auth.js';
import {
  textInput,
  passwordInput,
  confirm,
  selectFromList,
  multiSelectFromList,
} from '../utils/terminal-input.js';

/**
 * Reset terminal to normal state after blessed screen closes
 * blessed uses raw mode which can leave the terminal in a bad state
 */
function resetTerminalState(): void {
  // Force terminal out of raw mode
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // Ignore
    }
  }
  // Resume stdin
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }
  // Write a reset sequence
  process.stdout.write('\x1b[0m'); // Reset all attributes
}

// ============================================================================
// Visual Helpers - Proper alignment with ANSI codes and emojis
// ============================================================================

/**
 * Strip ANSI escape codes from a string for accurate length calculation
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Get visual width of string (ANSI-aware, emoji-aware)
 * Emojis typically render as 2 columns wide
 */
function visualWidth(str: string): number {
  const stripped = stripAnsi(str);
  let width = 0;
  for (const char of stripped) {
    // Emoji ranges (simplified - covers most common emojis)
    const code = char.codePointAt(0) || 0;
    if (code >= 0x1f300 && code <= 0x1f9ff) {
      width += 2; // Emoji
    } else if (code >= 0x2600 && code <= 0x26ff) {
      width += 2; // Misc symbols
    } else if (code >= 0x2700 && code <= 0x27bf) {
      width += 2; // Dingbats
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pad a string to target visual width (ANSI-aware)
 */
function padEnd(str: string, targetWidth: number, char = ' '): string {
  const currentWidth = visualWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + char.repeat(targetWidth - currentWidth);
}

/**
 * Get terminal width with fallback
 */
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

// ============================================================================
// Types
// ============================================================================

export interface TUIConfig {
  connectionString?: string;
  dbType?: string;
  convexUrl?: string;
  convexKey?: string;
  mode?: 'schema-only' | 'schema-and-data' | 'data-only';
}

// ============================================================================
// TUI Application
// ============================================================================

export class TUIApp {
  private config: TUIConfig;

  constructor(config: TUIConfig = {}) {
    this.config = config;
  }

  /**
   * Start the TUI application
   */
  public async start(): Promise<void> {
    try {
      // Show welcome screen (uses blessed which puts terminal in raw mode)
      const welcome = await showWelcomeScreen();

      // CRITICAL: Reset terminal after blessed closes
      // blessed raw mode can leave terminal in bad state causing doubled characters
      resetTerminalState();

      // Small delay to let terminal settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      switch (welcome.action) {
        case 'migrate':
          await this.runMigration();
          break;

        case 'generate':
          await this.runGenerate();
          break;

        case 'introspect':
          await this.runIntrospect();
          break;

        case 'help':
          this.showHelp();
          break;

        case 'quit':
          this.quit();
          break;
      }
    } catch (error) {
      console.error(chalk.red('Error:'), (error as Error).message);
      process.exit(1);
    }
  }

  /**
   * Run the migration flow
   */
  private async runMigration(): Promise<void> {
    console.clear();
    printLogo(); // Auto-responsive
    console.log();
    console.log(sunsetGradient('  Migration Mode'));
    console.log();

    // Step 1: Select migration mode (using number-based selection for Windows compatibility)
    console.log(chalk.cyan('What would you like to do?'));
    console.log();

    const migrationMode = await selectFromList<
      'schema-and-data' | 'schema-only' | 'data-only'
    >('', [
      {
        name: 'Schema + Data - Generate Convex schema AND migrate all data',
        value: 'schema-and-data',
      },
      {
        name: 'Schema Only - Generate Convex schema, queries, mutations (no data)',
        value: 'schema-only',
      },
      {
        name: 'Data Only - Migrate data to existing Convex schema',
        value: 'data-only',
      },
    ]);

    this.config.mode = migrationMode;

    // Step 2: Get database connection
    console.log();
    console.log(chalk.cyan('━'.repeat(50)));
    console.log(chalk.cyan.bold('  Step 1: Source Database Connection'));
    console.log(chalk.cyan('━'.repeat(50)));
    console.log();

    const connectionString = await this.promptForConnection();

    console.log();
    console.log(chalk.cyan('⏳ Connecting to database...'));

    // Parse and connect
    const config = parseConnectionString(connectionString);
    const adapter = createAdapter(config);

    try {
      await adapter.connect();
      console.log(chalk.green('✓ Connected to database'));
    } catch (error) {
      const err = error as Error;
      console.log(chalk.red('✗ Failed to connect'));
      console.log(chalk.red(`  Error: ${err.message}`));
      if (err.message.includes('ENOTFOUND')) {
        console.log(chalk.yellow('  Hint: Check that the hostname is correct'));
      } else if (err.message.includes('ECONNREFUSED')) {
        console.log(chalk.yellow('  Hint: Database server may not be running'));
      } else if (err.message.includes('authentication')) {
        console.log(chalk.yellow('  Hint: Check username and password'));
      } else if (err.message.includes('SSL') || err.message.includes('ssl')) {
        console.log(
          chalk.yellow(
            '  Hint: Try adding ?sslmode=require to your connection string'
          )
        );
      }
      console.log();
      console.log(
        chalk.dim(
          `  Connection string received: ${connectionString.substring(0, 50)}...`
        )
      );
      console.log('\nPress any key to return...');
      await this.waitForKey();
      await this.start();
      return;
    }

    // Step 3: Introspect schema
    console.log(chalk.cyan('⏳ Introspecting schema...'));

    const schemas = await adapter.getSchemas();
    const targetSchema = schemas.includes('public')
      ? 'public'
      : schemas[0] || 'main';
    const tableNames = await adapter.getTables(targetSchema);

    // Build table info for selector
    const tableInfos: TableSelectorInfo[] = [];
    for (const tableName of tableNames) {
      const columns = await adapter.getColumns(targetSchema, tableName);
      const foreignKeys = await adapter.getForeignKeys(targetSchema, tableName);
      const primaryKeys = await adapter.getPrimaryKeys(targetSchema, tableName);
      const rowCount = await adapter.getTableRowCount(targetSchema, tableName);

      tableInfos.push({
        name: tableName,
        schema: targetSchema,
        rowCount,
        columnCount: columns.length,
        hasPrimaryKey: primaryKeys.length > 0,
        foreignKeyCount: foreignKeys.length,
      });
    }

    console.log(chalk.green(`✓ Found ${tableInfos.length} tables`));
    console.log();

    // Step 4: Table selection (using simple readline instead of blessed to avoid Windows crashes)
    console.log(chalk.cyan('━'.repeat(50)));
    console.log(chalk.cyan.bold('  Step 2: Select Tables to Migrate'));
    console.log(chalk.cyan('━'.repeat(50)));
    console.log();

    // Show table list with row counts
    const tableChoices = tableInfos.map((t) => ({
      name: `${t.name} (${t.rowCount.toLocaleString()} rows, ${t.columnCount} cols)`,
      value: t.name,
      checked: true,
    }));

    const selectedTables = await multiSelectFromList<string>(
      'Enter table numbers to migrate (e.g., 1,2,3 or "all"):',
      tableChoices
    );

    if (selectedTables.length === 0) {
      console.log(chalk.yellow('\nNo tables selected. Migration cancelled.\n'));
      await adapter.disconnect();
      process.exit(0);
    }

    console.log(chalk.green(`\n✓ Selected ${selectedTables.length} tables\n`));

    const selection = {
      confirmed: true,
      selectedTables,
    };

    // Step 5: Convex authentication (if doing data migration)
    let convexUrl = '';
    let convexKey = '';

    if (migrationMode !== 'schema-only') {
      console.log();
      console.log(chalk.cyan('━'.repeat(50)));
      console.log(chalk.cyan.bold('  Step 2: Convex Authentication'));
      console.log(chalk.cyan('━'.repeat(50)));
      console.log();

      const convexCreds = await this.getConvexCredentials();
      if (!convexCreds) {
        console.log(
          chalk.yellow('\nConvex authentication skipped. Doing schema-only.')
        );
        this.config.mode = 'schema-only';
      } else {
        convexUrl = convexCreds.url;
        convexKey = convexCreds.deployKey;
      }
    }

    // Step 6: Output directory
    const outputDir = await textInput(
      'Output directory for generated Convex files',
      './convex'
    );

    // Run migration with simple console output (blessed dashboard crashes on Windows)
    await this.runSimpleMigration({
      adapter,
      schema: targetSchema,
      selectedTables: selection.selectedTables,
      tableInfos,
      outputDir,
      convexUrl,
      convexKey,
      mode: this.config.mode || 'schema-only',
    });

    await adapter.disconnect();
  }

  /**
   * Simple migration without blessed dashboard
   */
  private async runSimpleMigration(options: {
    adapter: Awaited<ReturnType<typeof createAdapter>>;
    schema: string;
    selectedTables: string[];
    tableInfos: TableSelectorInfo[];
    outputDir: string;
    convexUrl: string;
    convexKey: string;
    mode: string;
  }): Promise<void> {
    const { adapter, schema, selectedTables, outputDir, mode } = options;

    console.log();
    console.log(chalk.cyan('━'.repeat(50)));
    console.log(chalk.cyan.bold('  Step 3: Generating Convex Code'));
    console.log(chalk.cyan('━'.repeat(50)));
    console.log();

    console.log(chalk.cyan('⏳ Generating schema and functions...'));

    // Build full table info for generator
    const fullTables = [];
    for (const tableName of selectedTables) {
      process.stdout.write(chalk.dim(`  Introspecting ${tableName}...`));
      const columns = await adapter.getColumns(schema, tableName);
      const primaryKeys = await adapter.getPrimaryKeys(schema, tableName);
      const foreignKeys = await adapter.getForeignKeys(schema, tableName);
      const indexes = await adapter.getIndexes(schema, tableName);

      fullTables.push({
        tableName,
        schemaName: schema,
        tableType: 'BASE TABLE' as const,
        columns,
        primaryKeys,
        foreignKeys,
        indexes,
        checkConstraints: [],
        description: null,
        convexTableName: tableName,
      });
      console.log(chalk.green(' ✓'));
    }

    // Generate code
    console.log();
    console.log(chalk.cyan('⏳ Writing Convex files...'));

    const generator = new ConvexFunctionGenerator({
      outputDir,
      generateValidators: true,
      generateQueries: true,
      generateMutations: true,
      generateTypes: true,
      generateActions: true,
      generateHttpActions: true,
    });

    const result = generator.generate(fullTables);
    await generator.writeToFileSystem(result);

    // Count generated files
    let filesWritten = 2; // schema.ts + index.ts
    for (const [tableName, files] of result.tables) {
      const fileCount = Object.values(files).filter(Boolean).length;
      filesWritten += fileCount;
      console.log(chalk.dim(`  → ${tableName}/ (${fileCount} files)`));
    }

    console.log();
    console.log(chalk.green('━'.repeat(50)));
    console.log(chalk.green.bold('  ✓ Migration Complete!'));
    console.log(chalk.green('━'.repeat(50)));
    console.log();
    console.log(chalk.white(`  Tables processed: ${selectedTables.length}`));
    console.log(chalk.white(`  Files generated:  ${filesWritten}`));
    console.log(chalk.white(`  Output directory: ${outputDir}`));
    console.log();

    if (mode === 'schema-only') {
      console.log(chalk.yellow('  Mode: Schema only (no data migration)'));
      console.log();
    }

    console.log(chalk.cyan('  Next steps:'));
    console.log(chalk.dim('    1. Review the generated code in ' + outputDir));
    console.log(chalk.dim('    2. Copy files to your Convex project'));
    console.log(chalk.dim('    3. Run: npx convex deploy'));
    console.log();
  }

  /**
   * Get Convex credentials using the smart auth flow
   */
  private async getConvexCredentials(): Promise<{
    url: string;
    deployKey: string;
  } | null> {
    // Check for existing credentials first
    let existing: Awaited<ReturnType<typeof detectExistingCredentials>> | null =
      null;
    try {
      existing = await detectExistingCredentials();
    } catch (err) {
      console.log(chalk.dim('  (No existing credentials found)'));
    }

    if (existing?.credentials?.deployKey) {
      console.log(chalk.green('✓') + ' Found existing Convex credentials');
      console.log(chalk.dim(`  Source: ${existing.source}`));
      console.log(chalk.dim(`  URL: ${existing.credentials.deploymentUrl}`));
      console.log();

      const useExisting = await confirm(
        'Use these existing credentials?',
        true
      );

      if (useExisting) {
        // Validate them
        console.log(chalk.cyan('⏳ Validating credentials...'));
        const validation = await validateCredentials(existing.credentials);
        if (validation.valid) {
          console.log(chalk.green('✓ Credentials are valid'));
          return {
            url: existing.credentials.deploymentUrl,
            deployKey: existing.credentials.deployKey,
          };
        } else {
          console.log(chalk.red('✗ Credentials invalid: ' + validation.error));
        }
      }
    }

    // No existing credentials, offer auth methods
    console.log(chalk.cyan('🔐 Convex Authentication'));
    console.log(chalk.dim('   You need Convex credentials to migrate data.'));
    console.log();

    console.log(chalk.cyan('How would you like to authenticate?'));
    console.log();

    const authMethod = await selectFromList<string>('', [
      {
        name: 'Open browser (recommended) - Opens Convex dashboard in your browser',
        value: 'browser',
      },
      {
        name: 'Enter manually - Paste credentials from the dashboard',
        value: 'manual',
      },
      {
        name: 'Skip - Do schema-only migration (no data)',
        value: 'skip',
      },
    ]);

    if (authMethod === 'browser') {
      const result = await authenticateConvex({
        onStatusChange: (status: string) => console.log(status),
      });

      if (result.success && result.credentials) {
        // Save for future use
        await saveCredentials(result.credentials);
        console.log(chalk.green('✓') + ' Credentials saved to .env.local');
        return {
          url: result.credentials.deploymentUrl,
          deployKey: result.credentials.deployKey,
        };
      } else {
        console.log(chalk.red('✗ Browser auth failed: ' + result.error));
        return null;
      }
    } else if (authMethod === 'manual') {
      console.log();
      console.log(chalk.cyan('📋 Get your credentials from:'));
      console.log(
        chalk.dim(
          '   https://dashboard.convex.dev → Your Project → Settings → Deploy Keys'
        )
      );
      console.log();

      const url = await textInput(
        'Deployment URL',
        'https://your-project.convex.cloud'
      );
      const deployKey = await passwordInput('Deploy Key');

      // Validate
      console.log(chalk.cyan('⏳ Validating credentials...'));
      const validation = await validateCredentials({
        deploymentUrl: url,
        deployKey: deployKey,
      });
      const answers = { url, deployKey };

      if (validation.valid) {
        await saveCredentials({
          deploymentUrl: answers.url,
          deployKey: answers.deployKey,
        });
        console.log(chalk.green('✓') + ' Credentials validated and saved');
        return answers;
      } else {
        console.log(chalk.red('✗ Invalid credentials: ' + validation.error));
        return null;
      }
    }

    return null; // Skip
  }

  /**
   * Prompt for database connection
   * Uses Windows-compatible readline input (no raw mode issues)
   */
  private async promptForConnection(): Promise<string> {
    // Check for environment variable first
    const envConnection = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (envConnection) {
      console.log(chalk.green('✓') + ` Found DATABASE_URL in environment`);
      console.log(chalk.dim(`  ${envConnection.replace(/:[^:@]+@/, ':***@')}`));
      console.log();

      const useEnv = await confirm('Use this connection string?', true);
      if (useEnv) {
        return envConnection;
      }
    }

    console.log();
    console.log(
      chalk.cyan('How would you like to enter database credentials?')
    );
    console.log();

    // Use number-based selection (works on all terminals)
    const inputMethod = await selectFromList<string>('', [
      { name: 'Enter details separately (recommended)', value: 'separate' },
      { name: 'Paste full connection string', value: 'paste' },
      { name: 'SQLite file path', value: 'sqlite' },
    ]);

    if (inputMethod === 'sqlite') {
      const filepath = await textInput(
        'SQLite database file path',
        './database.db'
      );
      return `sqlite:///${filepath}`;
    }

    if (inputMethod === 'paste') {
      console.log();
      console.log(
        chalk.yellow(
          'Tip: If paste gets mangled, restart and choose "Enter details separately"'
        )
      );
      console.log();

      const connectionString = await textInput('Connection string');
      try {
        parseConnectionString(connectionString.trim());
        return connectionString.trim();
      } catch (err) {
        console.log(
          chalk.red(`Invalid connection string: ${(err as Error).message}`)
        );
        return this.promptForConnection(); // Retry
      }
    }

    // Separate fields (recommended - works reliably on Windows)
    console.log();
    console.log(chalk.cyan('Select database type:'));
    console.log();

    const dbType = await selectFromList<string>('', [
      { name: 'PostgreSQL', value: 'postgresql' },
      { name: 'MySQL', value: 'mysql' },
      { name: 'SQL Server', value: 'mssql' },
    ]);

    console.log();
    console.log(chalk.cyan('Enter connection details:'));
    console.log();

    const defaultPort =
      dbType === 'postgresql' ? '5432' : dbType === 'mysql' ? '3306' : '1433';

    const host = await textInput('Host', 'localhost');
    const port = await textInput('Port', defaultPort);
    const database = await textInput('Database name');
    const user = await textInput('Username');
    const password = await passwordInput('Password');
    const ssl = await confirm('Use SSL?', true);

    // Build connection string
    let connStr = `${dbType}://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
    if (ssl) {
      connStr += '?sslmode=require';
    }

    return connStr;
  }

  /**
   * Run schema generation
   */
  private async runGenerate(): Promise<void> {
    console.clear();
    printLogo(); // Auto-responsive
    console.log();
    console.log(sunsetGradient('  Schema Generation Mode'));
    console.log(
      chalk.dim(
        '  Generate Convex schema, queries, mutations from your database.'
      )
    );
    console.log();

    try {
      // Get connection string
      const connectionString = await this.promptForConnection();

      // Get output directory
      const outputDir = await textInput(
        'Output directory for generated files',
        './convex'
      );

      console.log();
      console.log(chalk.cyan('⏳ Connecting to database...'));

      // Parse and connect
      const config = parseConnectionString(connectionString);
      const sslConfig =
        typeof config.ssl === 'object'
          ? { enabled: true, ...config.ssl }
          : config.ssl || false;

      const dbConnection = new DatabaseConnection({
        host: config.host || 'localhost',
        port: config.port || 5432,
        database: config.database || '',
        username: config.user || '',
        password: config.password || '',
        ssl: sslConfig,
      });

      if (!(await dbConnection.testConnection())) {
        console.log(chalk.red('✗ Failed to connect to database'));
        console.log('\nPress any key to return...');
        await this.waitForKey();
        await this.start();
        return;
      }
      console.log(chalk.green('✓ Connected to database'));

      // Introspect schema
      console.log(chalk.cyan('⏳ Introspecting schema...'));
      const introspector = new SchemaIntrospector(dbConnection);
      const schema = await introspector.introspectSchema('public');
      console.log(chalk.green(`✓ Found ${schema.tables.length} tables`));

      // Table selection
      console.log();
      console.log(chalk.cyan('Select tables to generate code for:'));

      const tableChoices = schema.tables.map((t) => ({
        name: `${t.tableName} (${t.columns.length} columns)`,
        value: t.tableName,
        checked: true,
      }));

      const selectedTables = await multiSelectFromList<string>(
        '',
        tableChoices
      );

      if (selectedTables.length === 0) {
        console.log(
          chalk.red('No tables selected. At least one table is required.')
        );
        await this.waitForKey();
        await this.start();
        return;
      }

      const tablesToGenerate = schema.tables.filter((t) =>
        selectedTables.includes(t.tableName)
      );

      // Generate code
      console.log();
      console.log(chalk.cyan('⏳ Generating Convex code...'));

      const generator = new ConvexFunctionGenerator({
        outputDir,
        generateValidators: true,
        generateQueries: true,
        generateMutations: true,
        generateTypes: true,
        generateActions: true,
        generateHttpActions: true,
      });

      const result = generator.generate(tablesToGenerate);

      // Write files to disk
      await generator.writeToFileSystem(result);

      // Count files written
      let filesWritten = 1; // schema.ts
      filesWritten += 1; // index.ts
      for (const [tableName, files] of result.tables) {
        filesWritten += 1; // table index.ts
        if (files.queries) filesWritten++;
        if (files.mutations) filesWritten++;
        if (files.validators) filesWritten++;
        if (files.types) filesWritten++;
        if (files.actions) filesWritten++;
        if (files.httpActions) filesWritten++;
        console.log(chalk.gray(`  → ${tableName}/`));
      }
      if (result.httpFile) filesWritten++;

      // Close connection
      await dbConnection.close();

      // Success message
      console.log();
      console.log(chalk.green('═'.repeat(50)));
      console.log(chalk.green.bold('✓ Code generation complete!'));
      console.log(chalk.green('═'.repeat(50)));
      console.log();
      console.log(
        chalk.white(`  📁 Output directory: ${chalk.cyan(outputDir)}`)
      );
      console.log(
        chalk.white(`  📄 Files generated:  ${chalk.cyan(filesWritten)}`)
      );
      console.log(
        chalk.white(
          `  📊 Tables processed: ${chalk.cyan(tablesToGenerate.length)}`
        )
      );
      console.log();
      console.log(chalk.gray('Generated files include:'));
      console.log(chalk.gray('  • schema.ts      - Convex schema definitions'));
      console.log(chalk.gray('  • validators.ts  - Zod-like validators'));
      console.log(chalk.gray('  • queries/       - Query functions'));
      console.log(chalk.gray('  • mutations/     - Mutation functions'));
      console.log(chalk.gray('  • actions/       - Action functions'));
      console.log(chalk.gray('  • http/          - HTTP action endpoints'));
      console.log();
      console.log(chalk.yellow('Next steps:'));
      console.log(chalk.gray('  1. Review the generated code'));
      console.log(chalk.gray('  2. Copy files to your Convex project'));
      console.log(chalk.gray('  3. Run `npx convex deploy` to deploy'));
      console.log();

      // Auto-detect tsconfig and offer typecheck
      const detectedTsConfig = await findTsConfig(outputDir);

      if (detectedTsConfig) {
        console.log(
          chalk.cyan(`📋 Found tsconfig: ${chalk.gray(detectedTsConfig)}`)
        );
        console.log();

        const runTypecheck = await confirm(
          'Would you like to typecheck the generated code?',
          true
        );

        if (runTypecheck) {
          console.log();
          console.log(chalk.cyan('⏳ Running TypeScript compiler...'));

          const typecheckResult = await typecheck(outputDir, detectedTsConfig);

          console.log();
          const resultLines = formatTypecheckResult(typecheckResult, {
            red: chalk.red,
            yellow: chalk.yellow,
            green: chalk.green,
            gray: chalk.gray,
            cyan: chalk.cyan,
            white: chalk.white,
          });

          for (const line of resultLines) {
            console.log(line);
          }
          console.log();
        }
      } else {
        console.log(
          chalk.gray('💡 Tip: Add a tsconfig.json to enable type checking')
        );
        console.log();
      }
    } catch (error) {
      console.log();
      console.log(chalk.red('✗ Error: ' + (error as Error).message));
    }

    console.log('Press any key to return to menu...');
    await this.waitForKey();
    await this.start();
  }

  /**
   * Run database introspection
   */
  private async runIntrospect(): Promise<void> {
    console.clear();
    printLogo(); // Auto-responsive
    console.log();
    console.log(sunsetGradient('  Database Introspection Mode'));
    console.log(
      chalk.dim('  Explore your database structure before migration.')
    );
    console.log();

    try {
      // Get connection string
      const connectionString = await this.promptForConnection();

      console.log();
      console.log(chalk.cyan('⏳ Connecting to database...'));

      // Parse and connect
      const config = parseConnectionString(connectionString);
      const sslConfig =
        typeof config.ssl === 'object'
          ? { enabled: true, ...config.ssl }
          : config.ssl || false;

      const dbConnection = new DatabaseConnection({
        host: config.host || 'localhost',
        port: config.port || 5432,
        database: config.database || '',
        username: config.user || '',
        password: config.password || '',
        ssl: sslConfig,
      });

      if (!(await dbConnection.testConnection())) {
        console.log(chalk.red('✗ Failed to connect to database'));
        console.log('\nPress any key to return...');
        await this.waitForKey();
        await this.start();
        return;
      }
      console.log(chalk.green('✓ Connected to database\n'));

      // Introspect schema
      console.log(chalk.cyan('⏳ Introspecting schema...'));
      const introspector = new SchemaIntrospector(dbConnection);
      const schema = await introspector.introspectSchema('public');

      // Close connection
      await dbConnection.close();

      // Display results
      console.clear();
      printLogo();
      console.log();
      console.log(sunsetGradient('  Database Schema Analysis'));
      console.log();

      // Summary box - responsive width
      const totalColumns = schema.tables.reduce(
        (sum, t) => sum + t.columns.length,
        0
      );
      const totalFKs = schema.tables.reduce(
        (sum, t) => sum + t.foreignKeys.length,
        0
      );
      const totalIndexes = schema.tables.reduce(
        (sum, t) => sum + t.indexes.length,
        0
      );

      const boxWidth = Math.min(60, getTerminalWidth() - 4);
      const innerWidth = boxWidth - 2; // Account for │ borders

      console.log(chalk.cyan('┌' + '─'.repeat(innerWidth) + '┐'));
      console.log(
        chalk.cyan('│') +
          padEnd(chalk.white.bold('  DATABASE SUMMARY'), innerWidth) +
          chalk.cyan('│')
      );
      console.log(chalk.cyan('├' + '─'.repeat(innerWidth) + '┤'));
      console.log(
        chalk.cyan('│') +
          padEnd(
            `  Database:     ${chalk.yellow(config.database || 'N/A')}`,
            innerWidth
          ) +
          chalk.cyan('│')
      );
      console.log(
        chalk.cyan('│') +
          padEnd(
            `  Host:         ${chalk.gray((config.host || 'localhost') + ':' + (config.port || 5432))}`,
            innerWidth
          ) +
          chalk.cyan('│')
      );
      console.log(
        chalk.cyan('│') +
          padEnd(
            `  Tables:       ${chalk.green(schema.tables.length.toString())}`,
            innerWidth
          ) +
          chalk.cyan('│')
      );
      console.log(
        chalk.cyan('│') +
          padEnd(
            `  Columns:      ${chalk.green(totalColumns.toString())}`,
            innerWidth
          ) +
          chalk.cyan('│')
      );
      console.log(
        chalk.cyan('│') +
          padEnd(
            `  Foreign Keys: ${chalk.green(totalFKs.toString())}`,
            innerWidth
          ) +
          chalk.cyan('│')
      );
      console.log(
        chalk.cyan('│') +
          padEnd(
            `  Indexes:      ${chalk.green(totalIndexes.toString())}`,
            innerWidth
          ) +
          chalk.cyan('│')
      );
      console.log(chalk.cyan('└' + '─'.repeat(innerWidth) + '┘'));
      console.log();

      // Table details - with proper column alignment
      console.log(chalk.white.bold('TABLE DETAILS:\n'));

      // Column widths
      const COL_NAME = 22;
      const COL_TYPE = 16;
      const COL_NULL = 10;
      const TABLE_WIDTH = COL_NAME + COL_TYPE + COL_NULL + 4; // +4 for borders

      for (const table of schema.tables) {
        const fkCount = table.foreignKeys.length;

        // Table header
        console.log(chalk.yellow.bold(`📋 ${table.tableName}`));
        console.log(
          chalk.gray(
            `   Schema: ${table.schemaName} | Columns: ${table.columns.length} | FKs: ${fkCount}`
          )
        );
        console.log();

        // Columns table
        console.log(
          chalk.gray(
            '   ┌' +
              '─'.repeat(COL_NAME) +
              '┬' +
              '─'.repeat(COL_TYPE) +
              '┬' +
              '─'.repeat(COL_NULL) +
              '┐'
          )
        );
        console.log(
          chalk.gray('   │') +
            padEnd(chalk.white(' Column'), COL_NAME) +
            chalk.gray('│') +
            padEnd(chalk.white(' Type'), COL_TYPE) +
            chalk.gray('│') +
            padEnd(chalk.white(' Null'), COL_NULL) +
            chalk.gray('│')
        );
        console.log(
          chalk.gray(
            '   ├' +
              '─'.repeat(COL_NAME) +
              '┼' +
              '─'.repeat(COL_TYPE) +
              '┼' +
              '─'.repeat(COL_NULL) +
              '┤'
          )
        );

        for (const col of table.columns.slice(0, 10)) {
          // Show first 10 columns
          // Build column name with markers (no emojis in table for alignment)
          const isPK = col.isPrimaryKey;
          const isFK = table.foreignKeys.some(
            (fk) => fk.columnName === col.columnName
          );
          let colName = ' ' + col.columnName.slice(0, COL_NAME - 6);
          if (isPK) colName += chalk.yellow(' PK');
          if (isFK) colName += chalk.blue(' FK');

          const colType = ' ' + col.dataType.slice(0, COL_TYPE - 2);
          const nullable = col.isNullable
            ? chalk.green(' YES')
            : chalk.red(' NO');

          console.log(
            chalk.gray('   │') +
              padEnd(colName, COL_NAME) +
              chalk.gray('│') +
              padEnd(colType, COL_TYPE) +
              chalk.gray('│') +
              padEnd(nullable, COL_NULL) +
              chalk.gray('│')
          );
        }

        if (table.columns.length > 10) {
          const moreText = ` ... and ${table.columns.length - 10} more columns`;
          console.log(
            chalk.gray('   │') +
              padEnd(chalk.gray(moreText), TABLE_WIDTH) +
              chalk.gray('│')
          );
        }

        console.log(
          chalk.gray(
            '   └' +
              '─'.repeat(COL_NAME) +
              '┴' +
              '─'.repeat(COL_TYPE) +
              '┴' +
              '─'.repeat(COL_NULL) +
              '┘'
          )
        );

        // Foreign keys
        if (fkCount > 0) {
          console.log(chalk.blue('   Foreign Keys:'));
          for (const fk of table.foreignKeys) {
            console.log(
              chalk.gray(
                `     → ${fk.columnName} → ${fk.referencedTable}.${fk.referencedColumn}`
              )
            );
          }
        }

        console.log();
      }

      // Legend
      console.log(chalk.gray('Legend: PK = Primary Key, FK = Foreign Key'));
      console.log();
    } catch (error) {
      console.log();
      console.log(chalk.red('✗ Error: ' + (error as Error).message));
    }

    console.log('Press any key to return to menu...');
    await this.waitForKey();
    await this.start();
  }

  /**
   * Show help information (responsive layout)
   */
  private showHelp(): void {
    console.clear();
    printLogo(); // Auto-selects based on terminal width

    console.log();
    console.log(sunsetGradient('  SunSetter AQM+ Help'));
    console.log(
      chalk.dim(
        '  ' + '─'.repeat(Math.min(40, process.stdout.columns - 4 || 40))
      )
    );
    console.log();

    console.log(chalk.white('  Database to Convex migration tool.'));
    console.log(chalk.dim('  AQM = Actions, Queries, Mutations'));
    console.log();

    console.log(chalk.cyan('  Supported Databases:'));
    console.log(chalk.dim('    PostgreSQL, MySQL, SQLite, SQL Server'));
    console.log();

    console.log(chalk.cyan('  Migration Modes:'));
    console.log(
      chalk.white('    1. Schema Only    ') + chalk.dim('Generate Convex files')
    );
    console.log(
      chalk.white('    2. Schema + Data  ') + chalk.dim('Full migration')
    );
    console.log(
      chalk.white('    3. Data Only      ') + chalk.dim('To existing schema')
    );
    console.log();

    console.log(chalk.cyan('  Features:'));
    console.log(chalk.dim('    - Auto type mapping'));
    console.log(chalk.dim('    - FK relationship detection'));
    console.log(chalk.dim('    - Batch processing'));
    console.log(chalk.dim('    - Resume/rollback support'));
    console.log();

    console.log(chalk.cyan('  CLI Usage:'));
    console.log(chalk.dim('    sunsetter-aqm --tui'));
    console.log(chalk.dim('    sunsetter-aqm migrate -c "postgres://..."'));
    console.log(chalk.dim('    sunsetter-aqm --help'));
    console.log();

    console.log(chalk.dim('  Press any key to return...'));
    this.waitForKey().then(() => this.start());
  }

  /**
   * Quit the application
   */
  private quit(): void {
    console.clear();
    console.log();
    console.log(sunsetGradient(`  Thanks for using ${APP_NAME}!`));
    console.log();
    console.log(chalk.dim('  May your migrations be swift and error-free.'));
    console.log();
    process.exit(0);
  }

  /**
   * Sleep for a duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Wait for any key press
   */
  private waitForKey(): Promise<void> {
    return new Promise((resolve) => {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdin.setRawMode(false);
        resolve();
      });
    });
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Launch the TUI application
 */
export async function launchTUI(config?: TUIConfig): Promise<void> {
  const app = new TUIApp(config);
  await app.start();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  launchTUI().catch(console.error);
}
