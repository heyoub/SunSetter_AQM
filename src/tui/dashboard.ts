/**
 * SunSetter AQM+ Dashboard
 *
 * Full-screen TUI dashboard for database migration monitoring.
 * Built with blessed-contrib for rich terminal widgets.
 */

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import {
  APP_NAME,
  APP_TAGLINE,
  VERSION,
  formatNumber,
  formatDuration,
  formatBytes,
  SPINNER_FRAMES,
} from './branding.js';

// ============================================================================
// Types
// ============================================================================

export interface TableStatus {
  name: string;
  status: 'pending' | 'migrating' | 'completed' | 'error';
  totalRows: number;
  migratedRows: number;
  errorCount: number;
  duration: number;
}

export interface MigrationStats {
  totalTables: number;
  completedTables: number;
  totalRows: number;
  migratedRows: number;
  failedRows: number;
  rowsPerSecond: number;
  memoryUsage: number;
  elapsedTime: number;
  eta: number;
}

export interface DashboardConfig {
  sourceDb: string;
  targetDb: string;
  mode: string;
  tables: string[];
}

// ============================================================================
// Dashboard Class
// ============================================================================

export class Dashboard {
  private screen: blessed.Widgets.Screen;
  private grid: any;
  private widgets: {
    logo: blessed.Widgets.BoxElement;
    stats: any;
    progress: any;
    tableList: any;
    throughputChart: any;
    log: any;
    statusBar: blessed.Widgets.BoxElement;
  };
  private spinnerIndex = 0;
  private spinnerInterval: NodeJS.Timeout | null = null;
  private throughputHistory: number[] = [];
  private config: DashboardConfig;
  private stats: MigrationStats;
  private tables: TableStatus[] = [];

