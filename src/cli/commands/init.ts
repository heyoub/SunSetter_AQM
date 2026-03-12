/**
 * Init Command
 *
 * Creates a sample .sunsetterrc configuration file in the current directory.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import { generateSampleConfig } from '../../config/config-loader.js';
import {
  createSuccessOutput,
  createErrorOutput,
  printJson,
} from '../output/json-output.js';
import { toError } from '../../utils/errors.js';

export function createInitCommand(): Command {
  return new Command('init')
    .description('Create a configuration file (.sunsetterrc)')
    .option('-f, --force', 'Overwrite existing config file')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      const configPath = '.sunsetterrc';

      try {
        // Check if config already exists
        try {
          await fs.access(configPath);
          if (!options.force) {
            if (options.json) {
              printJson(
                createErrorOutput('init', {
                  code: 'CONFIG_EXISTS',
                  message:
                    'Config file already exists. Use --force to overwrite.',
                })
              );
            } else {
              console.error(
                chalk.red(
                  'Config file already exists. Use --force to overwrite.'
                )
              );
            }
            process.exit(1);
          }
        } catch {
          // File doesn't exist, continue
        }

        // Write sample config
        const sampleConfig = generateSampleConfig();
        await fs.writeFile(configPath, sampleConfig, 'utf-8');

        if (options.json) {
          printJson(
            createSuccessOutput('init', {
              configPath,
              message: 'Config file created successfully',
            })
          );
        } else {
          console.log(chalk.green('✅ Created .sunsetterrc'));
          console.log('');
          console.log(chalk.gray('Edit the file to configure your migration:'));
          console.log(chalk.cyan(`  ${configPath}`));
          console.log('');
          console.log(chalk.gray('Then run:'));
          console.log(chalk.cyan('  sunsetter-aqm migrate'));
        }
      } catch (error) {
        if (options.json) {
          printJson(createErrorOutput('init', toError(error)));
        } else {
          console.error(
            chalk.red('Error creating config:'),
            toError(error).message
          );
        }
        process.exit(1);
      }
    });
}
