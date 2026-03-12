/**
 * Introspect Command
 *
 * Introspects database schema and displays table, column, key,
 * and index information. Supports all database types via connection string.
 */

import { Command } from 'commander';
import {
  createAdapter,
  parseConnectionString,
} from '../../adapters/index.js';
import { SchemaIntrospector } from '../../introspector/schema-introspector.js';
import { toError } from '../../utils/errors.js';

export function createIntrospectCommand(): Command {
  return new Command('introspect')
    .description('Introspect database schema and display information')
    .requiredOption(
      '-c, --connection <url>',
      'Database connection string (e.g. postgresql://user:pass@host:5432/db)'
    )
    .option(
      '-s, --schema <schema>',
      'Schema name (default: auto-detected from DB type)'
    )
    .option('--json', 'Output as JSON', false)
    .action(async (options) => {
      const adapterConfig = parseConnectionString(options.connection);
      const adapter = createAdapter(adapterConfig);

      try {
        console.log('Connecting to database...');
        await adapter.connect();
        console.log('Connection successful!');

        // Use --schema if provided, otherwise adapter's default
        const schemaName = options.schema ?? adapter.getDefaultSchema();

        const introspector = new SchemaIntrospector(adapter);
        const schema = await introspector.introspectSchema(schemaName);

        if (options.json) {
          console.log(JSON.stringify(schema, null, 2));
        } else {
          console.log(`\nDatabase type: ${adapterConfig.type}`);
          console.log(`Schema: ${schema.schemaName}`);
          console.log(`Tables: ${schema.tables.length}`);
          console.log(`Views: ${schema.views.length}`);

          schema.tables.forEach((table) => {
            console.log(`\nTable: ${table.tableName}`);
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
      } catch (error) {
        console.error('Error:', toError(error).message);
        process.exit(1);
      } finally {
        await adapter.disconnect();
      }
    });
}