  constructor(config: DashboardConfig) {
    this.config = config;
    this.stats = {
      totalTables: config.tables.length,
      completedTables: 0,
      totalRows: 0,
      migratedRows: 0,
      failedRows: 0,
      rowsPerSecond: 0,
      memoryUsage: 0,
      elapsedTime: 0,
      eta: 0,
    };

    // Initialize screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: `${APP_NAME} v${VERSION}`,
      fullUnicode: true,
    });

    // Create grid layout
    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen,
    });

    // Initialize widgets
    this.widgets = this.createWidgets();

    // Setup key handlers
    this.setupKeyHandlers();

    // Start spinner animation
    this.startSpinner();
  }

  /**
   * Create all dashboard widgets
   */
  private createWidgets() {
    // Logo/Header (top-left)
    const logo = this.grid.set(0, 0, 2, 4, blessed.box, {
      content: this.getLogoContent(),
      tags: true,
      style: {
        fg: 'white',
        border: { fg: '#FF6B35' },
      },
      border: { type: 'line' },
    });

    // Stats panel (top-middle)
    const stats = this.grid.set(0, 4, 2, 4, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: '#FF6B35',
      interactive: false,
      label: ' Migration Stats ',
      width: '100%',
      height: '100%',
      border: { type: 'line', fg: '#FF3864' },
      columnSpacing: 2,
      columnWidth: [16, 14],
    });

    // Progress gauge (top-right)
    const progress = this.grid.set(0, 8, 2, 4, contrib.gauge, {
      label: ' Overall Progress ',
      stroke: '#FF6B35',
      fill: '#FF3864',
      border: { type: 'line', fg: '#9B59B6' },
    });

    // Table list (left side)
    const tableList = this.grid.set(2, 0, 7, 4, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'black',
      selectedBg: '#FF6B35',
      interactive: true,
      label: ' Tables ',
      width: '100%',
      height: '100%',
      border: { type: 'line', fg: '#3498DB' },
      columnSpacing: 1,
      columnWidth: [20, 10, 10, 8],
    });

    // Throughput chart (middle)
    const throughputChart = this.grid.set(2, 4, 5, 8, contrib.line, {
      style: {
        line: '#FF6B35',
        text: 'white',
        baseline: '#3498DB',
      },
      xLabelPadding: 3,
      xPadding: 5,
      showLegend: true,
      wholeNumbersOnly: true,
      label: ' Throughput (rows/sec) ',
      border: { type: 'line', fg: '#9B59B6' },
    });

    // Log panel (bottom-right)
    const log = this.grid.set(7, 4, 4, 8, contrib.log, {
      fg: 'white',
      selectedFg: 'white',
      label: ' Migration Log ',
      border: { type: 'line', fg: '#3498DB' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        inverse: true,
      },
    });

    // Status bar (bottom)
    const statusBar = this.grid.set(11, 0, 1, 12, blessed.box, {
      content: this.getStatusBarContent(),
      tags: true,
      style: {
        fg: 'white',
        bg: '#1a1a2e',
      },
    });

    return {
      logo,
      stats,
      progress,
      tableList,
      throughputChart,
      log,
      statusBar,
    };
  }

  /**
   * Get logo content with gradient
   */
  private getLogoContent(): string {
    const lines = [
      '{bold}☀ SUNSETTER AQM+{/bold}',
      '{#FF6B35-fg}═══════════════════{/}',
      `{#9B59B6-fg}${APP_TAGLINE}{/}`,
      `{#3498DB-fg}v${VERSION}{/}`,
    ];
    return lines.join('\n');
  }

  /**
   * Get status bar content
   */
  private getStatusBarContent(): string {
    const spinner = SPINNER_FRAMES[this.spinnerIndex];
    const mode = this.config.mode || 'schema-and-data';
    const source = this.config.sourceDb || 'PostgreSQL';
    const memory = formatBytes(this.stats.memoryUsage);

    return `  ${spinner} ${APP_NAME}  │  Mode: {bold}${mode}{/bold}  │  Source: {bold}${source}{/bold}  │  Memory: {bold}${memory}{/bold}  │  Press {bold}q{/bold} to quit, {bold}?{/bold} for help`;
  }

  /**
   * Setup keyboard handlers
   */
  private setupKeyHandlers(): void {
    // Quit
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.stop();
      process.exit(0);
    });

    // Help
    this.screen.key(['?', 'h'], () => {
      this.showHelp();
    });

    // Focus table list
    this.screen.key(['t'], () => {
      this.widgets.tableList.focus();
    });

    // Focus log
    this.screen.key(['l'], () => {
      this.widgets.log.focus();
    });
  }

  /**
   * Show help dialog
   */
  private showHelp(): void {
    const helpBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: 15,
      content: `
{bold}${APP_NAME} - Keyboard Shortcuts{/bold}
════════════════════════════════

  {bold}q, Esc{/bold}    Quit dashboard
  {bold}?{/bold}         Show this help
  {bold}t{/bold}         Focus table list
  {bold}l{/bold}         Focus log panel
  {bold}↑/↓{/bold}       Navigate lists
  {bold}Enter{/bold}     Select item
  {bold}Tab{/bold}       Switch focus

{#666666-fg}Press any key to close{/}
      `,
      tags: true,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: '#1a1a2e',
        border: { fg: '#FF6B35' },
      },
    });

    this.screen.key(['enter', 'escape', 'space'], () => {
      helpBox.destroy();
      this.screen.render();
    });

    this.screen.render();
  }

  /**
   * Start the spinner animation
   */
  private startSpinner(): void {
    this.spinnerInterval = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
      this.widgets.statusBar.setContent(this.getStatusBarContent());
      this.screen.render();
    }, 100);
  }

  /**
   * Stop the spinner animation
   */
  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
  }

  /**
   * Update migration stats
   */
  public updateStats(stats: Partial<MigrationStats>): void {
    this.stats = { ...this.stats, ...stats };

    // Update stats table
    this.widgets.stats.setData({
      headers: ['Metric', 'Value'],
      data: [
        ['Tables', `${this.stats.completedTables}/${this.stats.totalTables}`],
        [
          'Rows',
          `${formatNumber(this.stats.migratedRows)}/${formatNumber(this.stats.totalRows)}`,
        ],
        ['Failed', formatNumber(this.stats.failedRows)],
        ['Speed', `${formatNumber(Math.round(this.stats.rowsPerSecond))}/s`],
        ['Elapsed', formatDuration(this.stats.elapsedTime)],
        ['ETA', formatDuration(this.stats.eta)],
      ],
    });

    // Update progress gauge
    const progress =
      this.stats.totalRows > 0
        ? Math.round((this.stats.migratedRows / this.stats.totalRows) * 100)
        : 0;
    this.widgets.progress.setPercent(progress);

    // Update throughput chart
    this.throughputHistory.push(this.stats.rowsPerSecond);
    if (this.throughputHistory.length > 60) {
      this.throughputHistory.shift();
    }

    this.widgets.throughputChart.setData([
      {
        title: 'rows/sec',
        x: this.throughputHistory.map((_, i) => String(i)),
        y: this.throughputHistory,
        style: { line: '#FF6B35' },
      },
    ]);

    this.screen.render();
  }

  /**
   * Update table list
   */
  public updateTables(tables: TableStatus[]): void {
    this.tables = tables;

    const data = tables.map((t) => {
      const statusIcon = {
        pending: '{#666666-fg}○{/}',
        migrating: '{#FF6B35-fg}◉{/}',
        completed: '{green-fg}✓{/}',
        error: '{red-fg}✗{/}',
      }[t.status];

      const progress =
        t.totalRows > 0 ? Math.round((t.migratedRows / t.totalRows) * 100) : 0;

      return [
        `${statusIcon} ${t.name}`,
        formatNumber(t.migratedRows),
        formatNumber(t.totalRows),
        `${progress}%`,
      ];
    });

    this.widgets.tableList.setData({
      headers: ['Table', 'Done', 'Total', 'Progress'],
      data,
    });

    this.screen.render();
  }

  /**
   * Add a log message
   */
  public log(
    message: string,
    level: 'info' | 'success' | 'warning' | 'error' = 'info'
  ): void {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = {
      info: '{#3498DB-fg}ℹ{/}',
      success: '{green-fg}✓{/}',
      warning: '{yellow-fg}⚠{/}',
      error: '{red-fg}✗{/}',
    }[level];

    this.widgets.log.log(`{#666666-fg}${timestamp}{/} ${prefix} ${message}`);
    this.screen.render();
  }

  /**
   * Start the dashboard
   */
  public start(): void {
    // Initial render
    this.updateStats(this.stats);
    this.updateTables(
      this.config.tables.map((name) => ({
        name,
        status: 'pending' as const,
        totalRows: 0,
        migratedRows: 0,
        errorCount: 0,
        duration: 0,
      }))
    );

    this.log('Dashboard started', 'info');
    this.log(
      `Migrating ${this.config.tables.length} tables from ${this.config.sourceDb}`,
      'info'
    );

    this.screen.render();
  }

  /**
   * Stop the dashboard
   */
  public stop(): void {
    this.stopSpinner();
    this.screen.destroy();
  }

  /**
   * Show completion screen
   */
  public showComplete(success: boolean): void {
    this.stopSpinner();

    const message = success
      ? `{green-fg}{bold}Migration Complete!{/bold}{/}\n\n` +
        `Tables: ${this.stats.completedTables}/${this.stats.totalTables}\n` +
        `Rows: ${formatNumber(this.stats.migratedRows)}\n` +
        `Duration: ${formatDuration(this.stats.elapsedTime)}\n\n` +
        `{#666666-fg}Press any key to exit{/}`
      : `{red-fg}{bold}Migration Failed{/bold}{/}\n\n` +
        `Completed: ${this.stats.completedTables}/${this.stats.totalTables} tables\n` +
        `Rows: ${formatNumber(this.stats.migratedRows)}\n` +
        `Failed: ${formatNumber(this.stats.failedRows)}\n\n` +
        `{#666666-fg}Press any key to exit{/}`;

    blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 45,
      height: 12,
      content: message,
      tags: true,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: '#1a1a2e',
        border: { fg: success ? '#00FF00' : '#FF0000' },
      },
    });

    this.screen.key(['enter', 'escape', 'space', 'q'], () => {
      this.stop();
      process.exit(success ? 0 : 1);
    });

    this.screen.render();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and start a new dashboard
 */
export function createDashboard(config: DashboardConfig): Dashboard {
  const dashboard = new Dashboard(config);
  dashboard.start();
  return dashboard;
}
