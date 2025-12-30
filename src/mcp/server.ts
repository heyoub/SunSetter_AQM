/**
 * SunSetter AQM+ MCP Server
 *
 * Model Context Protocol server for Claude Code, Claude Desktop, and VSCode integration.
 * Exposes database introspection, code generation, and migration tools.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import our core modules
import {
  createAdapter,
  DatabaseType,
  DatabaseConfig,
} from '../adapters/index.js';
import { APP_NAME, VERSION } from '../tui/branding.js';

/**
 * Parse a connection string into a DatabaseConfig
 */
function parseConnectionString(connectionString: string): DatabaseConfig {
  const url = new URL(connectionString);
  const protocol = url.protocol.replace(':', '').toLowerCase();

  let dbType: DatabaseType;
  switch (protocol) {
    case 'postgresql':
    case 'postgres':
      dbType = DatabaseType.POSTGRESQL;
      break;
    case 'mysql':
      dbType = DatabaseType.MYSQL;
      break;
    case 'sqlite':
      dbType = DatabaseType.SQLITE;
      break;
    case 'mssql':
    case 'sqlserver':
      dbType = DatabaseType.MSSQL;
      break;
    default:
      throw new Error(`Unsupported database protocol: ${protocol}`);
  }

  // For SQLite, the path is the filename
  if (dbType === DatabaseType.SQLITE) {
    return {
      type: dbType,
      database: url.pathname.replace(/^\/+/, ''),
      filename: url.pathname.replace(/^\/+/, ''),
    } as DatabaseConfig;
  }

  return {
    type: dbType,
    host: url.hostname,
    port:
      parseInt(url.port) ||
      (dbType === DatabaseType.MYSQL
        ? 3306
        : dbType === DatabaseType.MSSQL
          ? 1433
          : 5432),
    database: url.pathname.replace(/^\/+/, ''),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: url.searchParams.get('ssl') === 'true',
  } as DatabaseConfig;
}

// ============================================================================
// Server Configuration
// ============================================================================

