# SunSetter AQM+ MCP Integration

Model Context Protocol (MCP) integration for Claude Code, Claude Desktop, and VSCode.

## Quick Start

### Claude Code

Add to your `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "sunsetter-aqm": {
      "command": "npx",
      "args": ["-y", "@Heyoub/sunsetter-aqm", "--mcp"]
    }
  }
}
```

Or for local development:

```json
{
  "mcpServers": {
    "sunsetter-aqm": {
      "command": "node",
      "args": ["/path/to/sunsetter-aqm/dist/mcp/server.js"]
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "sunsetter-aqm": {
      "command": "node",
      "args": ["/path/to/sunsetter-aqm/dist/mcp/server.js"]
    }
  }
}
```

### VSCode with Claude Extension

Add to your VSCode settings (`settings.json`):

```json
{
  "claude.mcpServers": {
    "sunsetter-aqm": {
      "command": "npx",
      "args": ["-y", "@Heyoub/sunsetter-aqm", "--mcp"]
    }
  }
}
```

## Available Tools

Once connected, you'll have access to these tools:

| Tool                        | Description                                         |
| --------------------------- | --------------------------------------------------- |
| `connect_database`          | Connect to PostgreSQL, MySQL, SQLite, or SQL Server |
| `introspect_schema`         | Discover tables, columns, types, and relationships  |
| `generate_convex_schema`    | Generate Convex schema.ts with validators           |
| `generate_convex_queries`   | Generate type-safe query functions                  |
| `generate_convex_mutations` | Generate CRUD mutations                             |
| `generate_convex_actions`   | Generate HTTP actions and background jobs           |
| `estimate_migration`        | Get time and resource estimates                     |
| `validate_migration`        | Check for potential issues                          |
| `preview_migration`         | Preview generated code                              |
| `get_table_info`            | Detailed table inspection                           |
| `suggest_indexes`           | Index recommendations                               |
| `type_mapping_help`         | SQL to Convex type reference                        |

## Available Resources

| Resource URI                     | Description                             |
| -------------------------------- | --------------------------------------- |
| `sunsetter://schema/current`     | Current introspected schema (JSON)      |
| `sunsetter://config/connection`  | Connection settings (password redacted) |
| `sunsetter://docs/type-mappings` | Type mapping documentation              |
| `sunsetter://docs/gotchas`       | Migration best practices and gotchas    |

## Example Prompts

### Migration Planning

```
"Help me migrate my PostgreSQL database to Convex. Start by connecting to postgresql://user:pass@localhost:5432/mydb and introspecting the schema."
```

### Schema Review

```
"Review my database schema and suggest optimizations for Convex. What indexes should I create?"
```

### Troubleshooting

```
"I'm getting a type error when migrating the 'users' table. Can you help me understand the issue?"
```

## Example Session

```
You: Connect to my PostgreSQL database at postgresql://user:pass@localhost:5432/myapp

Claude: [Uses connect_database tool]
Successfully connected to PostgreSQL database.

You: What tables are available?

Claude: [Uses introspect_schema tool]
Found 5 tables:
- users: 15 columns, 10,234 rows
- orders: 12 columns, 45,678 rows
- products: 8 columns, 1,234 rows
- order_items: 6 columns, 123,456 rows
- categories: 4 columns, 50 rows

You: Generate the Convex schema for users and orders

Claude: [Uses generate_convex_schema tool]
Here's your Convex schema:
[Generated TypeScript code]
```

## Troubleshooting

### Server won't start

- Ensure Node.js >= 18 is installed
- Run `npm run build` first
- Check the path in your config is correct

### Connection errors

- Verify database credentials
- Check network/firewall settings
- Ensure database server is running

### Type errors

- Use `type_mapping_help` to check conversions
- Read `sunsetter://docs/gotchas` for common issues
