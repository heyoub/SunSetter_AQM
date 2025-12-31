/**
 * Seed Export Command - Export PostgreSQL Data as Convex Seed Files
 *
 * Exports PostgreSQL data as Convex-compatible seed files for development/testing:
 * - Multiple output formats: JSONL, JSON, TypeScript
 * - Configurable row limits and sampling
 * - PII anonymization using faker.js patterns
 * - Generates ready-to-use Convex seed functions
 */

import { Command } from 'commander';
import { Pool } from 'pg';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import {
  SchemaIntrospector,
  type TableInfo,
  type ColumnInfo,
} from '../../introspector/schema-introspector.js';
import {
  type IDatabaseConnection,
  type EnhancedPoolConfig,
} from '../../config/database.js';
import {
  ProgressReporter,
  ExtendedLogLevel,
  ProgressReporterConfig,
} from '../progress/reporter.js';
import {
  formatError,
  MigrationError,
  ConfigurationError,
  ERROR_CODES,
  createConnectionError,
} from '../errors/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Command line options for seed-export
 */
interface SeedExportOptions {
  connection?: string;
  tables?: string;
  output?: string;
  format?: 'jsonl' | 'json' | 'ts';
  limit?: string;
  anonymize?: boolean;
  sample?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  debug?: boolean;
  json?: boolean;
  noColor?: boolean;
}

/**
 * Anonymizer configuration for PII fields
 */
interface AnonymizerConfig {
  emailFields: string[];
  nameFields: string[];
  phoneFields: string[];
  addressFields: string[];
}

/**
 * Default field patterns for PII detection
 */
const DEFAULT_PII_PATTERNS: AnonymizerConfig = {
  emailFields: [
    'email',
    'email_address',
    'user_email',
    'contact_email',
    'e_mail',
  ],
  nameFields: [
    'name',
    'first_name',
    'last_name',
    'full_name',
    'firstname',
    'lastname',
    'fullname',
    'username',
    'user_name',
    'display_name',
    'author_name',
  ],
  phoneFields: [
    'phone',
    'phone_number',
    'mobile',
    'mobile_number',
    'cell',
    'telephone',
    'tel',
    'contact_phone',
  ],
  addressFields: [
    'address',
    'street',
    'street_address',
    'city',
    'state',
    'zip',
    'zipcode',
    'zip_code',
    'postal_code',
    'country',
  ],
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a DatabaseConnection wrapper for a Pool
 */
function createDbConnectionWrapper(pool: Pool): IDatabaseConnection {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async testConnection(): Promise<boolean> {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
    getConfig(): Omit<EnhancedPoolConfig, 'password'> {
      const poolWithConfig = pool as Pool & {
        options?: {
          host?: string;
          port?: number;
          database?: string;
          user?: string;
        };
      };
      return {
        host: poolWithConfig.options?.host || 'unknown',
        port: poolWithConfig.options?.port || 5432,
        database: poolWithConfig.options?.database || 'unknown',
        username: poolWithConfig.options?.user || 'unknown',
      } as Omit<EnhancedPoolConfig, 'password'>;
    },
  };
}

/**
 * Determine log level from options
 */
function getLogLevel(options: SeedExportOptions): ExtendedLogLevel {
  if (options.debug) return 'debug';
  if (options.verbose) return 'verbose';
  if (options.quiet) return 'quiet';
  return 'normal';
}

/**
 * Create reporter configuration from options
 */
function createReporterConfig(
  options: SeedExportOptions
): Partial<ProgressReporterConfig> {
  return {
    logLevel: getLogLevel(options),
    json: options.json || false,
    showTimestamps: false,
    colors: !options.noColor,
    interactive: process.stdout.isTTY && !options.json && !options.quiet,
  };
}

/**
 * Get connection string from options or environment
 */
function getConnectionString(
  options: SeedExportOptions,
  _reporter: ProgressReporter
): string {
  const connectionString =
    options.connection ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.PG_CONNECTION_STRING;

  if (!connectionString) {
    throw new ConfigurationError(
      'No database connection provided',
      ERROR_CODES.CONFIG_MISSING_REQUIRED,
      {
        details: {
          hint: 'Set DATABASE_URL environment variable or use --connection flag',
          envVars: ['DATABASE_URL', 'POSTGRES_URL', 'PG_CONNECTION_STRING'],
        },
      }
    );
  }

  return connectionString;
}

/**
 * Parse numeric option with validation
 */
function parseNumericOption(
  value: string | undefined,
  name: string,
  min: number,
  max: number,
  defaultValue: number
): number {
  if (!value) return defaultValue;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new ConfigurationError(
      `Invalid ${name}: "${value}" is not a valid number`,
      ERROR_CODES.CONFIG_INVALID,
      { details: { option: name, value, expected: 'number' } }
    );
  }

  if (parsed < min || parsed > max) {
    throw new ConfigurationError(
      `Invalid ${name}: ${parsed} is out of range (${min}-${max})`,
      ERROR_CODES.CONFIG_INVALID,
      { details: { option: name, value: parsed, min, max } }
    );
  }

  return parsed;
}