const server = new Server(
  {
    name: 'sunsetter-aqm',
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// ============================================================================
// State Management
// ============================================================================

interface ServerState {
  connectionString?: string;
  outputDir?: string;
  selectedTables?: string[];
  lastIntrospection?: {
    tables: Array<{
      name: string;
      schema: string;
      rowCount: number;
      columns: Array<{ name: string; type: string; nullable: boolean }>;
    }>;
    timestamp: string;
  };
}

const state: ServerState = {
  outputDir: './convex',
};

// ============================================================================
// Tool Handlers
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'connect_database',
        description: `Connect to a source database for migration. Supports PostgreSQL, MySQL, SQLite, and SQL Server. This establishes the connection that will be used for introspection and migration.`,
        inputSchema: {
          type: 'object',
          properties: {
            connectionString: {
              type: 'string',
              description:
                'Database connection string. Examples:\n- PostgreSQL: postgresql://user:pass@localhost:5432/dbname\n- MySQL: mysql://user:pass@localhost:3306/dbname\n- SQLite: sqlite:///path/to/database.db\n- SQL Server: mssql://user:pass@localhost:1433/dbname',
            },
          },
          required: ['connectionString'],
        },
      },
      {
        name: 'introspect_schema',
        description: `Introspect the connected database schema. Returns all tables, columns, types, primary keys, foreign keys, and indexes. Use this to understand the database structure before migration.`,
        inputSchema: {
          type: 'object',
          properties: {
            schema: {
              type: 'string',
              description:
                'Schema name to introspect (default: "public" for PostgreSQL, "dbo" for SQL Server)',
              default: 'public',
            },
            includeRowCounts: {
              type: 'boolean',
              description:
                'Include row counts for each table (may be slow for large databases)',
              default: true,
            },
          },
        },
      },
      {
        name: 'generate_convex_schema',
        description: `Generate Convex schema.ts from the introspected database schema. Creates type-safe table definitions with validators.`,
        inputSchema: {
          type: 'object',
          properties: {
            tables: {
              type: 'array',
              items: { type: 'string' },
              description:
                'List of table names to include. If empty, includes all tables.',
            },
            outputDir: {
              type: 'string',
              description:
                'Output directory for generated files (default: ./convex)',
              default: './convex',
            },
          },
        },
      },
      {
        name: 'generate_convex_queries',
        description: `Generate Convex query functions for the selected tables. Creates type-safe queries with filtering, pagination, and search.`,
        inputSchema: {
          type: 'object',
          properties: {
            tables: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of table names to generate queries for',
            },
            includeSearch: {
              type: 'boolean',
              description: 'Include full-text search queries',
              default: true,
            },
            includePagination: {
              type: 'boolean',
              description: 'Include paginated list queries',
              default: true,
            },
          },
        },
      },
      {
        name: 'generate_convex_mutations',
        description: `Generate Convex mutation functions (create, update, delete) for the selected tables.`,
        inputSchema: {
          type: 'object',
          properties: {
            tables: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of table names to generate mutations for',
            },
            includeBatchOperations: {
              type: 'boolean',
              description: 'Include batch insert/update/delete mutations',
              default: true,
            },
          },
        },
      },
      {
        name: 'generate_convex_actions',
        description: `Generate Convex action functions for external API calls, background jobs, and complex operations.`,
        inputSchema: {
          type: 'object',
          properties: {
            tables: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of table names to generate actions for',
            },
            includeHttpActions: {
              type: 'boolean',
              description: 'Include HTTP webhook handlers',
              default: true,
            },
          },
        },
      },
      {
        name: 'estimate_migration',
        description: `Estimate migration time and resources based on table sizes and complexity. Provides optimistic, realistic, and pessimistic time estimates.`,
        inputSchema: {
          type: 'object',
          properties: {
            tables: {
              type: 'array',
              items: { type: 'string' },
              description:
                'List of table names to estimate (empty = all tables)',
            },
          },
        },
      },
      {
        name: 'validate_migration',
        description: `Validate that a migration can proceed. Checks for unsupported data types, missing primary keys, circular dependencies, and other potential issues.`,
        inputSchema: {
          type: 'object',
          properties: {
            tables: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of table names to validate',
            },
          },
        },
      },
      {
        name: 'preview_migration',
        description: `Preview what the migration will do without making any changes. Shows the Convex schema, queries, mutations, and data transformations that will be generated.`,
        inputSchema: {
          type: 'object',
          properties: {
            tables: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of table names to preview',
            },
            showSampleData: {
              type: 'boolean',
              description: 'Show sample data transformations',
              default: true,
            },
          },
        },
      },
      {
        name: 'get_table_info',
        description: `Get detailed information about a specific table including columns, types, constraints, indexes, and sample data.`,
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Name of the table to inspect',
            },
            includeSampleData: {
              type: 'boolean',
              description: 'Include sample rows from the table',
              default: true,
            },
            sampleSize: {
              type: 'number',
              description: 'Number of sample rows to include',
              default: 5,
            },
          },
          required: ['tableName'],
        },
      },
      {
        name: 'suggest_indexes',
        description: `Analyze table structure and suggest Convex indexes for optimal query performance.`,
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Name of the table to analyze',
            },
          },
          required: ['tableName'],
        },
      },
      {
        name: 'type_mapping_help',
        description: `Get help with SQL to Convex type mappings. Shows how SQL types are converted to Convex validators.`,
        inputSchema: {
          type: 'object',
          properties: {
            sqlType: {
              type: 'string',
              description:
                'Specific SQL type to look up (optional - shows all mappings if not provided)',
            },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'connect_database': {
        const { connectionString } = args as { connectionString: string };
        state.connectionString = connectionString;

        // Test the connection
        const adapter = createAdapter(parseConnectionString(connectionString));
        await adapter.connect();
        await adapter.disconnect();

        const dbType = connectionString.split('://')[0].toUpperCase();
        return {
          content: [
            {
              type: 'text',
              text: `✅ Successfully connected to ${dbType} database.\n\nYou can now use:\n- introspect_schema: to discover tables and columns\n- generate_convex_schema: to create Convex schema\n- estimate_migration: to get time estimates`,
            },
          ],
        };
      }

      case 'introspect_schema': {
        if (!state.connectionString) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ No database connected. Use connect_database first.',
              },
            ],
            isError: true,
          };
        }

        const { schema = 'public', includeRowCounts = true } = args as {
          schema?: string;
          includeRowCounts?: boolean;
        };

        const adapter = createAdapter(
          parseConnectionString(state.connectionString)
        );
        await adapter.connect();

        const tables = await adapter.getTables(schema);
        const tableInfos = [];

        for (const tableName of tables) {
          const columns = await adapter.getColumns(schema, tableName);
          const rowCount = includeRowCounts
            ? await adapter.getTableRowCount(schema, tableName)
            : 0;

          tableInfos.push({
            name: tableName,
            schema,
            rowCount,
            columns: columns.map((c) => ({
              name: c.columnName,
              type: c.dataType,
              nullable: c.isNullable,
            })),
          });
        }

        await adapter.disconnect();

        state.lastIntrospection = {
          tables: tableInfos,
          timestamp: new Date().toISOString(),
        };

        const summary = tableInfos
          .map(
            (t) =>
              `- ${t.name}: ${t.columns.length} columns, ${t.rowCount.toLocaleString()} rows`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `📊 Schema Introspection Complete\n\nFound ${tableInfos.length} tables in schema "${schema}":\n\n${summary}\n\nUse get_table_info for detailed column information, or generate_convex_schema to create Convex types.`,
            },
          ],
        };
      }

      case 'get_table_info': {
        if (!state.connectionString) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ No database connected. Use connect_database first.',
              },
            ],
            isError: true,
          };
        }

        const {
          tableName,
          includeSampleData = true,
          sampleSize = 5,
        } = args as {
          tableName: string;
          includeSampleData?: boolean;
          sampleSize?: number;
        };

        const adapter = createAdapter(
          parseConnectionString(state.connectionString)
        );
        await adapter.connect();

        const columns = await adapter.getColumns('public', tableName);
        const primaryKeys = await adapter.getPrimaryKeys('public', tableName);
        const indexes = await adapter.getIndexes('public', tableName);
        const rowCount = await adapter.getTableRowCount('public', tableName);

        let sampleData: unknown[] = [];
        if (includeSampleData && rowCount > 0) {
          const stream = adapter.streamRows('public', tableName, {
            batchSize: sampleSize,
          });
          for await (const batch of stream) {
            sampleData = batch.rows.slice(0, sampleSize);
            break;
          }
        }

        await adapter.disconnect();

        const columnDetails = columns
          .map((c) => {
            const pk = primaryKeys.includes(c.columnName) ? ' [PK]' : '';
            const nullable = c.isNullable ? ' (nullable)' : '';
            return `  - ${c.columnName}: ${c.dataType}${pk}${nullable}`;
          })
          .join('\n');

        const indexDetails =
          indexes.length > 0
            ? indexes
                .map((i) => `  - ${i.indexName}: (${i.columns.join(', ')})`)
                .join('\n')
            : '  (none)';

        const sampleDataStr =
          includeSampleData && sampleData.length > 0
            ? `\n\nSample Data (${sampleData.length} rows):\n${JSON.stringify(sampleData, null, 2)}`
            : '';

        return {
          content: [
            {
              type: 'text',
              text: `📋 Table: ${tableName}\n\nRow Count: ${rowCount.toLocaleString()}\n\nColumns:\n${columnDetails}\n\nIndexes:\n${indexDetails}${sampleDataStr}`,
            },
          ],
        };
      }

      case 'generate_convex_schema': {
        if (!state.lastIntrospection) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ No schema introspected. Run introspect_schema first.',
              },
            ],
            isError: true,
          };
        }

        const { tables = [], outputDir = './convex' } = args as {
          tables?: string[];
          outputDir?: string;
        };

        state.outputDir = outputDir;

        const tablesToGenerate =
          tables.length > 0
            ? state.lastIntrospection.tables.filter((t) =>
                tables.includes(t.name)
              )
            : state.lastIntrospection.tables;

        // Generate schema preview
        const schemaLines = [
          'import { defineSchema, defineTable } from "convex/server";',
          'import { v } from "convex/values";',
          '',
          'export default defineSchema({',
        ];

        for (const table of tablesToGenerate) {
          schemaLines.push(`  ${table.name}: defineTable({`);
          for (const col of table.columns) {
            const convexType = sqlToConvexType(col.type);
            const validator = col.nullable
              ? `v.optional(${convexType})`
              : convexType;
            schemaLines.push(`    ${col.name}: ${validator},`);
          }
          schemaLines.push('  }),');
        }

        schemaLines.push('});');

        return {
          content: [
            {
              type: 'text',
              text: `✅ Generated Convex Schema for ${tablesToGenerate.length} tables\n\n\`\`\`typescript\n${schemaLines.join('\n')}\n\`\`\`\n\nTo save this schema, copy it to ${outputDir}/schema.ts`,
            },
          ],
        };
      }

      case 'estimate_migration': {
        if (!state.lastIntrospection) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ No schema introspected. Run introspect_schema first.',
              },
            ],
            isError: true,
          };
        }

        const { tables = [] } = args as { tables?: string[] };

        const tablesToEstimate =
          tables.length > 0
            ? state.lastIntrospection.tables.filter((t) =>
                tables.includes(t.name)
              )
            : state.lastIntrospection.tables;

        const totalRows = tablesToEstimate.reduce(
          (sum, t) => sum + t.rowCount,
          0
        );

        // Estimate: ~1000 rows/sec optimistic, ~500 realistic, ~200 pessimistic
        const optimisticSeconds = Math.ceil(totalRows / 1000);
        const realisticSeconds = Math.ceil(totalRows / 500);
        const pessimisticSeconds = Math.ceil(totalRows / 200);

        const formatTime = (seconds: number) => {
          if (seconds < 60) return `${seconds}s`;
          if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
          return `${(seconds / 3600).toFixed(1)}h`;
        };

        const tableEstimates = tablesToEstimate
          .sort((a, b) => b.rowCount - a.rowCount)
          .map((t) => `  - ${t.name}: ${t.rowCount.toLocaleString()} rows`)
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `⏱️ Migration Time Estimate\n\nTotal Rows: ${totalRows.toLocaleString()}\nTables: ${tablesToEstimate.length}\n\nTime Estimates:\n  - Optimistic: ${formatTime(optimisticSeconds)}\n  - Realistic: ${formatTime(realisticSeconds)}\n  - Pessimistic: ${formatTime(pessimisticSeconds)}\n\nBy Table:\n${tableEstimates}\n\nNote: Actual time depends on network latency, Convex rate limits, and data complexity.`,
            },
          ],
        };
      }

      case 'type_mapping_help': {
        const { sqlType } = args as { sqlType?: string };

        const typeMappings: Record<string, string> = {
          // PostgreSQL
          integer: 'v.int64()',
          bigint: 'v.int64()',
          smallint: 'v.int64()',
          serial: 'v.int64()',
          bigserial: 'v.int64()',
          real: 'v.float64()',
          'double precision': 'v.float64()',
          numeric: 'v.float64()',
          decimal: 'v.float64()',
          boolean: 'v.boolean()',
          varchar: 'v.string()',
          'character varying': 'v.string()',
          text: 'v.string()',
          char: 'v.string()',
          uuid: 'v.string()',
          json: 'v.any()',
          jsonb: 'v.any()',
          timestamp: 'v.float64() // Unix timestamp',
          timestamptz: 'v.float64() // Unix timestamp',
          date: 'v.string() // ISO date string',
          time: 'v.string() // ISO time string',
          bytea: 'v.bytes()',
          array: 'v.array(v.any())',
          // MySQL
          int: 'v.int64()',
          tinyint: 'v.int64()',
          mediumint: 'v.int64()',
          float: 'v.float64()',
          double: 'v.float64()',
          datetime: 'v.float64() // Unix timestamp',
          blob: 'v.bytes()',
          longtext: 'v.string()',
          enum: 'v.union(v.literal("val1"), ...)',
        };

        if (sqlType) {
          const mapping = typeMappings[sqlType.toLowerCase()];
          if (mapping) {
            return {
              content: [
                {
                  type: 'text',
                  text: `SQL Type: ${sqlType}\nConvex Validator: ${mapping}`,
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: `Unknown SQL type: ${sqlType}\n\nDefaulting to: v.any()\n\nNote: You may want to use a more specific validator based on your data.`,
                },
              ],
            };
          }
        }

        const allMappings = Object.entries(typeMappings)
          .map(([sql, convex]) => `  ${sql.padEnd(20)} → ${convex}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `📖 SQL to Convex Type Mappings\n\n${allMappings}\n\nUse type_mapping_help with a specific sqlType parameter for individual lookups.`,
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
});

// ============================================================================
// Resource Handlers
// ============================================================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'sunsetter://schema/current',
        name: 'Current Database Schema',
        description: 'The currently introspected database schema',
        mimeType: 'application/json',
      },
      {
        uri: 'sunsetter://config/connection',
        name: 'Connection Configuration',
        description: 'Current database connection settings (password redacted)',
        mimeType: 'application/json',
      },
      {
        uri: 'sunsetter://docs/type-mappings',
        name: 'Type Mapping Documentation',
        description: 'SQL to Convex type mapping reference',
        mimeType: 'text/markdown',
      },
      {
        uri: 'sunsetter://docs/gotchas',
        name: 'Migration Gotchas',
        description:
          'Common pitfalls and best practices for database migration',
        mimeType: 'text/markdown',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case 'sunsetter://schema/current':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              state.lastIntrospection || { error: 'No schema introspected' },
              null,
              2
            ),
          },
        ],
      };

    case 'sunsetter://config/connection': {
      const redactedConnection = state.connectionString
        ? state.connectionString.replace(/:[^@]+@/, ':***@')
        : 'Not connected';
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                connectionString: redactedConnection,
                outputDir: state.outputDir,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'sunsetter://docs/type-mappings':
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: TYPE_MAPPING_DOCS,
          },
        ],
      };

    case 'sunsetter://docs/gotchas':
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: MIGRATION_GOTCHAS_DOCS,
          },
        ],
      };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// ============================================================================
// Prompt Handlers
// ============================================================================

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: 'migration_plan',
        description: 'Generate a step-by-step migration plan for your database',
        arguments: [
          {
            name: 'database_type',
            description:
              'Source database type (postgresql, mysql, sqlite, mssql)',
            required: true,
          },
          {
            name: 'target_tables',
            description: 'Comma-separated list of tables to migrate (or "all")',
            required: false,
          },
        ],
      },
      {
        name: 'schema_review',
        description: 'Review and optimize the generated Convex schema',
      },
      {
        name: 'troubleshoot',
        description: 'Troubleshoot common migration issues',
        arguments: [
          {
            name: 'error_message',
            description: 'The error message you encountered',
            required: true,
          },
        ],
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'migration_plan':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Create a detailed migration plan for migrating a ${args?.database_type || 'database'} to Convex.

Tables to migrate: ${args?.target_tables || 'all'}

Please include:
1. Pre-migration checklist
2. Step-by-step migration process
3. Data validation steps
4. Rollback procedure
5. Post-migration verification

Use the SunSetter AQM+ tools to introspect the schema and generate the plan.`,
            },
          },
        ],
      };

    case 'schema_review':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Review the currently introspected database schema and suggest optimizations for Convex:

