/**
 * Migration Summary Report
 *
 * Generates comprehensive post-migration reports in both
 * JSON (for automation) and human-readable formats.
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { MigrationReport } from '../shared/types.js';
import type { PreflightResult } from './preflight.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended migration summary with additional metadata
 */
export interface ExtendedMigrationSummary {
  /** Basic migration report */
  report: MigrationReport;
  /** Pre-flight information */
  preflight?: PreflightResult;
  /** Environment information */
  environment: {
    nodeVersion: string;
    platform: string;
    toolVersion: string;
    timestamp: string;
  };
  /** Performance metrics */
  performance: {
    totalDuration: number;
    avgRowsPerSecond: number;
    peakMemoryMB: number;
    totalBatches: number;
    retriedBatches: number;
  };
  /** Configuration used */
  config: {
    batchSize: number;
    rateLimit: number;
    parallel: boolean;
    dryRun: boolean;
  };
  /** Next steps / recommendations */
  nextSteps: string[];
}

/**
 * Report format options
 */
export type ReportFormat = 'json' | 'text' | 'markdown' | 'html';

// ============================================================================
// Report Generator
// ============================================================================

/**
 * Migration summary report generator
 */
export class SummaryReportGenerator {
  private toolVersion: string;

  constructor(toolVersion: string = '1.0.0') {
    this.toolVersion = toolVersion;
  }

