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

| Command | Description |
|---------|-------------|
| `wizard` | Interactive setup wizard |
| `migrate` | Run database migration |
| `generate` | Generate Convex code only (no data) |
| `introspect` | Inspect database schema |
| `preflight` | Pre-migration validation and estimates |
| `export-seed` | Export seed data for testing |

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
sunsetter migrate --help

Options:
  -c, --connection <string>     Database connection string
  -t, --tables <tables>         Specific tables to migrate (comma-separated)
  -m, --mode <mode>             Migration mode (schema-only|data-only|schema-and-data)
  --db-type <type>              Database type (postgresql|mysql|sqlite|mssql)
  --convex-url <url>            Convex deployment URL
  --convex-deploy-key <key>     Convex deploy key
  --batch-size <number>         Rows per batch (default: 100)
  --parallel                    Enable parallel table migration
  --dry-run                     Preview without making changes
  --resume                      Resume from checkpoint
  --rollback                    Rollback previous migration
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

| SQL Type | Convex Type |
|----------|-------------|
| `INTEGER`, `BIGINT` | `v.int64()` |
| `REAL`, `FLOAT`, `DECIMAL` | `v.float64()` |
| `VARCHAR`, `TEXT` | `v.string()` |
| `BOOLEAN` | `v.boolean()` |
| `TIMESTAMP`, `DATE` | `v.int64()` (Unix ms) |
| `JSON`, `JSONB` | `v.any()` |
| `UUID` | `v.string()` |
| `ARRAY` | `v.array()` |
| Foreign Key | `v.id("referenced_table")` |

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

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT - see [LICENSE](LICENSE)

---

Built with care for the Convex community