/**
 * Convert PostgreSQL column name to camelCase for Convex
 */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert table name to PascalCase
 */
function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Check if a column name matches a PII pattern
 */
function matchesPiiPattern(columnName: string, patterns: string[]): boolean {
  const lowerName = columnName.toLowerCase();
  return patterns.some(
    (pattern) => lowerName.includes(pattern) || lowerName === pattern
  );
}

/**
 * Simple deterministic pseudo-random generator for consistent anonymization
 */
function seededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  return function () {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return hash / 0x7fffffff;
  };
}

/**
 * Generate a fake email based on seed
 */
function generateFakeEmail(seed: string): string {
  const random = seededRandom(seed);
  const firstNames = [
    'john',
    'jane',
    'bob',
    'alice',
    'charlie',
    'diana',
    'eve',
    'frank',
  ];
  const lastNames = [
    'smith',
    'doe',
    'johnson',
    'williams',
    'brown',
    'jones',
    'miller',
  ];
  const domains = ['example.com', 'test.com', 'demo.org', 'sample.net'];

  const firstName = firstNames[Math.floor(random() * firstNames.length)];
  const lastName = lastNames[Math.floor(random() * lastNames.length)];
  const domain = domains[Math.floor(random() * domains.length)];
  const num = Math.floor(random() * 1000);

  return `${firstName}.${lastName}${num}@${domain}`;
}

/**
 * Generate a fake name based on seed
 */
function generateFakeName(
  seed: string,
  isFirstName: boolean = false,
  isLastName: boolean = false
): string {
  const random = seededRandom(seed);
  const firstNames = [
    'John',
    'Jane',
    'Robert',
    'Alice',
    'Charles',
    'Diana',
    'Edward',
    'Fiona',
  ];
  const lastNames = [
    'Smith',
    'Doe',
    'Johnson',
    'Williams',
    'Brown',
    'Jones',
    'Miller',
    'Davis',
  ];

  const firstName = firstNames[Math.floor(random() * firstNames.length)];
  const lastName = lastNames[Math.floor(random() * lastNames.length)];

  if (isFirstName) return firstName;
  if (isLastName) return lastName;
  return `${firstName} ${lastName}`;
}

/**
 * Generate a fake phone number based on seed
 */
function generateFakePhone(seed: string): string {
  const random = seededRandom(seed);
  const areaCode = Math.floor(random() * 900) + 100;
  const prefix = Math.floor(random() * 900) + 100;
  const lineNumber = Math.floor(random() * 9000) + 1000;

  return `+1-${areaCode}-${prefix}-${lineNumber}`;
}

/**
 * Generate a fake address component based on seed
 */
