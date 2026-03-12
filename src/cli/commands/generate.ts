/**
 * Generate Command
 *
 * Generates TypeScript code from database schema including models,
 * repositories, services, validators, and Convex schemas.
 *
 * Supports all database types via connection string:
 *   postgresql://user:pass@host:5432/db
 *   mysql://user:pass@host:3306/db
 *   sqlite:///path/to/db.sqlite
 *   mssql://user:pass@host:1433/db
 */

import { Command } from 'commander';
import {
  createAdapter,
  parseConnectionString,
} from '../../adapters/index.js';
import { SchemaIntrospector } from '../../introspector/schema-introspector.js';
import {
  CodeGenerator,
  GeneratorOptions,
} from '../../generator/code-generator.js';
import { TypeMapper } from '../../mapper/type-mapper.js';
import { toError } from '../../utils/errors.js';

export function createGenerateCommand(): Command {
  return new Command('generate')
    .description('Generate TypeScript code from database schema')
    .requiredOption(
      '-c, --connection <url>',
      'Database connection string (e.g. postgresql://user:pass@host:5432/db)'
    )
    .option(
      '-s, --schema <schema>',
      'Schema name (default: auto-detected from DB type)'
    )
    .option('-o, --output <output>', 'Output directory', './generated')
    .option('--models', 'Generate model interfaces', true)
    .option('--repositories', 'Generate repository classes', true)
    .option('--services', 'Generate service classes', true)
    .option('--validators', 'Generate validation schemas', false)
    .option('--convex', 'Generate Convex schemas', false)
    .option('--zod', 'Use Zod for validation', false)
    .option('--class-validator', 'Use class-validator for validation', false)
    .action(async (options) => {
      const adapterConfig = parseConnectionString(options.connection);
      const adapter = createAdapter(adapterConfig);
      const typeMapper = new TypeMapper({ dbType: adapterConfig.type });
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
      const codeGenerator = new CodeGenerator(generatorOptions, typeMapper);

      try {
        console.log('Testing database connection...');
        await adapter.connect();
        console.log('Connection successful!');

        // Use --schema if provided, otherwise adapter's default
        const schemaName = options.schema ?? adapter.getDefaultSchema();

        const introspector = new SchemaIntrospector(adapter);
        console.log('Introspecting database schema...');
        const schema = await introspector.introspectSchema(schemaName);

        console.log('Generating code...');
        await codeGenerator.generateFromSchema(schema);

        console.log('Code generation complete!');
      } catch (error) {
        console.error('Error during code generation:', toError(error).message);
        process.exit(1);
      } finally {
        await adapter.disconnect();
      }
    });
}
