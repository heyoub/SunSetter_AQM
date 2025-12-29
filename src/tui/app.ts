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
import {
  showTableSelector,
  TableInfo as TableSelectorInfo,
} from './screens/table-selector.js';
import { createDashboard, Dashboard, TableStatus } from './dashboard.js';

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
   * Run schema generation
   */
  private async runGenerate(): Promise<void> {
    console.clear();
    printLogo('minimal');
    console.log(sunsetGradient('\nSchema Generation Mode\n'));
    console.log(
      chalk.gray(
        'Coming soon! This will generate Convex schema without migrating data.\n'
      )
    );
    console.log('Press any key to return...');

    await this.waitForKey();
    await this.start();
  }

  /**
   * Run database introspection
   */
  private async runIntrospect(): Promise<void> {
    console.clear();
    printLogo('minimal');
    console.log(sunsetGradient('\nDatabase Introspection Mode\n'));
    console.log(
      chalk.gray('Coming soon! This will show detailed database structure.\n')
    );
    console.log('Press any key to return...');

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
╔══════════════════════════════════════════════════════════════╗
║                     ${APP_NAME} Help                           ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  ${APP_NAME} is a database migration tool that converts       ║
║  your existing SQL databases to Convex.                      ║
║                                                              ║
║  AQM = Actions, Queries, Mutations                           ║
║                                                              ║
║  SUPPORTED DATABASES:                                        ║
║  • PostgreSQL                                                ║
║  • MySQL / MariaDB                                           ║
║  • SQLite                                                    ║
║  • SQL Server                                                ║
║                                                              ║
║  MIGRATION MODES:                                            ║
║  • schema-only     Generate Convex schema files              ║
║  • schema-and-data Migrate schema and all data               ║
║  • data-only       Migrate data to existing schema           ║
║                                                              ║
║  FEATURES:                                                   ║
║  • Automatic type mapping                                    ║
║  • Foreign key relationship detection                        ║
║  • Batch processing with rate limiting                       ║
║  • Resume interrupted migrations                             ║
║  • Rollback support                                          ║
║  • Parallel table migration                                  ║
║                                                              ║
║  CLI USAGE:                                                  ║
║  $ sunsetter-aqm migrate -c "postgresql://..." -m schema-and-data  ║
║  $ sunsetter-aqm --tui                # Launch TUI mode      ║
║  $ sunsetter-aqm --help               # Show CLI help        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
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
