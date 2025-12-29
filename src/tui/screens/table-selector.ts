/**
 * SunSetter AQM+ Table Selector
 *
 * Interactive table selection screen with multi-select support.
 */

import blessed from 'blessed';
import { APP_NAME, formatNumber } from '../branding.js';

// ============================================================================
// Types
// ============================================================================

export interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
  columnCount: number;
  hasPrimaryKey: boolean;
  foreignKeyCount: number;
}

export interface TableSelectorResult {
  confirmed: boolean;
  selectedTables: string[];
}

// ============================================================================
// Table Selector Screen
// ============================================================================

export class TableSelectorScreen {
  private screen: blessed.Widgets.Screen;
  private tables: TableInfo[];
  private filteredTables: TableInfo[];
  private selected: Set<string> = new Set();
  private resolvePromise: ((result: TableSelectorResult) => void) | null = null;
  private listWidget: blessed.Widgets.ListElement | null = null;
  private statsWidget: blessed.Widgets.BoxElement | null = null;
  private searchWidget: blessed.Widgets.TextboxElement | null = null;
  private searchQuery: string = '';

  constructor(tables: TableInfo[]) {
    this.tables = tables;
    this.filteredTables = tables;
    // Select all by default
    tables.forEach((t) => this.selected.add(t.name));

    this.screen = blessed.screen({
      smartCSR: true,
      title: `${APP_NAME} - Table Selection`,
      fullUnicode: true,
    });
  }