1. Check for naming convention issues
2. Suggest appropriate indexes
3. Identify potential performance concerns
4. Recommend validator improvements
5. Flag any data type conversion risks

Use the introspect_schema and suggest_indexes tools to analyze the schema.`,
            },
          },
        ],
      };

    case 'troubleshoot':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `I'm encountering an error during migration:

${args?.error_message || 'No error message provided'}

Please help me:
1. Understand what's causing this error
2. Suggest fixes
3. Prevent it from happening again

Use the validate_migration tool to check for related issues.`,
            },
          },
        ],
      };

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

// ============================================================================
// Documentation Constants
// ============================================================================

const TYPE_MAPPING_DOCS = `# SQL to Convex Type Mappings

## Numeric Types
| SQL Type | Convex Validator | Notes |
|----------|------------------|-------|
| INTEGER, INT | \`v.int64()\` | 64-bit signed integer |
| BIGINT | \`v.int64()\` | 64-bit signed integer |
| SMALLINT | \`v.int64()\` | Converted to 64-bit |
| REAL, FLOAT | \`v.float64()\` | 64-bit floating point |
| DOUBLE PRECISION | \`v.float64()\` | 64-bit floating point |
| NUMERIC, DECIMAL | \`v.float64()\` | May lose precision |

## String Types
| SQL Type | Convex Validator | Notes |
|----------|------------------|-------|
| VARCHAR, TEXT | \`v.string()\` | UTF-8 string |
| CHAR | \`v.string()\` | Fixed-width becomes variable |
| UUID | \`v.string()\` | Stored as string |

## Date/Time Types
| SQL Type | Convex Validator | Notes |
|----------|------------------|-------|
| TIMESTAMP | \`v.float64()\` | Unix timestamp in ms |
| DATE | \`v.string()\` | ISO 8601 date string |
| TIME | \`v.string()\` | ISO 8601 time string |

## Other Types
| SQL Type | Convex Validator | Notes |
|----------|------------------|-------|
| BOOLEAN | \`v.boolean()\` | true/false |
| JSON, JSONB | \`v.any()\` | Flexible JSON |
| BYTEA, BLOB | \`v.bytes()\` | Binary data |
| ARRAY | \`v.array()\` | Nested arrays |
`;

