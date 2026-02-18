/**
 * Enhanced Help System
 *
 * Provides detailed help with examples for all commands.
 */

import chalk from 'chalk';
import {
  sunsetGradient,
  APP_NAME,
  VERSION,
  APP_TAGLINE,
} from '../tui/branding.js';

// ============================================================================
// Help Content
// ============================================================================

export const HELP_HEADER = sunsetGradient(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   ☀️ ${APP_NAME} v${VERSION}                                              ║
║   ${APP_TAGLINE}                                                          ║
║                                                                           ║
║   Database → Convex Migration Tool                                        ║
║   Supports: PostgreSQL · MySQL · SQLite · SQL Server                      ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

export const QUICK_START = `
${chalk.bold.yellow('Quick Start:')}

  ${chalk.cyan('1. Interactive Mode (Recommended for first-time users):')}
     $ sunsetter-aqm --tui

  ${chalk.cyan('2. One-liner Migration:')}
     $ sunsetter-aqm migrate -c "postgresql://user:pass@localhost/mydb" \\
         --convex-url "https://your-app.convex.cloud" \\
         --admin-key "your-admin-key"

  ${chalk.cyan('3. Schema Only (no data migration):')}
     $ sunsetter-aqm migrate -c "postgresql://..." -m schema-only -o ./convex
`;

export const COMMANDS_HELP = `
${chalk.bold.yellow('Commands:')}

  ${chalk.green('migrate')}        Migrate database to Convex (main command)
  ${chalk.green('preflight')}      Run pre-migration checks
  ${chalk.green('generate')}       Generate TypeScript code only
  ${chalk.green('introspect')}     Inspect database schema
  ${chalk.green('test-connection')} Test database connectivity
  ${chalk.green('seed-export')}    Export data as seed files
  ${chalk.green('init')}           Create configuration file
`;

export const MIGRATE_EXAMPLES = `
${chalk.bold.yellow('Migration Examples:')}

  ${chalk.cyan('# Full migration with data:')}
  $ sunsetter-aqm migrate \\
      -c "postgresql://user:pass@localhost:5432/mydb" \\
      --convex-url "https://your-app.convex.cloud" \\
      --admin-key "your-convex-admin-key"

  ${chalk.cyan('# Migrate specific tables:')}
  $ sunsetter-aqm migrate -c "postgresql://..." \\
      -t users,orders,products

  ${chalk.cyan('# Exclude certain tables:')}
  $ sunsetter-aqm migrate -c "postgresql://..." \\
      -e _prisma_migrations,schema_migrations

  ${chalk.cyan('# Dry run (preview only):')}
  $ sunsetter-aqm migrate -c "postgresql://..." --dry-run

  ${chalk.cyan('# Schema generation only:')}
  $ sunsetter-aqm migrate -c "postgresql://..." -m schema-only

  ${chalk.cyan('# Parallel migration (faster):')}
  $ sunsetter-aqm migrate -c "postgresql://..." --parallel --parallel-tables 4

  ${chalk.cyan('# With custom batch size:')}
  $ sunsetter-aqm migrate -c "postgresql://..." --batch-size 500

  ${chalk.cyan('# JSON output for CI/CD:')}
  $ sunsetter-aqm migrate -c "postgresql://..." --json

  ${chalk.cyan('# Resume interrupted migration:')}
  $ sunsetter-aqm migrate -c "postgresql://..." --resume
`;

export const CONNECTION_STRINGS = `
${chalk.bold.yellow('Connection String Formats:')}

  ${chalk.green('PostgreSQL:')}
  postgresql://user:password@host:5432/database
  postgresql://user:password@host:5432/database?ssl=true

  ${chalk.green('MySQL:')}
  mysql://user:password@host:3306/database
  mysql://user:password@host:3306/database?ssl=true

  ${chalk.green('SQLite:')}
  sqlite:///path/to/database.db
  sqlite:///./local.db

  ${chalk.green('SQL Server:')}
  mssql://user:password@host:1433/database
  sqlserver://user:password@host\\instance/database
`;

export const CONFIG_FILE_HELP = `
${chalk.bold.yellow('Configuration File:')}

  Create a ${chalk.cyan('.sunsetterrc')} file in your project root:

  ${chalk.gray('{')}
  ${chalk.gray('  "connection": {')}
  ${chalk.gray('    "string": "postgresql://user:pass@localhost/db"')}
  ${chalk.gray('  },')}
  ${chalk.gray('  "convex": {')}
  ${chalk.gray('    "deploymentUrl": "https://your-app.convex.cloud",')}
  ${chalk.gray('    "adminKey": "your-admin-key"')}
  ${chalk.gray('  },')}
  ${chalk.gray('  "migration": {')}
  ${chalk.gray('    "excludeTables": ["_prisma_migrations"],')}
  ${chalk.gray('    "batchSize": 100,')}
  ${chalk.gray('    "parallel": true')}
  ${chalk.gray('  }')}
  ${chalk.gray('}')}

  Supported config files:
  • .sunsetterrc (JSON)
  • .sunsetterrc.json
  • .sunsetterrc.js / .sunsetterrc.cjs
  • sunsetter.config.js
  • package.json (under "sunsetter" key)
`;

export const OUTPUT_FORMATS = `
${chalk.bold.yellow('Output Formats:')}

  ${chalk.green('--json')}         Machine-readable JSON output
  ${chalk.green('--quiet')}        Minimal output (errors only)
  ${chalk.green('--verbose')}      Detailed output with debug info
  ${chalk.green('--no-color')}     Disable colored output

  ${chalk.cyan('JSON output is useful for:')}
  • CI/CD pipelines
  • Scripting and automation
  • Log parsing
  • Integration with other tools
`;

export const MCP_HELP = `
${chalk.bold.yellow('Claude AI Integration (MCP):')}

  SunSetter AQM+ includes an MCP server for Claude Code/Desktop.

  ${chalk.cyan('Setup for Claude Code:')}
  Add to ~/.claude/settings.json:
  ${chalk.gray('{')}
  ${chalk.gray('  "mcpServers": {')}
  ${chalk.gray('    "sunsetter-aqm": {')}
  ${chalk.gray('      "command": "npx",')}
  ${chalk.gray('      "args": ["-y", "@heyoub/sunsetter-aqm", "--mcp"]')}
  ${chalk.gray('    }')}
  ${chalk.gray('  }')}
  ${chalk.gray('}')}

  ${chalk.cyan('Available MCP tools:')}
  • connect_database    - Connect to database
  • introspect_schema   - Discover schema
  • generate_convex_*   - Generate Convex code
  • estimate_migration  - Get time estimates
  • validate_migration  - Check for issues

  See: ${chalk.underline('mcp-configs/README.md')} for full documentation
`;

export const TROUBLESHOOTING = `
${chalk.bold.yellow('Troubleshooting:')}

  ${chalk.red('Connection refused:')}
  • Check database server is running
  • Verify host and port
  • Check firewall settings

  ${chalk.red('Authentication failed:')}
  • Verify username and password
  • Check user permissions
  • For PostgreSQL: check pg_hba.conf

  ${chalk.red('SSL errors:')}
  • Add ?ssl=true to connection string
  • Or use --ssl flag

  ${chalk.red('Migration errors:')}
  • Run preflight checks first: sunsetter-aqm preflight -c "..."
  • Check for unsupported data types
  • Verify Convex admin key

  ${chalk.cyan('Get help:')}
  • GitHub Issues: https://github.com/heyoub/db.aqm/issues
  • Documentation: https://github.com/heyoub/db.aqm#readme
`;

// ============================================================================
// Help Functions
// ============================================================================

/**
 * Print full help
 */
export function printFullHelp(): void {
  console.log(HELP_HEADER);
  console.log(QUICK_START);
  console.log(COMMANDS_HELP);
  console.log(MIGRATE_EXAMPLES);
  console.log(CONNECTION_STRINGS);
  console.log(CONFIG_FILE_HELP);
  console.log(OUTPUT_FORMATS);
  console.log(MCP_HELP);
  console.log(TROUBLESHOOTING);
}

/**
 * Print command-specific help
 */
export function printCommandHelp(command: string): void {
  console.log(HELP_HEADER);

  switch (command) {
    case 'migrate':
      console.log(MIGRATE_EXAMPLES);
      console.log(CONNECTION_STRINGS);
      break;
    case 'preflight':
      console.log(`
${chalk.bold.yellow('Preflight Command:')}

  Run pre-migration checks to identify potential issues.

  ${chalk.cyan('Usage:')}
  $ sunsetter-aqm preflight -c "postgresql://..." [options]

  ${chalk.cyan('Options:')}
  -c, --connection <string>  Database connection string (required)
  -t, --tables <list>        Tables to check (comma-separated)
  -e, --exclude <list>       Tables to exclude
  --json                     Output as JSON

  ${chalk.cyan('Example:')}
  $ sunsetter-aqm preflight -c "postgresql://user:pass@localhost/db" --json
`);
      break;
    case 'config':
      console.log(CONFIG_FILE_HELP);
      break;
    case 'mcp':
      console.log(MCP_HELP);
      break;
    default:
      console.log(COMMANDS_HELP);
  }
}

/**
 * Print version info
 */
export function printVersion(): void {
  console.log(`${APP_NAME} v${VERSION}`);
  console.log('');
  console.log(chalk.gray('Database → Convex Migration Tool'));
  console.log(chalk.gray('Supports: PostgreSQL, MySQL, SQLite, SQL Server'));
  console.log('');
  console.log(chalk.gray(`Node.js: ${process.version}`));
  console.log(chalk.gray(`Platform: ${process.platform} ${process.arch}`));
}
