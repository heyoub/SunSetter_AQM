/**
 * Doctor Command
 *
 * Checks system requirements and diagnoses environment issues
 * including Node.js version, config file presence, Convex directory,
 * and environment variables.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import { loadConfig } from '../../config/config-loader.js';
import { createSuccessOutput, printJson } from '../output/json-output.js';

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Check system requirements and diagnose issues')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      const checks: Array<{
        name: string;
        status: 'ok' | 'warn' | 'error';
        message: string;
      }> = [];

      // Check Node.js version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
      if (majorVersion >= 18) {
        checks.push({
          name: 'Node.js',
          status: 'ok',
          message: `${nodeVersion} (>= 18 required)`,
        });
      } else {
        checks.push({
          name: 'Node.js',
          status: 'error',
          message: `${nodeVersion} (>= 18 required)`,
        });
      }

      // Check for config file
      const configLoaded = await loadConfig();
      if (configLoaded.path) {
        checks.push({
          name: 'Config File',
          status: 'ok',
          message: `Found: ${configLoaded.source}`,
        });
      } else {
        checks.push({
          name: 'Config File',
          status: 'warn',
          message: 'Not found (optional)',
        });
      }

      // Check for convex directory
      try {
        await fs.access('./convex');
        checks.push({
          name: 'Convex Directory',
          status: 'ok',
          message: './convex exists',
        });
      } catch {
        checks.push({
          name: 'Convex Directory',
          status: 'warn',
          message: './convex not found (will be created)',
        });
      }

      // Check environment variables
      if (process.env.CONVEX_DEPLOYMENT) {
        checks.push({
          name: 'CONVEX_DEPLOYMENT',
          status: 'ok',
          message: 'Set',
        });
      } else {
        checks.push({
          name: 'CONVEX_DEPLOYMENT',
          status: 'warn',
          message: 'Not set (optional)',
        });
      }

      if (options.json) {
        const allOk = checks.every((c) => c.status !== 'error');
        printJson(
          createSuccessOutput('doctor', {
            healthy: allOk,
            checks,
          })
        );
      } else {
        console.log(chalk.bold('System Diagnostics'));
        console.log('');

        for (const check of checks) {
          const icon =
            check.status === 'ok'
              ? chalk.green('✓')
              : check.status === 'warn'
                ? chalk.yellow('⚠')
                : chalk.red('✗');
          const color =
            check.status === 'ok'
              ? chalk.green
              : check.status === 'warn'
                ? chalk.yellow
                : chalk.red;
          console.log(`  ${icon} ${check.name}: ${color(check.message)}`);
        }

        console.log('');
        const hasErrors = checks.some((c) => c.status === 'error');
        if (hasErrors) {
          console.log(
            chalk.red('Some checks failed. Please fix the issues above.')
          );
        } else {
          console.log(chalk.green('All checks passed!'));
        }
      }

      process.exit(checks.some((c) => c.status === 'error') ? 1 : 0);
    });
}
