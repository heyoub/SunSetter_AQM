#!/usr/bin/env node

import { Command } from 'commander';
import { generateCodeFromDatabase } from './cli/generate.js';
import { DatabaseConfig } from './config/database.js';
import { GeneratorOptions } from './generator/code-generator.js';
import { createMigrateCommand } from './cli/commands/migrate.js';

const program = new Command();

program
  .name('db.aqm')
  .description(
    'PostgreSQL to Convex Migration Tool - Generate schemas, queries, mutations, and migrate data'
  )
  .version('1.0.0');

// Add migrate command (main feature)
program.addCommand(createMigrateCommand());

program
  .command('generate')
  .description('Generate TypeScript code from PostgreSQL database schema')
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

program.parse();
