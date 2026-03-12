/**
 * Preflight Command
 *
 * Runs preflight checks before migration to identify potential blockers,
 * schema warnings, and resource estimates.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { toError } from '../../utils/errors.js';

export function createPreflightCommand(): Command {
  return new Command('preflight')
    .description('Run preflight checks before migration')
    .requiredOption('-c, --connection <string>', 'Database connection string')
    .option(
      '--db-type <type>',
      'Database type (auto-detected if not specified)'
    )
    .option('-t, --tables <list>', 'Comma-separated list of tables to check')
    .option('-e, --exclude <list>', 'Comma-separated list of tables to exclude')
    .option('--json', 'Output results as JSON')
    .action(async (options) => {
      const { PreflightChecker } = await import('../../cli/preflight.js');
      const { SchemaIntrospector } = await import(
        '../../introspector/schema-introspector.js'
      );
      const { ProgressReporter } = await import(
        '../../cli/progress/reporter.js'
      );
      const { createAdapter, parseConnectionString } = await import(
        '../../adapters/index.js'
      );

      try {
        const reporter = new ProgressReporter({
          logLevel: options.json ? 'quiet' : 'normal',
          json: options.json || false,
        });

        // Parse connection string and create adapter
        const config = parseConnectionString(options.connection);
        const adapter = createAdapter(config);

        reporter.startSpinner('Connecting to database...');
        try {
          await adapter.connect();
        } catch {
          reporter.failSpinner('Failed to connect to database');
          process.exit(3);
        }
        reporter.succeedSpinner('Connected to database');

        // Introspect schema
        reporter.startSpinner('Introspecting schema...');
        const introspector = new SchemaIntrospector(adapter);
        const schema = await introspector.introspectSchema(
          adapter.getDefaultSchema()
        );
        let tables = schema.tables;

        // Apply filters
        if (options.tables) {
          const includeSet = new Set(
            options.tables.split(',').map((t: string) => t.trim())
          );
          tables = tables.filter((t) => includeSet.has(t.tableName));
        }
        if (options.exclude) {
          const excludeSet = new Set(
            options.exclude.split(',').map((t: string) => t.trim())
          );
          tables = tables.filter((t) => !excludeSet.has(t.tableName));
        }

        reporter.succeedSpinner(`Found ${tables.length} tables to check`);

        // Run preflight checks
        reporter.startSpinner('Running preflight checks...');
        const checker = new PreflightChecker(adapter);
        const result = await checker.check(tables);
        reporter.succeedSpinner('Preflight checks complete');

        // Output results
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          // Print summary
          reporter.section('Preflight Summary');
          reporter.printSummary({
            'Total Tables': result.tables.length,
            'Total Rows': result.totalRows.toLocaleString(),
            'Estimated Time (realistic)': `${Math.round(result.estimatedDuration.realistic / 60)}m`,
            'Memory Required': `${result.resourceEstimates.memoryMB}MB`,
            Blockers: result.blockers.length,
            Warnings:
              result.schemaWarnings.length + result.cascadeWarnings.length,
          });

          // Show blockers
          if (result.blockers.length > 0) {
            console.log();
            reporter.subsection('Blockers (must fix before migration):');
            result.blockers.forEach((blocker) => {
              reporter.error(blocker);
            });
          }

          // Show warnings
          if (result.schemaWarnings.length > 0) {
            console.log();
            reporter.subsection('Schema Warnings:');
            result.schemaWarnings.forEach((warning) => {
              reporter.warn(warning);
            });
          }

          // Show recommendations
          if (result.recommendations.length > 0) {
            console.log();
            reporter.subsection('Recommendations:');
            result.recommendations.forEach((rec) => {
              reporter.info(rec);
            });
          }

          // Show status
          console.log();
          if (result.valid) {
            reporter.box(
              'Preflight checks passed! Ready to migrate.',
              'success'
            );
          } else {
            reporter.box(
              'Preflight checks failed. Please address blockers above.',
              'error'
            );
          }
        }

        await adapter.disconnect();
        process.exit(result.valid ? 0 : 2);
      } catch (error) {
        console.error(chalk.red('Preflight error:'), toError(error).message);
        process.exit(1);
      }
    });
}
