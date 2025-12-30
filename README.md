# SunSetter AQM+

**Enterprise-grade database to Convex migration tool with beautiful TUI**

AQM = **A**ctions, **Q**ueries, **M**utations - the building blocks of Convex

## Features

### Multi-Database Support

- **PostgreSQL** - Full support with multi-schema introspection
- **MySQL / MariaDB** - Complete type mapping and streaming
- **SQLite** - File-based database migration
- **SQL Server (MSSQL)** - Enterprise database support

### Code Generation

- **Convex Schema** - Type-safe schema with validators
- **Queries** - Paginated list, getById, search, filtering
- **Mutations** - Create, update, remove, batch operations
- **Actions** - External API sync, document processing
- **HTTP Actions** - REST API endpoints with auth stubs
- **TypeScript Types** - Full type definitions

### Enterprise Migration

- **Streaming** - Memory-efficient cursor-based pagination
- **Parallel Migration** - Concurrent table processing with dependency awareness
- **Checkpointing** - Resume interrupted migrations
- **Rollback** - Delete migrated documents if needed
- **Dry Run** - Preview changes without writing

### Beautiful TUI

- **Interactive Wizard** - Guided setup experience
- **Visual Progress** - Real-time progress bars per table
- **Dashboard** - Live migration statistics

### Production Enhancements

- **Slack Notifications** - Real-time migration alerts to Slack
- **PII Data Masking** - GDPR-compliant data anonymization
- **Post-Migration Verification** - Validate row counts after migration
- **React Hooks Generation** - Type-safe React hooks for Convex
- **Connection Validation** - Helpful errors with cloud provider examples

### MCP Integration

- **Claude Code** - Use as an MCP server in Claude Code CLI
- **Claude Desktop** - Integrate with Claude Desktop app
- **IDE Extensions** - Works with VSCode Claude extensions

## Installation

```bash
npm install -g @heyoub/sunsetter-aqm
```

Or run directly:

```bash
npx @heyoub/sunsetter-aqm
```

## Quick Start

### Interactive Mode (Recommended)

```bash
sunsetter wizard
```

### Command Line

**PostgreSQL:**

```bash
sunsetter migrate -c "postgresql://user:pass@localhost:5432/mydb" \
  --convex-url https://your-app.convex.cloud \
  --convex-deploy-key your-deploy-key
```

**MySQL:**

```bash
sunsetter migrate -c "mysql://user:pass@localhost:3306/mydb"
```

**SQLite:**

```bash
sunsetter migrate -c "sqlite:///path/to/database.db"
```

**SQL Server:**

```bash
sunsetter migrate -c "mssql://user:pass@localhost:1433/mydb"
```

## Commands

| Command           | Description                            |
| ----------------- | -------------------------------------- |
| `wizard`          | Interactive setup wizard               |
| `migrate`         | Run database migration                 |
| `generate`        | Generate Convex code only (no data)    |
| `introspect`      | Inspect database schema                |
| `preflight`       | Pre-migration validation and estimates |
| `export-seed`     | Export seed data for testing           |
| `init`            | Create sample configuration file       |
| `validate-config` | Validate configuration file            |
| `doctor`          | Check system dependencies              |

## Configuration File

Create a `.sunsetterrc` or `.sunsetterrc.json` in your project:

```json
{
  "connection": {
    "string": "postgresql://localhost/mydb"
  },
  "convex": {
    "deploymentUrl": "https://your-app.convex.cloud"
  },
  "migration": {
    "batchSize": 100,
    "parallel": true,
    "maxParallelTables": 4
  },
  "generation": {
    "queries": true,
    "mutations": true,
    "actions": true,
    "httpActions": true
  },
  "output": {
    "format": "pretty"
  }
}
```

Generate a sample config:

```bash
sunsetter init
```

## Migration Modes

```bash
# Schema only - generate Convex code
sunsetter migrate -m schema-only

# Schema and data - full migration
sunsetter migrate -m schema-and-data

# Data only - migrate to existing schema
sunsetter migrate -m data-only
```

## Options

```bash
sunsetter --help

Global Options:
  -v, --version               Show version number
  --help                      Show help
  --help-full                 Show detailed help with examples
  --config <path>             Path to config file
  --json                      Output in JSON format (for CI/CD)
  --quiet                     Suppress non-essential output
  --verbose                   Show detailed output

Migration Options:
  -c, --connection <string>   Database connection string
  -t, --tables <tables>       Specific tables to migrate (comma-separated)
  -m, --mode <mode>           Migration mode (schema-only|data-only|schema-and-data)
  --db-type <type>            Database type (postgresql|mysql|sqlite|mssql)
  --convex-url <url>          Convex deployment URL
  --convex-deploy-key <key>   Convex deploy key
  --batch-size <number>       Rows per batch (default: 100)
  --parallel                  Enable parallel table migration
  --dry-run                   Preview without making changes
  --resume                    Resume from checkpoint
  --rollback                  Rollback previous migration

Enhancement Options:
  --slack-webhook <url>       Slack webhook for migration notifications
  --mask-pii                  Enable PII data masking during migration
  --verify                    Run post-migration verification
  --react-hooks               Generate React hooks for Convex functions
  --hooks-output <dir>        Output directory for hooks (default: ./src/hooks)
```

## JSON Output

For CI/CD pipelines, use `--json` for machine-readable output:

