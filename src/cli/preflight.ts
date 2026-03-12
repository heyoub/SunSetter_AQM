/**
 * Pre-flight Validation
 *
 * Validates migration readiness before starting:
 * - Row counts per table
 * - Time estimates
 * - CASCADE/FK dependency warnings
 * - Schema compatibility checks
 * - Resource requirements
 */

import chalk from 'chalk';
import type { TableInfo } from '../introspector/schema-introspector.js';
import type { DatabaseAdapter } from '../adapters/base.js';
import type { ProgressReporter } from './progress/reporter.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Table statistics for pre-flight check
 */
export interface TableStats {
  tableName: string;
  schemaName: string;
  rowCount: number;
  estimatedSize: string;
  columnCount: number;
  hasPrimaryKey: boolean;
  foreignKeyCount: number;
  indexCount: number;
}

/**
 * CASCADE dependency warning
 */
export interface CascadeWarning {
  sourceTable: string;
  targetTable: string;
  constraintName: string;
  columnName: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  recommendation: string;
}

/**
 * Pre-flight validation result
 */
export interface PreflightResult {
  valid: boolean;
  tables: TableStats[];
  totalRows: number;
  estimatedDuration: {
    optimistic: number; // seconds
    realistic: number;
    pessimistic: number;
  };
  cascadeWarnings: CascadeWarning[];
  schemaWarnings: string[];
  resourceEstimates: {
    memoryMB: number;
    diskMB: number;
    apiCalls: number;
  };
  recommendations: string[];
  blockers: string[];
}

// ============================================================================
// Pre-flight Checker
// ============================================================================

/**
 * Pre-flight validation checker
 */
export class PreflightChecker {
  private db: DatabaseAdapter;
  private batchSize: number;
  private rateLimit: number;

  constructor(
    db: DatabaseAdapter,
    options: { batchSize?: number; rateLimit?: number } = {}
  ) {
    this.db = db;
    this.batchSize = options.batchSize || 100;
    this.rateLimit = options.rateLimit || 100;
  }

  /**
   * Run full pre-flight validation
   */
  async check(tables: TableInfo[]): Promise<PreflightResult> {
    const result: PreflightResult = {
      valid: true,
      tables: [],
      totalRows: 0,
      estimatedDuration: { optimistic: 0, realistic: 0, pessimistic: 0 },
      cascadeWarnings: [],
      schemaWarnings: [],
      resourceEstimates: { memoryMB: 0, diskMB: 0, apiCalls: 0 },
      recommendations: [],
      blockers: [],
    };

    // Get row counts for all tables
    result.tables = await this.getTableStats(tables);
    result.totalRows = result.tables.reduce((sum, t) => sum + t.rowCount, 0);

    // Calculate time estimates
    result.estimatedDuration = this.calculateTimeEstimate(result.totalRows);

    // Analyze CASCADE dependencies
    result.cascadeWarnings = this.analyzeCascadeDependencies(tables);

    // Check for schema issues
    result.schemaWarnings = this.checkSchemaCompatibility(tables);

    // Estimate resource usage
    result.resourceEstimates = this.estimateResources(
      result.totalRows,
      tables.length
    );

    // Generate recommendations
    result.recommendations = this.generateRecommendations(result);

    // Check for blockers
    result.blockers = this.checkBlockers(result, tables);
    result.valid = result.blockers.length === 0;

    return result;
  }