const MIGRATION_GOTCHAS_DOCS = `# Database Migration Gotchas

## 1. Foreign Keys Don't Exist in Convex
Convex doesn't enforce foreign key constraints at the database level.
- **Solution**: Store related document IDs as strings
- **Best Practice**: Create helper functions to validate references in mutations

## 2. No AUTO_INCREMENT
Convex generates its own \`_id\` for each document.
- **Solution**: Use the generated \`_id\` as your primary key
- **Tip**: Store the original SQL ID in a separate field if needed for reference

## 3. Timestamps are Numbers
Convex stores timestamps as Unix milliseconds, not Date objects.
- **Solution**: Convert timestamps: \`new Date(timestamp).getTime()\`
- **Queries**: Use numeric comparisons for date filtering

## 4. No ENUM Type
Convex doesn't have native ENUM support.
- **Solution**: Use \`v.union(v.literal("val1"), v.literal("val2"))\`
- **Alternative**: Store as string with validation in mutations

## 5. NULL vs Undefined
In Convex, \`null\` and \`undefined\` are different.
- Use \`v.optional()\` for fields that can be missing
- Use \`v.union(v.null(), v.string())\` for explicit null values

## 6. No Transactions Across Tables
Convex doesn't support multi-table transactions.
- **Solution**: Design for eventual consistency
- **Pattern**: Use actions for complex multi-step operations

## 7. Index Limitations
Convex indexes work differently than SQL indexes.
- Max 3 fields per index
- No partial indexes
- No expression indexes

## 8. Rate Limits
Convex has rate limits on mutations and queries.
- Use batch operations where possible
- Implement retry logic with exponential backoff
- Consider streaming for large migrations

## 9. Document Size Limit
Documents have a 1MB size limit.
- Large text fields may need to be split
- Consider using file storage for large binary data

## 10. No CASCADE DELETE
Deleting a document doesn't automatically delete related documents.
- **Solution**: Implement cascade logic in mutations
- Use scheduled functions for cleanup
`;

// ============================================================================
// Helper Functions
// ============================================================================

function sqlToConvexType(sqlType: string): string {
  const type = sqlType.toLowerCase();

  if (type.includes('int') || type.includes('serial')) return 'v.int64()';
  if (
    type.includes('float') ||
    type.includes('double') ||
    type.includes('real') ||
    type.includes('numeric') ||
    type.includes('decimal')
  )
    return 'v.float64()';
  if (type.includes('bool')) return 'v.boolean()';
  if (type.includes('json')) return 'v.any()';
  if (type.includes('bytea') || type.includes('blob')) return 'v.bytes()';
  if (type.includes('timestamp')) return 'v.float64()';
  if (type.includes('array')) return 'v.array(v.any())';

  return 'v.string()';
}

// ============================================================================
// Server Entry Point
// ============================================================================

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${APP_NAME} MCP Server started`);
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startMcpServer().catch(console.error);
}