  /**
   * Show the table selector
   */
  public async show(): Promise<TableSelectorResult> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.render();
    });
  }

  /**
   * Render the selector screen
   */
  private render(): void {
    // Background
    blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      style: { bg: '#0d0d1a' },
    });

    // Header
    blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: `{center}{bold}☀ ${APP_NAME}{/bold} - Select Tables to Migrate{/center}`,
      tags: true,
      style: {
        fg: '#FF6B35',
        bg: '#1a1a2e',
      },
    });

    // Search box (only show if 10+ tables)
    const showSearch = this.tables.length >= 10;
    const searchBoxHeight = showSearch ? 3 : 0;

    if (showSearch) {
      this.searchWidget = blessed.textbox({
        parent: this.screen,
        top: 3,
        left: 0,
        width: '70%',
        height: 3,
        border: { type: 'line' },
        label: ' Search Tables (type to filter) ',
        style: {
          border: { fg: '#FF6B35' },
          focus: {
            border: { fg: '#FF3864' },
          },
        },
        inputOnFocus: true,
      });

      // Handle search input
      this.searchWidget.on('submit', (value: string) => {
        this.searchQuery = value || '';
        this.filterTables();
        if (this.listWidget) {
          this.listWidget.focus();
        }
      });

      this.searchWidget.on('keypress', (_ch: string, key: { name: string }) => {
        if (key.name === 'escape') {
          this.searchQuery = '';
          this.filterTables();
          if (this.listWidget) {
            this.listWidget.focus();
          }
        }
      });
    }

    // Main content area
    const contentBox = blessed.box({
      parent: this.screen,
      top: 3 + searchBoxHeight,
      left: 0,
      width: '70%',
      height: `${80 - searchBoxHeight}%`,
      border: { type: 'line' },
      label: ` Tables (${this.filteredTables.length}/${this.tables.length}) `,
      style: {
        border: { fg: '#9B59B6' },
      },
    });

    // Table list
    this.listWidget = blessed.list({
      parent: contentBox,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      items: this.getListItems(),
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: '█',
        style: { fg: '#FF6B35' },
      },
      style: {
        selected: {
          bg: '#3498DB',
          fg: 'white',
        },
        item: {
          fg: 'white',
        },
      },
    });

    // Stats panel
    this.statsWidget = blessed.box({
      parent: this.screen,
      top: 3,
      right: 0,
      width: '30%',
      height: 12,
      border: { type: 'line' },
      label: ' Selection Stats ',
      content: this.getStatsContent(),
      tags: true,
      style: {
        border: { fg: '#FF6B35' },
        fg: 'white',
      },
    });

    // Legend
    blessed.box({
      parent: this.screen,
      top: 16,
      right: 0,
      width: '30%',
      height: 8,
      border: { type: 'line' },
      label: ' Legend ',
      content: `
  {green-fg}[✓]{/} Selected
  {#666666-fg}[ ]{/} Not selected
  {yellow-fg}FK{/} Has foreign keys
  {cyan-fg}PK{/} Has primary key
      `,
      tags: true,
      style: {
        border: { fg: '#3498DB' },
        fg: 'white',
      },
    });

    // Action buttons
    const buttonBox = blessed.box({
      parent: this.screen,
      bottom: 3,
      left: 'center',
      width: 60,
      height: 3,
    });

    const confirmBtn = blessed.button({
      parent: buttonBox,
      left: 0,
      width: 20,
      height: 3,
      content: '{center}✓ Confirm{/center}',
      tags: true,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: '#228B22',
        border: { fg: '#00FF00' },
        focus: {
          bg: '#32CD32',
        },
      },
    });

    const selectAllBtn = blessed.button({
      parent: buttonBox,
      left: 22,
      width: 15,
      height: 3,
      content: '{center}Select All{/center}',
      tags: true,
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: '#9B59B6' },
        focus: {
          bg: '#9B59B6',
        },
      },
    });

    const clearBtn = blessed.button({
      parent: buttonBox,
      left: 39,
      width: 12,
      height: 3,
      content: '{center}Clear{/center}',
      tags: true,
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: '#FF3864' },
        focus: {
          bg: '#FF3864',
        },
      },
    });

    // Keyboard hints
    const searchHint = showSearch ? '  {bold}/{/bold} Search' : '';
    blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: `  {bold}Space{/bold} Toggle  {bold}Enter{/bold} Confirm  {bold}A{/bold} Select All  {bold}C{/bold} Clear${searchHint}  {bold}Q{/bold} Cancel`,
      tags: true,
      style: {
        bg: '#1a1a2e',
        fg: '#999999',
      },
    });

    // Track selected index
    let selectedIndex = 0;

    // Setup event handlers
    this.listWidget.on(
      'select',
      (_item: blessed.Widgets.BlessedElement, index: number) => {
        this.toggleTable(index);
      }
    );

    this.listWidget.on(
      'select item',
      (_item: blessed.Widgets.BlessedElement, index: number) => {
        selectedIndex = index;
      }
    );

    this.listWidget.key(['space'], () => {
      this.toggleTable(selectedIndex);
    });

    confirmBtn.on('press', () => this.confirm());
    selectAllBtn.on('press', () => this.selectAll());
    clearBtn.on('press', () => this.clearAll());

    this.screen.key(['enter'], () => this.confirm());
    this.screen.key(['a', 'A'], () => this.selectAll());
    this.screen.key(['c', 'C'], () => this.clearAll());
    this.screen.key(['escape', 'q', 'Q'], () => this.cancel());
    this.screen.key(['/', 's', 'S'], () => {
      // Focus search box if it exists
      if (this.searchWidget) {
        this.searchWidget.focus();
        this.screen.render();
      }
    });

    this.listWidget.focus();
    this.screen.render();
  }

  /**
   * Filter tables based on search query
   */
  private filterTables(): void {
    if (!this.searchQuery) {
      this.filteredTables = this.tables;
    } else {
      const query = this.searchQuery.toLowerCase();
      this.filteredTables = this.tables.filter((t) =>
        t.name.toLowerCase().includes(query)
      );
    }
    this.updateUI();
  }

  /**
   * Get list items with selection state
   */
  private getListItems(): string[] {
    return this.filteredTables.map((t) => {
      const selected = this.selected.has(t.name);
      const checkbox = selected ? '{green-fg}[✓]{/}' : '{#666666-fg}[ ]{/}';
      const pk = t.hasPrimaryKey ? '{cyan-fg}PK{/}' : '  ';
      const fk =
        t.foreignKeyCount > 0
          ? `{yellow-fg}FK:${t.foreignKeyCount}{/}`
          : '     ';
      const rows = formatNumber(t.rowCount).padStart(10);
      const cols = String(t.columnCount).padStart(3);

      return `${checkbox} ${t.name.padEnd(25)} ${rows} rows  ${cols} cols  ${pk} ${fk}`;
    });
  }

  /**
   * Get stats content
   */
  private getStatsContent(): string {
    const selectedCount = this.selected.size;
    const totalRows = this.tables
      .filter((t) => this.selected.has(t.name))
      .reduce((sum, t) => sum + t.rowCount, 0);

    return `
  Tables Selected:
  {bold}${selectedCount}{/} / ${this.tables.length}

  Total Rows:
  {bold}${formatNumber(totalRows)}{/}

  Estimated Time:
  {bold}${this.estimateTime(totalRows)}{/}
    `;
  }

  /**
   * Estimate migration time
   */
  private estimateTime(rows: number): string {
    // Rough estimate: 1000 rows per second
    const seconds = Math.ceil(rows / 1000);
    if (seconds < 60) return `~${seconds}s`;
    if (seconds < 3600) return `~${Math.ceil(seconds / 60)}m`;
    return `~${Math.ceil(seconds / 3600)}h`;
  }

  /**
   * Toggle table selection
   */
  private toggleTable(index: number): void {
    const table = this.filteredTables[index];
    if (!table) return;

    if (this.selected.has(table.name)) {
      this.selected.delete(table.name);
    } else {
      this.selected.add(table.name);
    }
    this.updateUI();
  }

  /**
   * Select all tables
   */
  private selectAll(): void {
    this.tables.forEach((t) => this.selected.add(t.name));
    this.updateUI();
  }

  /**
   * Clear all selections
   */
  private clearAll(): void {
    this.selected.clear();
    this.updateUI();
  }

  /**
   * Update UI after selection change
   */
  private updateUI(): void {
    if (this.listWidget) {
      this.listWidget.setItems(this.getListItems());
    }
    if (this.statsWidget) {
      this.statsWidget.setContent(this.getStatsContent());
    }
    this.screen.render();
  }

  /**
   * Confirm selection
   */
  private confirm(): void {
    this.screen.destroy();
    this.resolvePromise?.({
      confirmed: true,
      selectedTables: Array.from(this.selected),
    });
  }

  /**
   * Cancel selection
   */
  private cancel(): void {
    this.screen.destroy();
    this.resolvePromise?.({
      confirmed: false,
      selectedTables: [],
    });
  }
}

// ============================================================================
// Factory
// ============================================================================

export async function showTableSelector(
  tables: TableInfo[]
): Promise<TableSelectorResult> {
  const screen = new TableSelectorScreen(tables);
  return screen.show();
}
