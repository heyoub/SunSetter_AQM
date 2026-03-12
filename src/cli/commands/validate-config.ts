/**
 * Validate Config Command
 *
 * Validates the SunSetter configuration file and reports any errors.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, validateConfig } from '../../config/config-loader.js';
import {
  createSuccessOutput,
  createErrorOutput,
  printJson,
} from '../output/json-output.js';
import { toError } from '../../utils/errors.js';

export function createValidateConfigCommand(): Command {
  return new Command('validate-config')
    .description('Validate configuration file')
    .option('-c, --config <path>', 'Path to config file')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const loaded = await loadConfig(
          options.config ? options.config : process.cwd()
        );

        if (!loaded.path) {
          if (options.json) {
            printJson(
              createErrorOutput('validate-config', {
                code: 'NO_CONFIG',
                message: 'No configuration file found',
              })
            );
          } else {
            console.error(chalk.red('No configuration file found.'));
            console.log(chalk.gray('Run `sunsetter-aqm init` to create one.'));
          }
          process.exit(1);
        }

        const validation = validateConfig(loaded.config);

        if (options.json) {
          printJson(
            createSuccessOutput('validate-config', {
              valid: validation.valid,
              source: loaded.source,
              path: loaded.path,
              errors: validation.errors,
              config: loaded.config,
            })
          );
        } else {
          console.log(chalk.cyan(`Config file: ${loaded.path}`));
          console.log(chalk.gray(`Source: ${loaded.source}`));
          console.log('');

          if (validation.valid) {
            console.log(chalk.green('✅ Configuration is valid'));
          } else {
            console.log(chalk.red('❌ Configuration has errors:'));
            validation.errors.forEach((err) => {
              console.log(chalk.red(`  • ${err}`));
            });
          }
        }

        process.exit(validation.valid ? 0 : 1);
      } catch (error) {
        if (options.json) {
          printJson(createErrorOutput('validate-config', toError(error)));
        } else {
          console.error(chalk.red('Error:'), toError(error).message);
        }
        process.exit(1);
      }
    });
}
