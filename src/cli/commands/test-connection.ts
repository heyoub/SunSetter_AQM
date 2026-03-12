/**
 * Test Connection Command
 *
 * Tests database connectivity with the provided connection string.
 * Supports all database types (PostgreSQL, MySQL, SQLite, MSSQL).
 */

import { Command } from 'commander';
import { createAdapter, parseConnectionString } from '../../adapters/index.js';
import { toError } from '../../utils/errors.js';

export function createTestConnectionCommand(): Command {
  return new Command('test-connection')
    .description('Test database connection')
    .requiredOption(
      '-c, --connection <url>',
      'Database connection string (e.g. postgresql://user:pass@host:5432/db)'
    )
    .action(async (options) => {
      const adapterConfig = parseConnectionString(options.connection);
      const adapter = createAdapter(adapterConfig);

      try {
        console.log(`Testing ${adapterConfig.type} connection...`);
        await adapter.connect();
        if (await adapter.testConnection()) {
          console.log('Connection successful!');
        } else {
          console.log('Connection failed!');
          process.exit(1);
        }
      } catch (error) {
        console.error('Connection error:', toError(error).message);
        process.exit(1);
      } finally {
        await adapter.disconnect();
      }
    });
}
