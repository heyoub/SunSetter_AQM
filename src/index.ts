#!/usr/bin/env node

/**
 * SunSetter AQM+
 *
 * Database to Convex Migration Tool
 * AQM = Actions, Queries, Mutations
 *
 * Supports: PostgreSQL, MySQL, SQLite, SQL Server
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createMigrateCommand } from './cli/commands/migrate.js';
import { createSeedExportCommand } from './cli/commands/seed-export.js';
import { createPreflightCommand } from './cli/commands/preflight.js';
import { createGenerateCommand } from './cli/commands/generate.js';
import { createIntrospectCommand } from './cli/commands/introspect.js';
import { createTestConnectionCommand } from './cli/commands/test-connection.js';
import { createInitCommand } from './cli/commands/init.js';
import { createValidateConfigCommand } from './cli/commands/validate-config.js';
import { createDoctorCommand } from './cli/commands/doctor.js';
import { createAuthCommand } from './cli/commands/auth.js';
import { printFullHelp } from './cli/help.js';
import {
  sunsetGradient,
  APP_NAME,
  APP_TAGLINE,
  VERSION,
} from './tui/branding.js';

const program = new Command();

// Check for special flags first (before Commander parsing)
const args = process.argv.slice(2);

// Handle --mcp flag for MCP server mode
if (args.includes('--mcp')) {
  import('./mcp/server.js').then(({ startMcpServer }) => {
    startMcpServer().catch(console.error);
  });
} else if (args.includes('-i') || args.includes('--interactive')) {
  // Launch TUI mode
  import('./tui/app.js').then(({ launchTUI }) => {
    launchTUI().catch(console.error);
  });
} else if (args.includes('--help-full') || args.includes('--help-all')) {
  // Show full help with all examples
  printFullHelp();
} else {
  // Normal CLI mode
  program
    .name('sunsetter-aqm')
    .description(
      sunsetGradient(`
☀️  ${APP_NAME}
════════════════════════════════════════
${APP_TAGLINE}

Database to Convex Migration Tool
Supports: PostgreSQL, MySQL, SQLite, SQL Server
`)
    )
    .version(VERSION, '-v, --version', 'Display version number')
    .option('-i, --interactive', 'Launch interactive TUI mode')
    .option('--mcp', 'Start MCP server for Claude integration')
    .option('--json', 'Output results as JSON')
    .option('--no-color', 'Disable colored output')
    .option('--quiet', 'Minimal output (errors only)')
    .option('--verbose', 'Verbose output with debug info')
    .option('--config <path>', 'Path to config file')
    .option('--help-full', 'Show full help with all examples');

  // Register all commands
  program.addCommand(createMigrateCommand());
  program.addCommand(createSeedExportCommand());
  program.addCommand(createPreflightCommand());
  program.addCommand(createGenerateCommand());
  program.addCommand(createIntrospectCommand());
  program.addCommand(createTestConnectionCommand());
  program.addCommand(createInitCommand());
  program.addCommand(createValidateConfigCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createAuthCommand());

  // Enhanced help
  program.on('--help', () => {
    console.log('');
    console.log(chalk.bold.yellow('Quick Start:'));
    console.log('');
    console.log(chalk.cyan('  # Interactive mode (recommended):'));
    console.log('  $ sunsetter-aqm -i');
    console.log('');
    console.log(chalk.cyan('  # Authenticate with Convex:'));
    console.log('  $ sunsetter-aqm auth');
    console.log('');
    console.log(chalk.cyan('  # Create config file:'));
    console.log('  $ sunsetter-aqm init');
    console.log('');
    console.log(chalk.cyan('  # Migrate PostgreSQL to Convex:'));
    console.log(
      '  $ sunsetter-aqm migrate -c "postgresql://user:pass@localhost/db"'
    );
    console.log('');
    console.log(chalk.cyan('  # Dry run (preview only):'));
    console.log('  $ sunsetter-aqm migrate -c "postgresql://..." --dry-run');
    console.log('');
    console.log(chalk.cyan('  # JSON output for CI/CD:'));
    console.log('  $ sunsetter-aqm migrate -c "postgresql://..." --json');
    console.log('');
    console.log(chalk.gray('For full help with all examples:'));
    console.log(chalk.cyan('  $ sunsetter-aqm --help-full'));
    console.log('');
    console.log(
      chalk.gray('Documentation: https://github.com/heyoub/SunSetter_AQM')
    );
    console.log('');
  });

  program.parse();
}
