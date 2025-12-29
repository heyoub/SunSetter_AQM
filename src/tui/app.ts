#!/usr/bin/env node
/**
 * SunSetter AQM+ TUI Application
 *
 * Main entry point for the Terminal User Interface mode.
 * Launch with: sunsetter-aqm --tui or sunsetter-aqm -i
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { printLogo, sunsetGradient, APP_NAME } from './branding.js';
import { showWelcomeScreen } from './screens/welcome.js';
import {
  showTableSelector,
  TableInfo as TableSelectorInfo,
} from './screens/table-selector.js';
import { createDashboard, Dashboard, TableStatus } from './dashboard.js';
import { parseConnectionString } from '../adapters/index.js';
import { SchemaIntrospector } from '../introspector/schema-introspector.js';
import { DatabaseConnection } from '../config/database.js';
import { ConvexFunctionGenerator } from '../generator/convex/index.js';
import {
  findTsConfig,
  typecheck,
  formatTypecheckResult,
} from '../utils/typecheck.js';

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
  private dashboard: Dashboard | null = null;

  constructor(config: TUIConfig = {}) {
    this.config = config;
  }

  /**
   * Start the TUI application
   */
  public async start(): Promise<void> {
    try {
      // Show welcome screen
      const welcome = await showWelcomeScreen();

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
    // For now, show a demo with mock data
    // In production, this would connect to the actual database

    console.clear();
    printLogo('neon');
    console.log(sunsetGradient('\nPreparing migration...\n'));

    // Demo: Mock tables
    const mockTables: TableSelectorInfo[] = [
      {
        name: 'users',
        schema: 'public',
        rowCount: 15000,
        columnCount: 12,
        hasPrimaryKey: true,
        foreignKeyCount: 0,
      },
      {
        name: 'posts',
        schema: 'public',
        rowCount: 50000,
        columnCount: 8,
        hasPrimaryKey: true,
        foreignKeyCount: 2,
      },
      {
        name: 'comments',
        schema: 'public',
        rowCount: 120000,
        columnCount: 6,
        hasPrimaryKey: true,
        foreignKeyCount: 2,
      },
      {
        name: 'likes',
        schema: 'public',
        rowCount: 500000,
        columnCount: 4,
        hasPrimaryKey: true,
        foreignKeyCount: 2,
      },
      {
        name: 'tags',
        schema: 'public',
        rowCount: 200,
        columnCount: 3,
        hasPrimaryKey: true,
        foreignKeyCount: 0,
      },
      {
        name: 'post_tags',
        schema: 'public',
        rowCount: 75000,
        columnCount: 3,
        hasPrimaryKey: true,
        foreignKeyCount: 2,
      },
      {
        name: 'settings',
        schema: 'public',
        rowCount: 15000,
        columnCount: 5,
        hasPrimaryKey: true,
        foreignKeyCount: 1,
      },
      {
        name: 'sessions',
        schema: 'public',
        rowCount: 8000,
        columnCount: 7,
        hasPrimaryKey: true,
        foreignKeyCount: 1,
      },
    ];

    // Show table selector
    const selection = await showTableSelector(mockTables);

    if (!selection.confirmed || selection.selectedTables.length === 0) {
      console.log(chalk.yellow('\nMigration cancelled.\n'));
      process.exit(0);
    }

    // Create dashboard
    this.dashboard = createDashboard({
      sourceDb: 'PostgreSQL',
      targetDb: 'Convex',
      mode: 'schema-and-data',
      tables: selection.selectedTables,
    });

    // Demo: Simulate migration progress
    await this.simulateMigration(selection.selectedTables, mockTables);
  }

  /**
   * Simulate migration for demo purposes
   */
  private async simulateMigration(
    selectedTables: string[],
    allTables: TableSelectorInfo[]
  ): Promise<void> {
    if (!this.dashboard) return;

    const tableMap = new Map(allTables.map((t) => [t.name, t]));
    const totalRows = selectedTables
      .map((name) => tableMap.get(name)?.rowCount || 0)
      .reduce((a, b) => a + b, 0);

    let migratedRows = 0;
    let completedTables = 0;
    const startTime = Date.now();

    const tableStatuses: TableStatus[] = selectedTables.map((name) => ({
      name,
      status: 'pending' as const,
      totalRows: tableMap.get(name)?.rowCount || 0,
      migratedRows: 0,
      errorCount: 0,
      duration: 0,
    }));

    this.dashboard.updateTables(tableStatuses);

    // Process each table
    for (let i = 0; i < selectedTables.length; i++) {
      const tableName = selectedTables[i];
      const tableInfo = tableMap.get(tableName)!;

      // Start table
      tableStatuses[i].status = 'migrating';
      this.dashboard.updateTables(tableStatuses);
      this.dashboard.log(`Starting migration of ${tableName}...`, 'info');

      const tableStartTime = Date.now();
      let tableRows = 0;

      // Simulate batches
      const batchSize = 1000;
      const batches = Math.ceil(tableInfo.rowCount / batchSize);

      for (let b = 0; b < batches; b++) {
        const rowsThisBatch = Math.min(
          batchSize,
          tableInfo.rowCount - tableRows
        );

        // Simulate processing time (faster for demo)
        await this.sleep(50 + Math.random() * 100);

        tableRows += rowsThisBatch;
        migratedRows += rowsThisBatch;

        tableStatuses[i].migratedRows = tableRows;

        const elapsedTime = (Date.now() - startTime) / 1000;
        const rowsPerSecond = migratedRows / elapsedTime;
        const eta = (totalRows - migratedRows) / rowsPerSecond;

        this.dashboard.updateStats({
          totalTables: selectedTables.length,
          completedTables,
          totalRows,
          migratedRows,
          failedRows: 0,
          rowsPerSecond,
          memoryUsage: process.memoryUsage().heapUsed,
          elapsedTime,
          eta,
        });

        this.dashboard.updateTables(tableStatuses);
      }

      // Complete table
      tableStatuses[i].status = 'completed';
      tableStatuses[i].duration = (Date.now() - tableStartTime) / 1000;
      completedTables++;

      this.dashboard.log(
        `Completed ${tableName} (${tableInfo.rowCount.toLocaleString()} rows)`,
        'success'
      );
      this.dashboard.updateTables(tableStatuses);
    }

    // Show completion
    const totalTime = (Date.now() - startTime) / 1000;
    this.dashboard.updateStats({
      totalTables: selectedTables.length,
      completedTables: selectedTables.length,
      totalRows,
      migratedRows: totalRows,
      failedRows: 0,
      rowsPerSecond: totalRows / totalTime,
      memoryUsage: process.memoryUsage().heapUsed,
      elapsedTime: totalTime,
      eta: 0,
    });

    this.dashboard.log(
      `Migration complete! ${totalRows.toLocaleString()} rows in ${totalTime.toFixed(1)}s`,
      'success'
    );

    // Wait a bit then show completion screen
    await this.sleep(2000);
    this.dashboard.showComplete(true);
  }

  /**
   * Prompt for database connection string
   */
  private async promptForConnection(): Promise<string> {
    const { connectionString } = await inquirer.prompt([
      {
        type: 'input',
        name: 'connectionString',
        message: 'Enter database connection string:',
        default:
          process.env.DATABASE_URL ||
          'postgresql://user:pass@localhost:5432/mydb',
        validate: (input: string) => {
          if (!input.trim()) return 'Connection string is required';
          try {
            parseConnectionString(input);
            return true;
          } catch {
            return 'Invalid connection string format. Examples:\n  postgresql://user:pass@localhost:5432/db\n  mysql://user:pass@localhost:3306/db\n  sqlite://./mydb.sqlite';
          }
        },
      },
    ]);
    return connectionString;
  }

  /**
   * Run schema generation
   */
  private async runGenerate(): Promise<void> {
    console.clear();
    printLogo('neon');
    console.log(sunsetGradient('\n☀️  Schema Generation Mode\n'));
    console.log(
      chalk.gray(
        'Generate Convex schema, queries, mutations, and actions from your database.\n'
      )
    );

    try {
      // Get connection string
      const connectionString = await this.promptForConnection();

      // Get output directory
      const { outputDir } = await inquirer.prompt([
        {
          type: 'input',
          name: 'outputDir',
          message: 'Output directory for generated files:',
          default: './convex',
        },
      ]);

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
      const tableChoices = schema.tables.map((t) => ({
        name: `${t.tableName} (${t.columns.length} columns)`,
        value: t.tableName,
        checked: true,
      }));

      const { selectedTables } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedTables',
          message: 'Select tables to generate code for:',
          choices: tableChoices,
          validate: (input: string[]) =>
            input.length > 0 || 'Select at least one table',
        },
      ]);

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

        const { runTypecheck } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'runTypecheck',
            message: 'Would you like to typecheck the generated code?',
            default: true,
          },
        ]);

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
    printLogo('neon');
    console.log(sunsetGradient('\n🔍 Database Introspection Mode\n'));
    console.log(
      chalk.gray('Explore your database structure before migration.\n')
    );

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
      printLogo('minimal');
      console.log(sunsetGradient('\n📊 Database Schema Analysis\n'));

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
   * Show help information
   */
  private showHelp(): void {
    console.clear();
    printLogo('sunset');

    console.log(
      sunsetGradient(`
╔════════════════════════════════════════════════════════════════╗
║                    SunSetter AQM+ Help                         ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  SunSetter AQM+ is a database migration tool that converts     ║
║  your existing SQL databases to Convex.                        ║
║                                                                ║
║  AQM = Actions, Queries, Mutations                             ║
║                                                                ║
║  SUPPORTED DATABASES:                                          ║
║    • PostgreSQL                                                ║
║    • MySQL / MariaDB                                           ║
║    • SQLite                                                    ║
║    • SQL Server                                                ║
║                                                                ║
║  MIGRATION MODES:                                              ║
║    • schema-only      Generate Convex schema files             ║
║    • schema-and-data  Migrate schema and all data              ║
║    • data-only        Migrate data to existing schema          ║
║                                                                ║
║  FEATURES:                                                     ║
║    • Automatic type mapping                                    ║
║    • Foreign key relationship detection                        ║
║    • Batch processing with rate limiting                       ║
║    • Resume interrupted migrations                             ║
║    • Rollback support                                          ║
║    • Parallel table migration                                  ║
║                                                                ║
║  CLI USAGE:                                                    ║
║    $ sunsetter-aqm migrate -c "postgresql://..."               ║
║    $ sunsetter-aqm --tui           (Launch TUI mode)           ║
║    $ sunsetter-aqm --help          (Show CLI help)             ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`)
    );

    console.log('\nPress any key to return...');
    this.waitForKey().then(() => this.start());
  }

  /**
   * Quit the application
   */
  private quit(): void {
    console.clear();
    console.log(
      sunsetGradient(`
  Thanks for using ${APP_NAME}!

  ☀️  May your migrations be swift and error-free.

`)
    );
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