function generateFakeAddress(seed: string, columnName: string): string {
  const random = seededRandom(seed);
  const lowerName = columnName.toLowerCase();

  if (lowerName.includes('street') || lowerName === 'address') {
    const numbers = Math.floor(random() * 9999) + 1;
    const streets = [
      'Main St',
      'Oak Ave',
      'Maple Dr',
      'Cedar Ln',
      'Pine Rd',
      'Elm Blvd',
    ];
    return `${numbers} ${streets[Math.floor(random() * streets.length)]}`;
  }
  if (lowerName.includes('city')) {
    const cities = [
      'Springfield',
      'Riverside',
      'Fairview',
      'Greenville',
      'Franklin',
      'Clinton',
    ];
    return cities[Math.floor(random() * cities.length)];
  }
  if (lowerName.includes('state')) {
    const states = ['CA', 'NY', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA'];
    return states[Math.floor(random() * states.length)];
  }
  if (lowerName.includes('zip') || lowerName.includes('postal')) {
    return String(Math.floor(random() * 90000) + 10000);
  }
  if (lowerName.includes('country')) {
    const countries = [
      'United States',
      'Canada',
      'United Kingdom',
      'Australia',
    ];
    return countries[Math.floor(random() * countries.length)];
  }

  return `Anonymized Address ${Math.floor(random() * 1000)}`;
}

/**
 * Anonymize a single value based on column type
 */
function anonymizeValue(
  value: unknown,
  columnName: string,
  rowId: string,
  config: AnonymizerConfig
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const seed = `${columnName}-${rowId}-${String(value)}`;
  const lowerName = columnName.toLowerCase();

  // Check for email patterns
  if (matchesPiiPattern(columnName, config.emailFields)) {
    return generateFakeEmail(seed);
  }

  // Check for name patterns
  if (matchesPiiPattern(columnName, config.nameFields)) {
    const isFirstName = lowerName.includes('first');
    const isLastName = lowerName.includes('last');
    return generateFakeName(seed, isFirstName, isLastName);
  }

  // Check for phone patterns
  if (matchesPiiPattern(columnName, config.phoneFields)) {
    return generateFakePhone(seed);
  }

  // Check for address patterns
  if (matchesPiiPattern(columnName, config.addressFields)) {
    return generateFakeAddress(seed, columnName);
  }

  return value;
}

/**
 * Transform a row for Convex compatibility
 */
function transformRow(
  row: Record<string, unknown>,
  columns: ColumnInfo[],
  shouldAnonymize: boolean,
  piiConfig: AnonymizerConfig
): Record<string, unknown> {
  const transformed: Record<string, unknown> = {};

  // Get a row identifier for consistent anonymization
  const rowId = String(row.id || row._id || JSON.stringify(row).slice(0, 50));

  for (const column of columns) {
    const value = row[column.columnName];
    const camelKey = toCamelCase(column.columnName);

    let transformedValue = value;

    // Handle special PostgreSQL types
    if (value instanceof Date) {
      transformedValue = value.toISOString();
    } else if (Buffer.isBuffer(value)) {
      // Convert bytea to base64
      transformedValue = value.toString('base64');
    } else if (typeof value === 'bigint') {
      // Convert bigint to number (with potential precision loss warning)
      transformedValue = Number(value);
    }

    // Apply anonymization if enabled
    if (
      shouldAnonymize &&
      transformedValue !== null &&
      transformedValue !== undefined
    ) {
      transformedValue = anonymizeValue(
        transformedValue,
        column.columnName,
        rowId,
        piiConfig
      );
    }

    transformed[camelKey] = transformedValue;
  }

  return transformed;
}

/**
 * Fetch data from a table with optional limit and sampling
 */
async function fetchTableData(
  pool: Pool,
  tableName: string,
  schemaName: string,
  limit: number,
  sample: boolean
): Promise<Record<string, unknown>[]> {
  let query: string;

  if (sample) {
    // Use TABLESAMPLE for random sampling (PostgreSQL 9.5+)
    // Calculate approximate percentage needed
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM "${schemaName}"."${tableName}"`
    );
    const totalRows = parseInt(countResult.rows[0].count, 10);

    if (totalRows <= limit) {
      query = `SELECT * FROM "${schemaName}"."${tableName}"`;
    } else {
      // Use random ordering for consistent random sample
      query = `SELECT * FROM "${schemaName}"."${tableName}" ORDER BY RANDOM() LIMIT ${limit}`;
    }
  } else {
    query = `SELECT * FROM "${schemaName}"."${tableName}" LIMIT ${limit}`;
  }

  const result = await pool.query(query);
  return result.rows;
}

/**
 * Write data in JSONL format
 */
async function writeJsonl(
  filePath: string,
  data: Record<string, unknown>[]
): Promise<void> {
  const lines = data.map((row) => JSON.stringify(row));
  await fs.promises.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Write data in JSON format
 */
async function writeJson(
  filePath: string,
  data: Record<string, unknown>[]
): Promise<void> {
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Generate the seed/index.ts file
 */
function generateSeedIndexTs(tableNames: string[]): string {
  const imports = tableNames
    .map((name) => `import ${toCamelCase(name)}Data from "./${name}.json";`)
    .join('\n');

  const seedFunctions = tableNames
    .map((name) => {
      const camelName = toCamelCase(name);
      return `
export const seed${toPascalCase(name)} = mutation({
  handler: async (ctx) => {
    let count = 0;
    for (const item of ${camelName}Data) {
      await ctx.db.insert("${name}", item);
      count++;
    }
    return { table: "${name}", inserted: count };
  },
});`;
    })
    .join('\n');

  const allTableInserts = tableNames
    .map((name) => {
      const camelName = toCamelCase(name);
      return `    for (const item of ${camelName}Data) {
      await ctx.db.insert("${name}", item);
      inserted++;
    }`;
    })
    .join('\n');

  return `/**
 * Convex Seed Functions
 *
 * Auto-generated seed data for development and testing.
 *
 * Usage:
 *   - Import and call seedAll() to seed all tables
 *   - Or call individual seed functions: seed${toPascalCase(tableNames[0] || 'Table')}(), etc.
 *
 * From the Convex dashboard or CLI:
 *   npx convex run seed:seedAll
 *   npx convex run seed:seed${toPascalCase(tableNames[0] || 'Table')}
 */

import { mutation } from "../_generated/server";
${imports}

/**
 * Seed all tables with sample data
 */
export const seedAll = mutation({
  handler: async (ctx) => {
    let inserted = 0;
${allTableInserts}
    return { totalInserted: inserted };
  },
});

/**
 * Clear all seeded data from all tables
 */
export const clearAll = mutation({
  handler: async (ctx) => {
    let deleted = 0;
${tableNames
  .map(
    (
      name
    ) => `    const ${toCamelCase(name)}Docs = await ctx.db.query("${name}").collect();
    for (const doc of ${toCamelCase(name)}Docs) {
      await ctx.db.delete(doc._id);
      deleted++;
    }`
  )
  .join('\n')}
    return { totalDeleted: deleted };
  },
});
${seedFunctions}
`;
}

/**
 * Generate the seed/README.md file
 */
function generateSeedReadme(
  tableNames: string[],
  format: string,
  rowCount: Record<string, number>
): string {
  const tableList = tableNames
    .map(
      (name) =>
        `- \`${name}.${format === 'ts' ? 'json' : format}\` - ${rowCount[name] || 0} rows`
    )
    .join('\n');

  return `# Convex Seed Data

This directory contains seed data for your Convex database, exported from PostgreSQL.

## Files

${tableList}
- \`index.ts\` - Convex mutation functions for seeding

## Usage

### From the Convex Dashboard

1. Navigate to your Convex dashboard
2. Go to the Functions tab
3. Find the \`seed:seedAll\` function
4. Click "Run" to seed all tables

### From the CLI

\`\`\`bash
# Seed all tables
npx convex run seed:seedAll

# Seed a specific table
npx convex run seed:seed${toPascalCase(tableNames[0] || 'Table')}

# Clear all seeded data
npx convex run seed:clearAll
\`\`\`

### Programmatically

\`\`\`typescript
import { api } from "../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

const client = new ConvexHttpClient(process.env.CONVEX_URL!);

// Seed all tables
await client.mutation(api.seed.seedAll);

// Seed a specific table
await client.mutation(api.seed.seed${toPascalCase(tableNames[0] || 'Table')});
\`\`\`

## Data Format

The seed data is stored in ${format.toUpperCase()} format with the following transformations:

- Column names are converted from snake_case to camelCase
- Dates are stored as ISO 8601 strings
- Binary data is stored as base64-encoded strings
- BigInt values are converted to numbers

  ${
    tableNames.length > 0
      ? `## Tables

${tableNames
  .map((name) => `### ${name}\n\nRows: ${rowCount[name] || 0}`)
  .join('\n\n')}`
      : ''
  }

## Regenerating Seed Data

To regenerate seed data from PostgreSQL:

\`\`\`bash
# Export all tables (max 1000 rows each)
db.aqm seed-export --connection "postgresql://..." --output ./convex/seed

# Export specific tables
db.aqm seed-export --connection "..." --tables users,posts --limit 500

# Export with anonymization
db.aqm seed-export --connection "..." --anonymize

# Export random sample instead of first N rows
db.aqm seed-export --connection "..." --sample --limit 100
\`\`\`

## Notes

- Seed data is intended for development and testing only
- Do not commit sensitive production data to version control
- If using \`--anonymize\`, PII fields are replaced with fake data
`;
}

// ============================================================================
// Command Creation
// ============================================================================

/**
 * Create the seed-export command
 */
export function createSeedExportCommand(): Command {
  const command = new Command('seed-export')
    .description(
      `Export PostgreSQL data as Convex-compatible seed files

${chalk.bold('Examples:')}
  ${chalk.gray('# Export all tables with default settings')}
  $ db.aqm seed-export --connection "postgresql://user:pass@localhost/db"

  ${chalk.gray('# Export specific tables with limit')}
  $ db.aqm seed-export -c "..." --tables users,posts --limit 500

  ${chalk.gray('# Export with PII anonymization')}
  $ db.aqm seed-export -c "..." --anonymize

  ${chalk.gray('# Export random sample of data')}
  $ db.aqm seed-export -c "..." --sample --limit 100

  ${chalk.gray('# Export as TypeScript (with typed data)')}
  $ db.aqm seed-export -c "..." --format ts

${chalk.bold('Environment Variables:')}
  DATABASE_URL       PostgreSQL connection string
`
    )
    .addHelpText(
      'after',
      `
${chalk.bold('Output Formats:')}
  ${chalk.cyan('jsonl')}   JSON Lines format - one JSON object per line (default)
  ${chalk.cyan('json')}    Standard JSON array format
  ${chalk.cyan('ts')}      TypeScript module with typed exports

${chalk.bold('Output Files:')}
  seed/<table>.jsonl    Data in JSON Lines format
  seed/index.ts         TypeScript module with seed functions
  seed/README.md        Usage instructions

${chalk.bold('Anonymization:')}
  When --anonymize is enabled, the following fields are detected and
  replaced with fake data:
  - Email fields (email, email_address, etc.)
  - Name fields (name, first_name, last_name, etc.)
  - Phone fields (phone, mobile, telephone, etc.)
  - Address fields (address, city, state, zip, etc.)

${chalk.bold('Sampling:')}
  Use --sample to get a random sample of rows instead of the first N rows.
  This uses PostgreSQL's random ordering for true randomness.
`
    )

    // Connection options
    .option(
      '-c, --connection <string>',
      'PostgreSQL connection string',
      undefined
    )

    // Table selection
    .option(
      '-t, --tables <list>',
      'Comma-separated list of tables to export (default: all)'
    )

    // Output options
    .option(
      '-o, --output <dir>',
      'Output directory for seed files',
      './convex/seed'
    )
    .option('-f, --format <format>', 'Output format: jsonl, json, ts', 'jsonl')

    // Data options
    .option('-l, --limit <number>', 'Maximum rows per table (1-100000)', '1000')
    .option(
      '-a, --anonymize',
      'Anonymize PII fields (emails, names, phones, addresses)'
    )
    .option('-s, --sample', 'Random sample instead of first N rows')

    // Logging options
    .option('-v, --verbose', 'Enable verbose output')
    .option('-q, --quiet', 'Minimal output (errors only)')
    .option('--debug', 'Enable debug output (very verbose)')
    .option('--json', 'Output logs as JSON (for CI/CD)')
    .option('--no-color', 'Disable colored output')

    .action(runSeedExportCommand);

  return command;
}

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Run the seed-export command
 */
async function runSeedExportCommand(options: SeedExportOptions): Promise<void> {
  const reporter = new ProgressReporter(createReporterConfig(options));

  try {
    // Show welcome banner
    reporter.printWelcome('PostgreSQL Seed Data Export', '1.0.0');

    // Validate format option
    const validFormats = ['jsonl', 'json', 'ts'];
    const format = options.format || 'jsonl';
    if (!validFormats.includes(format)) {
      throw new ConfigurationError(
        `Invalid format: "${format}"`,
        ERROR_CODES.CONFIG_INVALID,
        { details: { validFormats, provided: format } }
      );
    }

    // Parse options
    const connectionString = getConnectionString(options, reporter);
    const limit = parseNumericOption(options.limit, 'limit', 1, 100000, 1000);
    const outputDir = options.output || './convex/seed';
    const shouldAnonymize = options.anonymize || false;
    const shouldSample = options.sample || false;

    reporter.debug('Export configuration', {
      outputDir,
      format,
      limit,
      anonymize: shouldAnonymize,
      sample: shouldSample,
    });

    // Connect to database
    reporter.startSpinner('Connecting to database...');
    const pool = new Pool({ connectionString });

    try {
      await pool.query('SELECT 1');
      reporter.succeedSpinner('Connected to database');
    } catch (error) {
      reporter.failSpinner('Failed to connect to database');
      throw createConnectionError(error as Error);
    }

    // Introspect schema
    reporter.startSpinner('Introspecting schema...');
    const dbConnection = createDbConnectionWrapper(pool);
    const introspector = new SchemaIntrospector(dbConnection);
    const schema = await introspector.introspectSchema('public');
    let tables = schema.tables;

    // Filter tables if specified
    if (options.tables) {
      const tableList = options.tables
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const tableSet = new Set(tableList);
      tables = tables.filter((t: TableInfo) => tableSet.has(t.tableName));

      if (tables.length === 0) {
        reporter.failSpinner('No matching tables found');
        throw new ConfigurationError(
          `None of the specified tables were found: ${tableList.join(', ')}`,
          ERROR_CODES.TABLE_NOT_FOUND,
          {
            details: {
              requested: tableList,
              available: schema.tables.map((t: TableInfo) => t.tableName),
            },
          }
        );
      }
    }

    reporter.succeedSpinner(`Found ${tables.length} tables to export`);

    // Create output directory
    reporter.startSpinner(`Creating output directory: ${outputDir}`);
    await fs.promises.mkdir(outputDir, { recursive: true });
    reporter.succeedSpinner('Output directory ready');

    // Export each table
    reporter.section('Exporting Tables');
    const exportedTables: string[] = [];
    const rowCounts: Record<string, number> = {};
    const piiConfig = DEFAULT_PII_PATTERNS;

    for (const table of tables) {
      reporter.startSpinner(`Exporting ${table.tableName}...`);

      try {
        // Fetch data
        const rows = await fetchTableData(
          pool,
          table.tableName,
          table.schemaName,
          limit,
          shouldSample
        );

        // Transform rows
        const transformedRows = rows.map((row) =>
          transformRow(row, table.columns, shouldAnonymize, piiConfig)
        );

        // Determine file extension
        const fileExt = format === 'ts' ? 'json' : format;
        const filePath = path.join(outputDir, `${table.tableName}.${fileExt}`);

        // Write data
        if (format === 'jsonl') {
          await writeJsonl(filePath, transformedRows);
        } else {
          await writeJson(filePath, transformedRows);
        }

        exportedTables.push(table.tableName);
        rowCounts[table.tableName] = transformedRows.length;
        reporter.succeedSpinner(
          `${table.tableName}: ${transformedRows.length} rows exported`
        );
      } catch (error) {
        reporter.failSpinner(`Failed to export ${table.tableName}`);
        reporter.error(`Error: ${(error as Error).message}`);
        // Continue with other tables
      }
    }

    // Generate index.ts
    if (exportedTables.length > 0) {
      reporter.startSpinner('Generating seed/index.ts...');
      const indexTs = generateSeedIndexTs(exportedTables);
      const indexPath = path.join(outputDir, 'index.ts');
      await fs.promises.writeFile(indexPath, indexTs, 'utf-8');
      reporter.succeedSpinner('Generated seed/index.ts');

      // Generate README.md
      reporter.startSpinner('Generating seed/README.md...');
      const readme = generateSeedReadme(exportedTables, format, rowCounts);
      const readmePath = path.join(outputDir, 'README.md');
      await fs.promises.writeFile(readmePath, readme, 'utf-8');
      reporter.succeedSpinner('Generated seed/README.md');
    }

    // Close database connection
    await pool.end();

    // Print summary
    const totalRows = Object.values(rowCounts).reduce(
      (sum, count) => sum + count,
      0
    );
    reporter.printSummary({
      'Tables exported': exportedTables.length,
      'Total rows': totalRows,
      'Output directory': outputDir,
      Format: format.toUpperCase(),
      Anonymized: shouldAnonymize ? 'Yes' : 'No',
      Sampled: shouldSample ? 'Yes' : 'No',
    });

    // Print files generated
    if (exportedTables.length > 0) {
      reporter.subsection('Files Generated:');
      for (const tableName of exportedTables) {
        const fileExt = format === 'ts' ? 'json' : format;
        reporter.fileGenerated(`${outputDir}/${tableName}.${fileExt}`);
      }
      reporter.fileGenerated(`${outputDir}/index.ts`);
      reporter.fileGenerated(`${outputDir}/README.md`);

      reporter.box(
        `Seed data exported to ${outputDir}/\n\nNext steps:\n  1. Review the generated files\n  2. Run \`npx convex run seed:seedAll\` to seed your database\n  3. Use seed data for development and testing`,
        'success'
      );
    } else {
      reporter.box(
        'No tables were exported. Check your table selection.',
        'warning'
      );
    }
  } catch (error: unknown) {
    if (error instanceof MigrationError) {
      console.error(
        formatError(error, {
          verbose: options.verbose || options.debug,
          colors: !options.noColor,
        })
      );
    } else {
      reporter.error('Unexpected error', error as Error);
    }
    process.exit(1);
  } finally {
    reporter.close();
  }
}
