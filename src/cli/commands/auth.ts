/**
 * Auth Command
 *
 * Authenticates with Convex, validates credentials, and saves them
 * to .env.local for subsequent commands.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  createSuccessOutput,
  createErrorOutput,
  printJson,
} from '../output/json-output.js';
import { toError } from '../../utils/errors.js';

export function createAuthCommand(): Command {
  return new Command('auth')
    .description('Authenticate with Convex')
    .option('--force', 'Force re-authentication even if credentials exist')
    .option('--check', 'Only check if credentials exist and are valid')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      const {
        authenticateConvex,
        detectExistingCredentials,
        validateCredentials,
        saveCredentials,
      } = await import('../auth/convex-auth.js');

      try {
        if (options.check) {
          // Just check existing credentials
          const existing = await detectExistingCredentials();

          if (existing?.credentials?.deployKey) {
            const validation = await validateCredentials(existing.credentials);

            if (options.json) {
              printJson(
                createSuccessOutput('auth', {
                  authenticated: validation.valid,
                  source: existing.source,
                  deploymentUrl: existing.credentials.deploymentUrl,
                  projectName: validation.projectInfo?.name,
                  error: validation.error,
                })
              );
            } else {
              if (validation.valid) {
                console.log(chalk.green('✓ Authenticated with Convex'));
                console.log(
                  chalk.dim(`  Project: ${validation.projectInfo?.name}`)
                );
                console.log(chalk.dim(`  Source: ${existing.source}`));
              } else {
                console.log(chalk.red('✗ Credentials found but invalid'));
                console.log(chalk.dim(`  Error: ${validation.error}`));
              }
            }
            process.exit(validation.valid ? 0 : 1);
          } else {
            if (options.json) {
              printJson(
                createSuccessOutput('auth', {
                  authenticated: false,
                  error: 'No credentials found',
                })
              );
            } else {
              console.log(chalk.yellow('⚠ No Convex credentials found'));
              console.log(
                chalk.dim('  Run `sunsetter-aqm auth` to authenticate')
              );
            }
            process.exit(1);
          }
        } else {
          // Full authentication flow
          const result = await authenticateConvex({
            forceNew: options.force,
            onStatusChange: (status: string) => {
              if (!options.json) {
                console.log(status);
              }
            },
          });

          if (result.success && result.credentials) {
            // Validate credentials
            const validation = await validateCredentials(result.credentials);

            if (validation.valid) {
              // Save credentials
              await saveCredentials(result.credentials);

              if (options.json) {
                printJson(
                  createSuccessOutput('auth', {
                    authenticated: true,
                    source: result.source,
                    deploymentUrl: result.credentials.deploymentUrl,
                    projectName: validation.projectInfo?.name,
                    saved: true,
                  })
                );
              } else {
                console.log();
                console.log(
                  chalk.green('✓ Successfully authenticated with Convex!')
                );
                console.log(
                  chalk.dim(`  Project: ${validation.projectInfo?.name}`)
                );
                console.log(chalk.dim(`  Credentials saved to .env.local`));
              }
            } else {
              if (options.json) {
                printJson(
                  createErrorOutput('auth', {
                    code: 'INVALID_CREDENTIALS',
                    message: validation.error || 'Invalid credentials',
                  })
                );
              } else {
                console.log(chalk.red('✗ Credentials are invalid'));
                console.log(chalk.dim(`  Error: ${validation.error}`));
              }
              process.exit(1);
            }
          } else {
            if (options.json) {
              printJson(
                createErrorOutput('auth', {
                  code: 'AUTH_FAILED',
                  message: result.error || 'Authentication failed',
                })
              );
            } else {
              console.log(chalk.red('✗ Authentication failed'));
              console.log(chalk.dim(`  ${result.error}`));
            }
            process.exit(1);
          }
        }
      } catch (error) {
        if (options.json) {
          printJson(createErrorOutput('auth', toError(error)));
        } else {
          console.error(chalk.red('Auth error:'), toError(error).message);
        }
        process.exit(1);
      }
    });
}
