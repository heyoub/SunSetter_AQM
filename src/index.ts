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
import * as fs from 'fs/promises';
import { generateCodeFromDatabase } from './cli/generate.js';
import { DatabaseConfig } from './config/database.js';
import { GeneratorOptions } from './generator/code-generator.js';
import { createMigrateCommand } from './cli/commands/migrate.js';
import { createSeedExportCommand } from './cli/commands/seed-export.js';
import {
  loadConfig,
  generateSampleConfig,
  validateConfig,
} from './config/config-loader.js';
import {
  createSuccessOutput,
  createErrorOutput,
  printJson,
} from './cli/output/json-output.js';
import { printFullHelp } from './cli/help.js';
import {
  sunsetGradient,
  APP_NAME,
  APP_TAGLINE,
  VERSION,
} from './tui/branding.js';

const program = new Command();

// Check for special flags first (before Commander parsing)
const args = process.argv.slice(2);

// Handle --mcp flag for MCP server mode
if (args.includes('--mcp')) {
  import('./mcp/server.js').then(({ startMcpServer }) => {
    startMcpServer().catch(console.error);
  });
} else if (
  args.includes('--tui') ||
  args.includes('-i') ||
  args.includes('--interactive')
) {
  // Launch TUI mode
  import('./tui/app.js').then(({ launchTUI }) => {
    launchTUI().catch(console.error);
  });
} else if (args.includes('--help-full') || args.includes('--help-all')) {
  // Show full help with all examples
  printFullHelp();
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
    .version(VERSION, '-v, --version', 'Display version number')
    .option('--tui, -i, --interactive', 'Launch interactive TUI mode')
    .option('--mcp', 'Start MCP server for Claude integration')
    .option('--json', 'Output results as JSON')
    .option('--no-color', 'Disable colored output')
    .option('--quiet', 'Minimal output (errors only)')
    .option('--verbose', 'Verbose output with debug info')
    .option('--config <path>', 'Path to config file')
    .option('--help-full', 'Show full help with all examples');

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

  // Add init command for config file creation
  program
    .command('init')
    .description('Create a configuration file (.sunsetterrc)')
    .option('-f, --force', 'Overwrite existing config file')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      const configPath = '.sunsetterrc';

      try {
        // Check if config already exists
        try {
          await fs.access(configPath);
          if (!options.force) {
            if (options.json) {
              printJson(
                createErrorOutput('init', {
                  code: 'CONFIG_EXISTS',
                  message:
                    'Config file already exists. Use --force to overwrite.',
                })
              );
            } else {
              console.error(
                chalk.red(
                  'Config file already exists. Use --force to overwrite.'
                )
              );
            }
            process.exit(1);
          }
        } catch {
          // File doesn't exist, continue
        }

        // Write sample config
        const sampleConfig = generateSampleConfig();
        await fs.writeFile(configPath, sampleConfig, 'utf-8');

        if (options.json) {
          printJson(
            createSuccessOutput('init', {
              configPath,
              message: 'Config file created successfully',
            })
          );
        } else {
          console.log(chalk.green('✅ Created .sunsetterrc'));
          console.log('');
          console.log(chalk.gray('Edit the file to configure your migration:'));
          console.log(chalk.cyan(`  ${configPath}`));
          console.log('');
          console.log(chalk.gray('Then run:'));
          console.log(chalk.cyan('  sunsetter-aqm migrate'));
        }
      } catch (error) {
        if (options.json) {
          printJson(createErrorOutput('init', error as Error));
        } else {
          console.error(
            chalk.red('Error creating config:'),
            (error as Error).message
          );
        }
        process.exit(1);
      }
    });

  // Add validate-config command
  program
    .command('validate-config')
    .description('Validate configuration file')
    .option('-c, --config <path>', 'Path to config file')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const loaded = await loadConfig(
          options.config ? options.config : process.cwd()
        );

        if (!loaded.path) {
          if (options.json) {
            printJson(
              createErrorOutput('validate-config', {
                code: 'NO_CONFIG',
                message: 'No configuration file found',
              })
            );
          } else {
            console.error(chalk.red('No configuration file found.'));
            console.log(chalk.gray('Run `sunsetter-aqm init` to create one.'));
          }
          process.exit(1);
        }

        const validation = validateConfig(loaded.config);

        if (options.json) {
          printJson(
            createSuccessOutput('validate-config', {
              valid: validation.valid,
              source: loaded.source,
              path: loaded.path,
              errors: validation.errors,
              config: loaded.config,
            })
          );
        } else {
          console.log(chalk.cyan(`Config file: ${loaded.path}`));
          console.log(chalk.gray(`Source: ${loaded.source}`));
          console.log('');

          if (validation.valid) {
            console.log(chalk.green('✅ Configuration is valid'));
          } else {
            console.log(chalk.red('❌ Configuration has errors:'));
            validation.errors.forEach((err) => {
              console.log(chalk.red(`  • ${err}`));
            });
          }
        }

        process.exit(validation.valid ? 0 : 1);
      } catch (error) {
        if (options.json) {
          printJson(createErrorOutput('validate-config', error as Error));
        } else {
          console.error(chalk.red('Error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });

  // Add doctor command for diagnostics
  program
    .command('doctor')
    .description('Check system requirements and diagnose issues')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      const checks: Array<{
        name: string;
        status: 'ok' | 'warn' | 'error';
        message: string;
      }> = [];

      // Check Node.js version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
      if (majorVersion >= 18) {
        checks.push({
          name: 'Node.js',
          status: 'ok',
          message: `${nodeVersion} (>= 18 required)`,
        });
      } else {
        checks.push({
          name: 'Node.js',
          status: 'error',
          message: `${nodeVersion} (>= 18 required)`,
        });
      }

      // Check for config file
      const configLoaded = await loadConfig();
      if (configLoaded.path) {
        checks.push({
          name: 'Config File',
          status: 'ok',
          message: `Found: ${configLoaded.source}`,
        });
      } else {
        checks.push({
          name: 'Config File',
          status: 'warn',
          message: 'Not found (optional)',
        });
      }

      // Check for convex directory
      try {
        await fs.access('./convex');
        checks.push({
          name: 'Convex Directory',
          status: 'ok',
          message: './convex exists',
        });
      } catch {
        checks.push({
          name: 'Convex Directory',
          status: 'warn',
          message: './convex not found (will be created)',
        });
      }

      // Check environment variables
      if (process.env.CONVEX_DEPLOYMENT) {
        checks.push({
          name: 'CONVEX_DEPLOYMENT',
          status: 'ok',
          message: 'Set',
        });
      } else {
        checks.push({
          name: 'CONVEX_DEPLOYMENT',
          status: 'warn',
          message: 'Not set (optional)',
        });
      }

      if (options.json) {
        const allOk = checks.every((c) => c.status !== 'error');
        printJson(
          createSuccessOutput('doctor', {
            healthy: allOk,
            checks,
          })
        );
      } else {
        console.log(chalk.bold('System Diagnostics'));
        console.log('');

        for (const check of checks) {
          const icon =
            check.status === 'ok'
              ? chalk.green('✓')
              : check.status === 'warn'
                ? chalk.yellow('⚠')
                : chalk.red('✗');
          const color =
            check.status === 'ok'
              ? chalk.green
              : check.status === 'warn'
                ? chalk.yellow
                : chalk.red;
          console.log(`  ${icon} ${check.name}: ${color(check.message)}`);
        }

        console.log('');
        const hasErrors = checks.some((c) => c.status === 'error');
        if (hasErrors) {
          console.log(
            chalk.red('Some checks failed. Please fix the issues above.')
          );
        } else {
          console.log(chalk.green('All checks passed!'));
        }
      }

      process.exit(checks.some((c) => c.status === 'error') ? 1 : 0);
    });

  // Add auth command for Convex authentication
  program
    .command('auth')
    .description('Authenticate with Convex')
    .option('--force', 'Force re-authentication even if credentials exist')
    .option('--check', 'Only check if credentials exist and are valid')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      const {
        authenticateConvex,
        detectExistingCredentials,
        validateCredentials,
        saveCredentials,
      } = await import('./cli/auth/convex-auth.js');

      try {
        if (options.check) {
          // Just check existing credentials
          const existing = await detectExistingCredentials();

          if (existing?.credentials?.deployKey) {
            const validation = await validateCredentials(existing.credentials);

            if (options.json) {
              printJson(
                createSuccessOutput('auth', {
                  authenticated: validation.valid,
                  source: existing.source,
                  deploymentUrl: existing.credentials.deploymentUrl,
                  projectName: validation.projectInfo?.name,
                  error: validation.error,
                })
              );
            } else {
              if (validation.valid) {
                console.log(chalk.green('✓ Authenticated with Convex'));
                console.log(
                  chalk.dim(`  Project: ${validation.projectInfo?.name}`)
                );
                console.log(chalk.dim(`  Source: ${existing.source}`));
              } else {
                console.log(chalk.red('✗ Credentials found but invalid'));
                console.log(chalk.dim(`  Error: ${validation.error}`));
              }
            }
            process.exit(validation.valid ? 0 : 1);
          } else {
            if (options.json) {
              printJson(
                createSuccessOutput('auth', {
                  authenticated: false,
                  error: 'No credentials found',
                })
              );
            } else {
              console.log(chalk.yellow('⚠ No Convex credentials found'));
              console.log(
                chalk.dim('  Run `sunsetter-aqm auth` to authenticate')
              );
            }
            process.exit(1);
          }
        } else {
          // Full authentication flow
          const result = await authenticateConvex({
            forceNew: options.force,
            onStatusChange: (status: string) => {
              if (!options.json) {
                console.log(status);
              }
            },
          });

          if (result.success && result.credentials) {
            // Validate credentials
            const validation = await validateCredentials(result.credentials);

            if (validation.valid) {
              // Save credentials
              await saveCredentials(result.credentials);

              if (options.json) {
                printJson(
                  createSuccessOutput('auth', {
                    authenticated: true,
                    source: result.source,
                    deploymentUrl: result.credentials.deploymentUrl,
                    projectName: validation.projectInfo?.name,
                    saved: true,
                  })
                );
              } else {
                console.log();
                console.log(
                  chalk.green('✓ Successfully authenticated with Convex!')
                );
                console.log(
                  chalk.dim(`  Project: ${validation.projectInfo?.name}`)
                );
                console.log(chalk.dim(`  Credentials saved to .env.local`));
              }
            } else {
              if (options.json) {
                printJson(
                  createErrorOutput('auth', {
                    code: 'INVALID_CREDENTIALS',
                    message: validation.error || 'Invalid credentials',
                  })
                );
              } else {
                console.log(chalk.red('✗ Credentials are invalid'));
                console.log(chalk.dim(`  Error: ${validation.error}`));
              }
              process.exit(1);
            }
          } else {
            if (options.json) {
              printJson(
                createErrorOutput('auth', {
                  code: 'AUTH_FAILED',
                  message: result.error || 'Authentication failed',
                })
              );
            } else {
              console.log(chalk.red('✗ Authentication failed'));
              console.log(chalk.dim(`  ${result.error}`));
            }
            process.exit(1);
          }
        }
      } catch (error) {
        if (options.json) {
          printJson(createErrorOutput('auth', error as Error));
        } else {
          console.error(chalk.red('Auth error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });

  // Enhanced help
  program.on('--help', () => {
    console.log('');
    console.log(chalk.bold.yellow('Quick Start:'));
    console.log('');
    console.log(chalk.cyan('  # Interactive mode (recommended):'));
    console.log('  $ sunsetter-aqm --tui');
    console.log('');
    console.log(chalk.cyan('  # Authenticate with Convex:'));
    console.log('  $ sunsetter-aqm auth');
    console.log('');
    console.log(chalk.cyan('  # Create config file:'));
    console.log('  $ sunsetter-aqm init');
    console.log('');
    console.log(chalk.cyan('  # Migrate PostgreSQL to Convex:'));
    console.log(
      '  $ sunsetter-aqm migrate -c "postgresql://user:pass@localhost/db"'
    );
    console.log('');
    console.log(chalk.cyan('  # Dry run (preview only):'));
    console.log('  $ sunsetter-aqm migrate -c "postgresql://..." --dry-run');
    console.log('');
    console.log(chalk.cyan('  # JSON output for CI/CD:'));
    console.log('  $ sunsetter-aqm migrate -c "postgresql://..." --json');
    console.log('');
    console.log(chalk.gray('For full help with all examples:'));
    console.log(chalk.cyan('  $ sunsetter-aqm --help-full'));
    console.log('');
    console.log(chalk.gray('Documentation: https://github.com/heyoub/SunSetter_AQM'));
    console.log('');
  });

  program.parse();
}