  /**
   * Get statistics for all tables
   */
  private async getTableStats(tables: TableInfo[]): Promise<TableStats[]> {
    const stats: TableStats[] = [];

    for (const table of tables) {
      try {
        // Get row count
        const countResult = await this.db.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM "${table.schemaName}"."${table.tableName}"`
        );
        const rowCount = parseInt(countResult[0]?.count || '0', 10);

        // Estimate size (rough approximation: avg 500 bytes per row)
        const estimatedBytes = rowCount * 500;
        const estimatedSize = this.formatBytes(estimatedBytes);

        stats.push({
          tableName: table.tableName,
          schemaName: table.schemaName,
          rowCount,
          estimatedSize,
          columnCount: table.columns.length,
          hasPrimaryKey: table.primaryKeys.length > 0,
          foreignKeyCount: table.foreignKeys.length,
          indexCount: table.indexes.length,
        });
      } catch (error) {
        // If we can't get stats, estimate based on schema
        stats.push({
          tableName: table.tableName,
          schemaName: table.schemaName,
          rowCount: -1, // Unknown
          estimatedSize: 'unknown',
          columnCount: table.columns.length,
          hasPrimaryKey: table.primaryKeys.length > 0,
          foreignKeyCount: table.foreignKeys.length,
          indexCount: table.indexes.length,
        });
      }
    }

    return stats;
  }

  /**
   * Calculate time estimates for migration
   */
  private calculateTimeEstimate(
    totalRows: number
  ): PreflightResult['estimatedDuration'] {
    // Base calculation: rows / (batchSize * rate limit factor)
    // Assuming each batch takes ~1 second at 100 req/s
    const batchCount = Math.ceil(totalRows / this.batchSize);
    const baseSeconds = batchCount / Math.min(this.rateLimit / 10, 10); // Conservative rate

    // Add overhead: 20% for optimistic, 50% for realistic, 100% for pessimistic
    return {
      optimistic: Math.ceil(baseSeconds * 1.2),
      realistic: Math.ceil(baseSeconds * 1.5),
      pessimistic: Math.ceil(baseSeconds * 2.0),
    };
  }

  /**
   * Analyze CASCADE dependencies and generate warnings
   */
  private analyzeCascadeDependencies(tables: TableInfo[]): CascadeWarning[] {
    const warnings: CascadeWarning[] = [];
    const tableMap = new Map(tables.map((t) => [t.tableName, t]));

    for (const table of tables) {
      for (const fk of table.foreignKeys) {
        const targetTable = tableMap.get(fk.referencedTable);

        // Warning: Convex doesn't have CASCADE delete
        warnings.push({
          sourceTable: table.tableName,
          targetTable: fk.referencedTable,
          constraintName: fk.constraintName,
          columnName: fk.columnName,
          severity: 'warning',
          message: `Foreign key ${fk.constraintName}: ${table.tableName}.${fk.columnName} -> ${fk.referencedTable}.${fk.referencedColumn}`,
          recommendation: `Convex does not enforce CASCADE. Implement cascade logic in your mutations or use Convex Ents.`,
        });

        // Critical: Circular dependencies
        if (targetTable) {
          const reverseFK = targetTable.foreignKeys.find(
            (rfk) => rfk.referencedTable === table.tableName
          );
          if (reverseFK) {
            warnings.push({
              sourceTable: table.tableName,
              targetTable: fk.referencedTable,
              constraintName: fk.constraintName,
              columnName: fk.columnName,
              severity: 'critical',
              message: `Circular dependency detected: ${table.tableName} <-> ${fk.referencedTable}`,
              recommendation: `Migration order may require special handling. Consider breaking the cycle or using nullable FKs.`,
            });
          }
        }

        // Info: Missing target table
        if (!targetTable) {
          warnings.push({
            sourceTable: table.tableName,
            targetTable: fk.referencedTable,
            constraintName: fk.constraintName,
            columnName: fk.columnName,
            severity: 'info',
            message: `Foreign key references table not in migration: ${fk.referencedTable}`,
            recommendation: `Ensure ${fk.referencedTable} is migrated first, or handle NULL references.`,
          });
        }
      }
    }

    return warnings;
  }

  /**
   * Check for schema compatibility issues
   */
  private checkSchemaCompatibility(tables: TableInfo[]): string[] {
    const warnings: string[] = [];

    for (const table of tables) {
      // Check for tables without primary keys
      if (table.primaryKeys.length === 0) {
        warnings.push(
          `Table "${table.tableName}" has no primary key. Convex will generate _id automatically.`
        );
      }

      // Check for unsupported column types
      for (const col of table.columns) {
        const unsupportedTypes = [
          'xml',
          'tsvector',
          'tsquery',
          'box',
          'circle',
          'line',
          'lseg',
          'path',
          'polygon',
          'point',
        ];
        if (
          unsupportedTypes.some((t) => col.dataType.toLowerCase().includes(t))
        ) {
          warnings.push(
            `Column "${table.tableName}.${col.columnName}" has type "${col.dataType}" which may not convert cleanly to Convex.`
          );
        }
      }

      // Check for very wide tables
      if (table.columns.length > 50) {
        warnings.push(
          `Table "${table.tableName}" has ${table.columns.length} columns. Consider splitting for better performance.`
        );
      }
    }

    return warnings;
  }

  /**
   * Estimate resource requirements
   */
  private estimateResources(
    totalRows: number,
    tableCount: number
  ): PreflightResult['resourceEstimates'] {
    // Memory: ~1KB per row for ID mapping, plus overhead
    const memoryMB = Math.ceil((totalRows * 1024) / (1024 * 1024)) + 100;

    // Disk: ~200 bytes per ID mapping entry
    const diskMB = Math.ceil((totalRows * 200) / (1024 * 1024)) + 10;

    // API calls: rows / batchSize + overhead
    const apiCalls = Math.ceil(totalRows / this.batchSize) + tableCount * 2;

    return { memoryMB, diskMB, apiCalls };
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(result: PreflightResult): string[] {
    const recommendations: string[] = [];

    // Large migration recommendations
    if (result.totalRows > 100000) {
      recommendations.push(
        `Large migration detected (${result.totalRows.toLocaleString()} rows). Use --parallel for faster migration.`
      );
    }

    if (result.totalRows > 1000000) {
      recommendations.push(
        `Very large migration. Consider migrating in batches using --tables to select subsets.`
      );
    }

    // Memory recommendations
    if (result.resourceEstimates.memoryMB > 500) {
      recommendations.push(
        `High memory usage expected (~${result.resourceEstimates.memoryMB}MB). Ensure sufficient RAM or use streaming mode.`
      );
    }

    // FK recommendations
    const criticalWarnings = result.cascadeWarnings.filter(
      (w) => w.severity === 'critical'
    );
    if (criticalWarnings.length > 0) {
      recommendations.push(
        `${criticalWarnings.length} circular dependencies detected. Review migration order carefully.`
      );
    }

    // Duration recommendations
    if (result.estimatedDuration.realistic > 3600) {
      recommendations.push(
        `Migration may take ${this.formatDuration(result.estimatedDuration.realistic)}. Consider running during off-peak hours.`
      );
    }

    return recommendations;
  }

  /**
   * Check for migration blockers
   */
  private checkBlockers(
    result: PreflightResult,
    tables: TableInfo[]
  ): string[] {
    const blockers: string[] = [];

    // No tables to migrate
    if (tables.length === 0) {
      blockers.push('No tables selected for migration.');
    }

    // Unknown row counts (can't estimate)
    const unknownTables = result.tables.filter((t) => t.rowCount === -1);
    if (unknownTables.length === tables.length) {
      blockers.push(
        'Could not retrieve row counts. Check database permissions.'
      );
    }

    return blockers;
  }

  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * Format duration in human readable format
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

// ============================================================================
// Display Functions
// ============================================================================

/**
 * Display pre-flight results to console
 */
export function displayPreflightResults(
  result: PreflightResult,
  reporter: ProgressReporter
): void {
  reporter.section('Pre-flight Check Results');

  // Table summary
  reporter.subsection('Tables to Migrate');
  console.log('');
  console.log(
    chalk.gray(
      '  Table'.padEnd(30) +
        'Rows'.padStart(12) +
        'Size'.padStart(12) +
        'FKs'.padStart(6)
    )
  );
  console.log(chalk.gray('  ' + '─'.repeat(60)));

  for (const table of result.tables) {
    const rowStr =
      table.rowCount >= 0 ? table.rowCount.toLocaleString() : 'unknown';
    const fkStr =
      table.foreignKeyCount > 0
        ? chalk.yellow(table.foreignKeyCount.toString())
        : '0';
    console.log(
      `  ${table.tableName.padEnd(28)} ${rowStr.padStart(12)} ${table.estimatedSize.padStart(12)} ${fkStr.padStart(6)}`
    );
  }

  console.log(chalk.gray('  ' + '─'.repeat(60)));
  console.log(
    `  ${'Total'.padEnd(28)} ${chalk.bold(result.totalRows.toLocaleString().padStart(12))}`
  );
  console.log('');

  // Time estimates
  reporter.subsection('Time Estimates');
  const formatTime = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  console.log(
    `  ${chalk.green('Optimistic:')}   ${formatTime(result.estimatedDuration.optimistic)}`
  );
  console.log(
    `  ${chalk.yellow('Realistic:')}    ${formatTime(result.estimatedDuration.realistic)}`
  );
  console.log(
    `  ${chalk.red('Pessimistic:')}  ${formatTime(result.estimatedDuration.pessimistic)}`
  );
  console.log('');

  // Resource estimates
  reporter.subsection('Resource Estimates');
  console.log(`  Memory:     ~${result.resourceEstimates.memoryMB} MB`);
  console.log(
    `  Disk:       ~${result.resourceEstimates.diskMB} MB (for state files)`
  );
  console.log(
    `  API Calls:  ~${result.resourceEstimates.apiCalls.toLocaleString()}`
  );
  console.log('');

  // CASCADE warnings
  if (result.cascadeWarnings.length > 0) {
    reporter.subsection('Foreign Key Warnings');
    const critical = result.cascadeWarnings.filter(
      (w) => w.severity === 'critical'
    );
    const warnings = result.cascadeWarnings.filter(
      (w) => w.severity === 'warning'
    );
    const info = result.cascadeWarnings.filter((w) => w.severity === 'info');

    if (critical.length > 0) {
      console.log(chalk.red(`  ⚠ ${critical.length} critical issue(s):`));
      for (const w of critical.slice(0, 3)) {
        console.log(chalk.red(`    • ${w.message}`));
      }
      if (critical.length > 3) {
        console.log(chalk.red(`    ... and ${critical.length - 3} more`));
      }
    }

    if (warnings.length > 0) {
      console.log(
        chalk.yellow(
          `  ⚡ ${warnings.length} foreign key relationship(s) detected`
        )
      );
      console.log(
        chalk.gray(
          `    Convex does not enforce CASCADE. Implement in mutations.`
        )
      );
    }

    if (info.length > 0) {
      console.log(
        chalk.blue(`  ℹ ${info.length} reference(s) to external tables`)
      );
    }
    console.log('');
  }

  // Schema warnings
  if (result.schemaWarnings.length > 0) {
    reporter.subsection('Schema Warnings');
    for (const warning of result.schemaWarnings.slice(0, 5)) {
      console.log(chalk.yellow(`  ⚠ ${warning}`));
    }
    if (result.schemaWarnings.length > 5) {
      console.log(
        chalk.gray(`  ... and ${result.schemaWarnings.length - 5} more`)
      );
    }
    console.log('');
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    reporter.subsection('Recommendations');
    for (const rec of result.recommendations) {
      console.log(chalk.cyan(`  💡 ${rec}`));
    }
    console.log('');
  }

  // Blockers
  if (result.blockers.length > 0) {
    reporter.subsection('Blockers');
    for (const blocker of result.blockers) {
      console.log(chalk.red(`  ✖ ${blocker}`));
    }
    console.log('');
  }

  // Final verdict
  if (result.valid) {
    console.log(
      chalk.green.bold('  ✓ Pre-flight check passed. Ready to migrate.')
    );
  } else {
    console.log(
      chalk.red.bold(
        '  ✖ Pre-flight check failed. Address blockers before proceeding.'
      )
    );
  }
  console.log('');
}