  /**
   * Generate extended summary from migration report
   */
  createExtendedSummary(
    report: MigrationReport,
    config: {
      batchSize: number;
      rateLimit: number;
      parallel: boolean;
      dryRun: boolean;
    },
    preflight?: PreflightResult
  ): ExtendedMigrationSummary {
    const totalRows = report.tables.reduce((sum, t) => sum + t.migratedRows, 0);
    const durationSec = report.duration / 1000;

    return {
      report,
      preflight,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        toolVersion: this.toolVersion,
        timestamp: new Date().toISOString(),
      },
      performance: {
        totalDuration: report.duration,
        avgRowsPerSecond: durationSec > 0 ? Math.round(totalRows / durationSec) : 0,
        peakMemoryMB: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
        totalBatches: Math.ceil(totalRows / config.batchSize),
        retriedBatches: report.errors.filter(e => e.retryable).length,
      },
      config,
      nextSteps: this.generateNextSteps(report, config),
    };
  }

  /**
   * Generate next steps based on migration results
   */
  private generateNextSteps(
    report: MigrationReport,
    config: { dryRun: boolean }
  ): string[] {
    const steps: string[] = [];

    if (config.dryRun) {
      steps.push('Run without --dry-run to perform actual migration');
      steps.push('Review generated schema files before deploying');
      return steps;
    }

    if (report.status === 'completed') {
      steps.push('Deploy generated Convex functions: npx convex deploy');
      steps.push('Verify data integrity by running test queries');
      steps.push('Update application code to use new Convex endpoints');
      steps.push('Consider adding indexes for frequently queried fields');
    } else if (report.status === 'partial') {
      steps.push('Review errors and fix any issues');
      steps.push('Run with --resume to continue migration');
      steps.push('Check Convex dashboard for partial data');
    } else if (report.status === 'failed') {
      steps.push('Review error messages above');
      steps.push('Fix connection or permission issues');
      steps.push('Use --rollback to undo partial migration if needed');
      steps.push('Re-run migration after fixes');
    }

    return steps;
  }

  /**
   * Generate report in specified format
   */
  async generateReport(
    summary: ExtendedMigrationSummary,
    format: ReportFormat = 'text'
  ): Promise<string> {
    switch (format) {
      case 'json':
        return this.generateJsonReport(summary);
      case 'markdown':
        return this.generateMarkdownReport(summary);
      case 'html':
        return this.generateHtmlReport(summary);
      case 'text':
      default:
        return this.generateTextReport(summary);
    }
  }

  /**
   * Generate JSON report
   */
  private generateJsonReport(summary: ExtendedMigrationSummary): string {
    return JSON.stringify(summary, null, 2);
  }

  /**
   * Generate plain text report
   */
  private generateTextReport(summary: ExtendedMigrationSummary): string {
    const { report, performance, config, environment, nextSteps } = summary;
    const lines: string[] = [];

    lines.push('═'.repeat(60));
    lines.push('           MIGRATION SUMMARY REPORT');
    lines.push('═'.repeat(60));
    lines.push('');

    // Status
    const statusIcon = report.status === 'completed' ? '✓' : report.status === 'partial' ? '⚠' : '✖';
    lines.push(`Status: ${statusIcon} ${report.status.toUpperCase()}`);
    lines.push(`Generated: ${environment.timestamp}`);
    lines.push('');

    // Overview
    lines.push('─'.repeat(60));
    lines.push('OVERVIEW');
    lines.push('─'.repeat(60));
    lines.push(`  Tables:        ${report.tables.length}`);
    lines.push(`  Total Rows:    ${report.totalRows.toLocaleString()}`);
    lines.push(`  Migrated:      ${report.migratedRows.toLocaleString()}`);
    lines.push(`  Failed:        ${report.failedRows.toLocaleString()}`);
    lines.push(`  Duration:      ${this.formatDuration(report.duration)}`);
    lines.push('');

    // Performance
    lines.push('─'.repeat(60));
    lines.push('PERFORMANCE');
    lines.push('─'.repeat(60));
    lines.push(`  Throughput:    ${performance.avgRowsPerSecond.toLocaleString()} rows/sec`);
    lines.push(`  Peak Memory:   ${performance.peakMemoryMB} MB`);
    lines.push(`  Total Batches: ${performance.totalBatches}`);
    lines.push(`  Retried:       ${performance.retriedBatches}`);
    lines.push('');

    // Per-table breakdown
    lines.push('─'.repeat(60));
    lines.push('TABLE BREAKDOWN');
    lines.push('─'.repeat(60));
    for (const table of report.tables) {
      const icon = table.status === 'completed' ? '✓' : '✖';
      const pct = table.totalRows > 0
        ? Math.round((table.migratedRows / table.totalRows) * 100)
        : 100;
      lines.push(
        `  ${icon} ${table.tableName.padEnd(25)} ${table.migratedRows.toLocaleString().padStart(10)} / ${table.totalRows.toLocaleString().padStart(10)} (${pct}%)`
      );
    }
    lines.push('');

    // Errors
    if (report.errors.length > 0) {
      lines.push('─'.repeat(60));
      lines.push('ERRORS');
      lines.push('─'.repeat(60));
      for (const error of report.errors.slice(0, 10)) {
        lines.push(`  [${error.code}] ${error.message}`);
        if (error.table) lines.push(`    Table: ${error.table}`);
      }
      if (report.errors.length > 10) {
        lines.push(`  ... and ${report.errors.length - 10} more errors`);
      }
      lines.push('');
    }

    // Configuration
    lines.push('─'.repeat(60));
    lines.push('CONFIGURATION');
    lines.push('─'.repeat(60));
    lines.push(`  Batch Size:    ${config.batchSize}`);
    lines.push(`  Rate Limit:    ${config.rateLimit} req/s`);
    lines.push(`  Parallel:      ${config.parallel ? 'Yes' : 'No'}`);
    lines.push(`  Dry Run:       ${config.dryRun ? 'Yes' : 'No'}`);
    lines.push('');

    // Next steps
    lines.push('─'.repeat(60));
    lines.push('NEXT STEPS');
    lines.push('─'.repeat(60));
    for (let i = 0; i < nextSteps.length; i++) {
      lines.push(`  ${i + 1}. ${nextSteps[i]}`);
    }
    lines.push('');

    // Environment
    lines.push('─'.repeat(60));
    lines.push('ENVIRONMENT');
    lines.push('─'.repeat(60));
    lines.push(`  Tool Version:  ${environment.toolVersion}`);
    lines.push(`  Node.js:       ${environment.nodeVersion}`);
    lines.push(`  Platform:      ${environment.platform}`);
    lines.push('');

    lines.push('═'.repeat(60));

    return lines.join('\n');
  }

  /**
   * Generate Markdown report
   */
  private generateMarkdownReport(summary: ExtendedMigrationSummary): string {
    const { report, performance, environment, nextSteps } = summary;
    const lines: string[] = [];

    lines.push('# Migration Summary Report');
    lines.push('');
    lines.push(`**Status:** ${report.status === 'completed' ? '✅' : report.status === 'partial' ? '⚠️' : '❌'} ${report.status}`);
    lines.push(`**Generated:** ${environment.timestamp}`);
    lines.push('');

    lines.push('## Overview');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Tables | ${report.tables.length} |`);
    lines.push(`| Total Rows | ${report.totalRows.toLocaleString()} |`);
    lines.push(`| Migrated | ${report.migratedRows.toLocaleString()} |`);
    lines.push(`| Failed | ${report.failedRows.toLocaleString()} |`);
    lines.push(`| Duration | ${this.formatDuration(report.duration)} |`);
    lines.push('');

    lines.push('## Performance');
    lines.push('');
    lines.push(`- **Throughput:** ${performance.avgRowsPerSecond.toLocaleString()} rows/sec`);
    lines.push(`- **Peak Memory:** ${performance.peakMemoryMB} MB`);
    lines.push(`- **Total Batches:** ${performance.totalBatches}`);
    lines.push(`- **Retried Batches:** ${performance.retriedBatches}`);
    lines.push('');

    lines.push('## Table Breakdown');
    lines.push('');
    lines.push('| Table | Status | Migrated | Total | % |');
    lines.push('|-------|--------|----------|-------|---|');
    for (const table of report.tables) {
      const icon = table.status === 'completed' ? '✅' : '❌';
      const pct = table.totalRows > 0
        ? Math.round((table.migratedRows / table.totalRows) * 100)
        : 100;
      lines.push(
        `| ${table.tableName} | ${icon} | ${table.migratedRows.toLocaleString()} | ${table.totalRows.toLocaleString()} | ${pct}% |`
      );
    }
    lines.push('');

    if (report.errors.length > 0) {
      lines.push('## Errors');
      lines.push('');
      for (const error of report.errors.slice(0, 10)) {
        lines.push(`- **[${error.code}]** ${error.message}`);
      }
      if (report.errors.length > 10) {
        lines.push(`- ... and ${report.errors.length - 10} more errors`);
      }
      lines.push('');
    }

    lines.push('## Next Steps');
    lines.push('');
    for (let i = 0; i < nextSteps.length; i++) {
      lines.push(`${i + 1}. ${nextSteps[i]}`);
    }
    lines.push('');

    lines.push('---');
    lines.push(`*Generated by PostgreSQL to Convex Migration Tool v${environment.toolVersion}*`);

    return lines.join('\n');
  }

  /**
   * Generate HTML report
   */
  private generateHtmlReport(summary: ExtendedMigrationSummary): string {
    const { report, performance, environment, nextSteps } = summary;
    const statusColor = report.status === 'completed' ? '#22c55e' : report.status === 'partial' ? '#f59e0b' : '#ef4444';

    return `<!DOCTYPE html>
<html>
<head>
  <title>Migration Summary Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; background: #f9fafb; }
    .card { background: white; border-radius: 8px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { color: #111827; margin-bottom: 8px; }
    h2 { color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 9999px; color: white; font-weight: 600; background: ${statusColor}; }
    .metric { display: inline-block; margin-right: 24px; }
    .metric-value { font-size: 24px; font-weight: 700; color: #111827; }
    .metric-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
    .success { color: #22c55e; }
    .error { color: #ef4444; }
    .next-step { padding: 12px; background: #eff6ff; border-radius: 6px; margin-bottom: 8px; }
    .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Migration Summary Report</h1>
    <span class="status">${report.status.toUpperCase()}</span>
    <p style="color: #6b7280; margin-top: 8px;">Generated: ${environment.timestamp}</p>
  </div>

  <div class="card">
    <h2>Overview</h2>
    <div class="metric"><div class="metric-value">${report.tables.length}</div><div class="metric-label">Tables</div></div>
    <div class="metric"><div class="metric-value">${report.totalRows.toLocaleString()}</div><div class="metric-label">Total Rows</div></div>
    <div class="metric"><div class="metric-value">${report.migratedRows.toLocaleString()}</div><div class="metric-label">Migrated</div></div>
    <div class="metric"><div class="metric-value">${this.formatDuration(report.duration)}</div><div class="metric-label">Duration</div></div>
    <div class="metric"><div class="metric-value">${performance.avgRowsPerSecond.toLocaleString()}</div><div class="metric-label">Rows/sec</div></div>
  </div>

  <div class="card">
    <h2>Table Breakdown</h2>
    <table>
      <tr><th>Table</th><th>Status</th><th>Migrated</th><th>Total</th><th>Progress</th></tr>
      ${report.tables.map(t => {
        const pct = t.totalRows > 0 ? Math.round((t.migratedRows / t.totalRows) * 100) : 100;
        const isSuccess = t.status === 'completed';
        return `<tr>
          <td>${t.tableName}</td>
          <td class="${isSuccess ? 'success' : 'error'}">${isSuccess ? '✓' : '✖'}</td>
          <td>${t.migratedRows.toLocaleString()}</td>
          <td>${t.totalRows.toLocaleString()}</td>
          <td>${pct}%</td>
        </tr>`;
      }).join('')}
    </table>
  </div>

  ${report.errors.length > 0 ? `
  <div class="card">
    <h2>Errors</h2>
    ${report.errors.slice(0, 10).map(e => `<p class="error"><strong>[${e.code}]</strong> ${e.message}</p>`).join('')}
    ${report.errors.length > 10 ? `<p>... and ${report.errors.length - 10} more errors</p>` : ''}
  </div>
  ` : ''}

  <div class="card">
    <h2>Next Steps</h2>
    ${nextSteps.map((s, i) => `<div class="next-step"><strong>${i + 1}.</strong> ${s}</div>`).join('')}
  </div>

  <div class="footer">
    Generated by PostgreSQL to Convex Migration Tool v${environment.toolVersion}
  </div>
</body>
</html>`;
  }

  /**
   * Save report to file
   */
  async saveReport(
    summary: ExtendedMigrationSummary,
    outputDir: string,
    formats: ReportFormat[] = ['json', 'text', 'markdown']
  ): Promise<string[]> {
    const savedFiles: string[] = [];

    await fs.mkdir(outputDir, { recursive: true });

    for (const format of formats) {
      const content = await this.generateReport(summary, format);
      const ext = format === 'text' ? 'txt' : format;
      const filename = `migration-report.${ext}`;
      const filepath = path.join(outputDir, filename);

      await fs.writeFile(filepath, content, 'utf-8');
      savedFiles.push(filepath);
    }

    return savedFiles;
  }

  /**
   * Format duration in human readable format
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

// ============================================================================
// Display Functions
// ============================================================================

/**
 * Print summary to console with colors
 */
export function printSummaryToConsole(summary: ExtendedMigrationSummary): void {
  const { report, performance, nextSteps } = summary;

  console.log('');
  console.log(chalk.bold('═'.repeat(60)));
  console.log(chalk.bold.cyan('           MIGRATION SUMMARY'));
  console.log(chalk.bold('═'.repeat(60)));
  console.log('');

  // Status with color
  const statusColor = report.status === 'completed' ? chalk.green : report.status === 'partial' ? chalk.yellow : chalk.red;
  const statusIcon = report.status === 'completed' ? '✓' : report.status === 'partial' ? '⚠' : '✖';
  console.log(`  Status: ${statusColor.bold(`${statusIcon} ${report.status.toUpperCase()}`)}`);
  console.log('');

  // Key metrics
  console.log(chalk.gray('  ─'.repeat(29)));
  console.log(`  ${chalk.cyan('Tables:')}        ${report.tables.length}`);
  console.log(`  ${chalk.cyan('Total Rows:')}    ${report.totalRows.toLocaleString()}`);
  console.log(`  ${chalk.cyan('Migrated:')}      ${chalk.green(report.migratedRows.toLocaleString())}`);
  if (report.failedRows > 0) {
    console.log(`  ${chalk.cyan('Failed:')}        ${chalk.red(report.failedRows.toLocaleString())}`);
  }
  console.log(`  ${chalk.cyan('Duration:')}      ${Math.round(report.duration / 1000)}s`);
  console.log(`  ${chalk.cyan('Throughput:')}    ${performance.avgRowsPerSecond.toLocaleString()} rows/sec`);
  console.log(chalk.gray('  ─'.repeat(29)));
  console.log('');

  // Next steps
  if (nextSteps.length > 0) {
    console.log(chalk.bold('  Next Steps:'));
    for (let i = 0; i < nextSteps.length; i++) {
      console.log(chalk.gray(`    ${i + 1}. ${nextSteps[i]}`));
    }
    console.log('');
  }

  console.log(chalk.bold('═'.repeat(60)));
  console.log('');
}
