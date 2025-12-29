#!/usr/bin/env node

/**
 * ☀️ SunSetter AQM+
 *
 * Database to Convex Migration Tool
 * AQM = Actions, Queries, Mutations
 *
 * Supports: PostgreSQL, MySQL, SQLite, SQL Server
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { generateCodeFromDatabase } from './cli/generate.js';
import { DatabaseConfig } from './config/database.js';
import { GeneratorOptions } from './generator/code-generator.js';
import { createMigrateCommand } from './cli/commands/migrate.js';
import { createSeedExportCommand } from './cli/commands/seed-export.js';
import {
  sunsetGradient,
  APP_NAME,
  APP_TAGLINE,
  VERSION,
} from './tui/branding.js';

const program = new Command();

// Check for TUI mode first (before Commander parsing)
const args = process.argv.slice(2);
if (
  args.includes('--tui') ||
  args.includes('-i') ||
  args.includes('--interactive')
) {
  // Launch TUI mode
  import('./tui/app.js').then(({ launchTUI }) => {
    launchTUI().catch(console.error);
  });
} else {
  // Normal CLI mode
  program
    .name('sunsetter-aqm')
    .description(
      sunsetGradient(`
☀️  ${APP_NAME}
════════════════════════════════════════
${APP_TAGLINE}

Database to Convex Migration Tool
Supports: PostgreSQL, MySQL, SQLite, SQL Server
`)
    )
    .version(VERSION)
    .option('--tui, -i, --interactive', 'Launch interactive TUI mode');

  // Add migrate command (main feature)
  program.addCommand(createMigrateCommand());

  // Add seed-export command
  program.addCommand(createSeedExportCommand());

  // Add preflight command
  program
    .command('preflight')
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
      const { PreflightChecker } = await import('./cli/preflight.js');
      const { DatabaseConnection } = await import('./config/database.js');
      const { SchemaIntrospector } = await import(
        './introspector/schema-introspector.js'
      );
      const { ProgressReporter } = await import('./cli/progress/reporter.js');
      const { parseConnectionString } = await import('./adapters/index.js');

      try {
        const reporter = new ProgressReporter({
          logLevel: options.json ? 'quiet' : 'normal',
          json: options.json || false,
        });

        // Parse connection string
        const config = parseConnectionString(options.connection);

        // Create database connection
        // Convert SSLOptions to SSLConfig if needed
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

        reporter.startSpinner('Connecting to database...');
        if (!(await dbConnection.testConnection())) {
          reporter.failSpinner('Failed to connect to database');
          process.exit(3);
        }
        reporter.succeedSpinner('Connected to database');

        // Introspect schema
        reporter.startSpinner('Introspecting schema...');
        const introspector = new SchemaIntrospector(dbConnection);
        const schema = await introspector.introspectSchema('public');
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
        const checker = new PreflightChecker(dbConnection);
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

        await dbConnection.close();
        process.exit(result.valid ? 0 : 2);
      } catch (error) {
        console.error(chalk.red('Preflight error:'), (error as Error).message);
        process.exit(1);
      }
    });

  program
    .command('generate')
    .description('Generate TypeScript code from database schema')
    .requiredOption('-h, --host <host>', 'Database host')
    .requiredOption('-p, --port <port>', 'Database port', '5432')
    .requiredOption('-d, --database <database>', 'Database name')
    .requiredOption('-u, --username <username>', 'Database username')
    .requiredOption('-w, --password <password>', 'Database password')
    .option('-s, --schema <schema>', 'Schema name', 'public')
    .option('-o, --output <output>', 'Output directory', './generated')
    .option('--ssl', 'Use SSL connection', false)
    .option('--models', 'Generate model interfaces', true)
    .option('--repositories', 'Generate repository classes', true)
    .option('--services', 'Generate service classes', true)
    .option('--validators', 'Generate validation schemas', false)
    .option('--convex', 'Generate Convex schemas', false)
    .option('--zod', 'Use Zod for validation', false)
    .option('--class-validator', 'Use class-validator for validation', false)
    .action(async (options) => {
      const dbConfig: DatabaseConfig = {
        host: options.host,
        port: parseInt(options.port),
        database: options.database,
        username: options.username,
        password: options.password,
        ssl: options.ssl,
      };

      const generatorOptions: GeneratorOptions = {
        outputDir: options.output,
        generateModels: options.models,
        generateRepositories: options.repositories,
        generateServices: options.services,
        generateValidators: options.validators,
        generateConvexSchema: options.convex,
        generateMigrations: false,
        useZod: options.zod,
        useClassValidator: options.classValidator,
      };

      await generateCodeFromDatabase(dbConfig, generatorOptions);
    });

  program
    .command('introspect')
    .description('Introspect database schema and display information')
    .requiredOption('-h, --host <host>', 'Database host')
    .requiredOption('-p, --port <port>', 'Database port', '5432')
    .requiredOption('-d, --database <database>', 'Database name')
    .requiredOption('-u, --username <username>', 'Database username')
    .requiredOption('-w, --password <password>', 'Database password')
    .option('-s, --schema <schema>', 'Schema name', 'public')
    .option('--ssl', 'Use SSL connection', false)
    .option('--json', 'Output as JSON', false)
    .action(async (options) => {
      const { DatabaseConnection } = await import('./config/database.js');
      const { SchemaIntrospector } = await import(
        './introspector/schema-introspector.js'
      );

      const dbConfig: DatabaseConfig = {
        host: options.host,
        port: parseInt(options.port),
        database: options.database,
        username: options.username,
        password: options.password,
        ssl: options.ssl,
      };

      const dbConnection = new DatabaseConnection(dbConfig);
      const introspector = new SchemaIntrospector(dbConnection);

      try {
        console.log('Connecting to database...');
        if (await dbConnection.testConnection()) {
          console.log('Connection successful!');

          const schema = await introspector.introspectSchema(options.schema);

          if (options.json) {
            console.log(JSON.stringify(schema, null, 2));
          } else {
            console.log(`\nSchema: ${schema.schemaName}`);
            console.log(`Tables: ${schema.tables.length}`);
            console.log(`Views: ${schema.views.length}`);

            schema.tables.forEach((table) => {
              console.log(`\n📄 Table: ${table.tableName}`);
              console.log(`  Columns: ${table.columns.length}`);
              console.log(
                `  Primary Keys: ${table.primaryKeys.join(', ') || 'None'}`
              );
              console.log(`  Foreign Keys: ${table.foreignKeys.length}`);
              console.log(`  Indexes: ${table.indexes.length}`);

              table.columns.forEach((col) => {
                const nullable = col.isNullable ? '?' : '';
                const pk = col.isPrimaryKey ? ' [PK]' : '';
                const fk = col.isForeignKey ? ' [FK]' : '';
                console.log(
                  `    ${col.columnName}${nullable}: ${col.dataType}${pk}${fk}`
                );
              });
            });
          }
        } else {
          console.error('Failed to connect to database');
          process.exit(1);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      } finally {
        await dbConnection.close();
      }
    });

  program
    .command('test-connection')
    .description('Test database connection')
    .requiredOption('-h, --host <host>', 'Database host')
    .requiredOption('-p, --port <port>', 'Database port', '5432')
    .requiredOption('-d, --database <database>', 'Database name')
    .requiredOption('-u, --username <username>', 'Database username')
    .requiredOption('-w, --password <password>', 'Database password')
    .option('--ssl', 'Use SSL connection', false)
    .action(async (options) => {
      const { DatabaseConnection } = await import('./config/database.js');

      const dbConfig: DatabaseConfig = {
        host: options.host,
        port: parseInt(options.port),
        database: options.database,
        username: options.username,
        password: options.password,
        ssl: options.ssl,
      };

      const dbConnection = new DatabaseConnection(dbConfig);

      try {
        console.log('Testing database connection...');
        if (await dbConnection.testConnection()) {
          console.log('✅ Connection successful!');
        } else {
          console.log('❌ Connection failed!');
          process.exit(1);
        }
      } catch (error) {
        console.error('❌ Connection error:', (error as Error).message);
        process.exit(1);
      } finally {
        await dbConnection.close();
      }
    });

  // Show logo on help
  program.on('--help', () => {
    console.log('');
    console.log(chalk.gray('  Examples:'));
    console.log('');
    console.log(chalk.cyan('    # Launch interactive TUI mode'));
    console.log('    $ sunsetter-aqm --tui');
    console.log('');
    console.log(chalk.cyan('    # Migrate PostgreSQL to Convex'));
    console.log(
      '    $ sunsetter-aqm migrate -c "postgresql://user:pass@localhost/db"'
    );
    console.log('');
    console.log(chalk.cyan('    # Migrate MySQL to Convex'));
    console.log(
      '    $ sunsetter-aqm migrate -c "mysql://user:pass@localhost/db"'
    );
    console.log('');
    console.log(chalk.cyan('    # Generate schema only'));
    console.log('    $ sunsetter-aqm migrate -c "..." -m schema-only');
    console.log('');
  });

  program.parse();
}