```bash
sunsetter migrate -c "postgresql://..." --json
```

Output format:

```json
{
  "success": true,
  "operation": "migrate",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "durationMs": 12500,
  "data": {
    "tablesProcessed": 5,
    "rowsMigrated": 10000,
    "errors": 0
  }
}
```

## Environment Variables

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
CONVEX_URL=https://your-app.convex.cloud
CONVEX_DEPLOY_KEY=your-deploy-key
```

## Generated Code Structure

```
convex/
├── schema.ts              # Convex schema definition
├── users.ts               # Table: queries + mutations
├── users.actions.ts       # Table: actions (external APIs)
├── users.http.ts          # Table: HTTP endpoints
├── _generated/
│   └── types.ts           # TypeScript types
└── http.ts                # HTTP router
```

## Type Mapping

| SQL Type                   | Convex Type                |
| -------------------------- | -------------------------- |
| `INTEGER`, `BIGINT`        | `v.int64()`                |
| `REAL`, `FLOAT`, `DECIMAL` | `v.float64()`              |
| `VARCHAR`, `TEXT`          | `v.string()`               |
| `BOOLEAN`                  | `v.boolean()`              |
| `TIMESTAMP`, `DATE`        | `v.int64()` (Unix ms)      |
| `JSON`, `JSONB`            | `v.any()`                  |
| `UUID`                     | `v.string()`               |
| `ARRAY`                    | `v.array()`                |
| Foreign Key                | `v.id("referenced_table")` |

## MCP Server Integration

SunSetter can run as an MCP (Model Context Protocol) server, enabling AI assistants like Claude to directly introspect databases and run migrations.

### Starting the MCP Server

```bash
sunsetter --mcp
```

### Claude Code Configuration

Add to your Claude Code settings (`~/.config/claude-code/settings.json`):

```json
{
  "mcpServers": {
    "sunsetter": {
      "command": "npx",
      "args": ["@heyoub/sunsetter-aqm", "--mcp"],
      "description": "Database to Convex migration tool"
    }
  }
}
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "sunsetter": {
      "command": "npx",
      "args": ["@heyoub/sunsetter-aqm", "--mcp"]
    }
  }
}
```

### Available MCP Tools

| Tool                   | Description                    |
| ---------------------- | ------------------------------ |
| `connect`              | Connect to a database          |
| `introspect_schema`    | Introspect database schema     |
| `list_tables`          | List all tables                |
| `get_table_info`       | Get detailed table information |
| `preview_migration`    | Preview migration plan         |
| `generate_schema`      | Generate Convex schema         |
| `generate_queries`     | Generate query functions       |
| `generate_mutations`   | Generate mutation functions    |
| `run_migration`        | Execute migration              |
| `get_migration_status` | Check migration progress       |
| `rollback_migration`   | Rollback migration             |
| `disconnect`           | Close database connection      |

### MCP Resources

- `schema://current` - Current database schema
- `migration://status` - Migration status
- `convex://generated` - Generated Convex code
- `config://current` - Current configuration

### MCP Prompts

- `plan-migration` - Generate a migration plan
- `analyze-schema` - Analyze database schema for issues
- `optimize-migration` - Get optimization suggestions

## Slack Notifications

Get real-time migration updates in Slack:

```bash
sunsetter migrate -c "postgresql://..." \
  --slack-webhook "https://hooks.slack.com/services/XXX/YYY/ZZZ"
```

Notifications include:

- Migration start (tables, estimated rows)
- Migration complete (duration, rows migrated, failures)
- Migration failure (error details, failed table)

## PII Data Masking

Anonymize sensitive data during migration for GDPR/HIPAA compliance:

```bash
sunsetter migrate -c "postgresql://..." --mask-pii
```

Configure masking rules in `.sunsetterrc`:

```json
{
  "dataMasking": {
    "enabled": true,
    "tables": [
      {
        "tableName": "users",
        "fields": {
          "email": "email",
          "phone": "phone",
          "name": "name",
          "ssn": "redact"
        }
      }
    ]
  }
}
```

Masking strategies: `hash`, `redact`, `email`, `phone`, `name`

## Post-Migration Verification

Verify data integrity after migration:

```bash
sunsetter migrate -c "postgresql://..." --verify
```

Verification checks:

- Row count comparison (source vs Convex)
- Per-table PASS/FAIL status
- Summary report with mismatches

## React Hooks Generation

Generate type-safe React hooks for your Convex functions:

```bash
sunsetter migrate -c "postgresql://..." \
  --react-hooks \
  --hooks-output ./src/hooks
```

Generated hooks per table:

- `useUsersList()` - Paginated list query
- `useUser(id)` - Single document query
- `useCreateUser()` - Create mutation
- `useUpdateUser()` - Update mutation
- `useRemoveUser()` - Delete mutation

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Source DB     │────▶│  SunSetter AQM+  │────▶│     Convex      │
│ (PG/MySQL/etc)  │     │                  │     │                 │
└─────────────────┘     │  - Introspect    │     │  - Schema       │
                        │  - Transform     │     │  - Documents    │
                        │  - Stream        │     │  - Functions    │
                        └──────────────────┘     └─────────────────┘
```

## System Requirements

Check your system:

```bash
sunsetter doctor
```

Requirements:

- Node.js 18+
- npm or yarn
- Database client (optional, for validation)

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT - see [LICENSE](LICENSE)

---

Built with care for the Convex community
