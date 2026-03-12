/**
 * Migration Hooks
 *
 * Supports pre/post migration hooks for custom automation
 * - Shell command execution
 * - Environment variable substitution
 * - Success/failure handling
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Hook configuration
 */
export interface HookConfig {
  /** Shell command to execute */
  command: string;
  /** Working directory for command execution */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Continue on failure */
  continueOnError?: boolean;
}

/**
 * Hook result
 */
export interface HookResult {
  success: boolean;
  stdout: string;
  stderr: string;
  duration: number;
  error?: Error;
}

/**
 * Migration hooks configuration
 */
export interface MigrationHooks {
  /** Execute before migration starts */
  preMigration?: HookConfig[];
  /** Execute after migration completes successfully */
  postMigrationSuccess?: HookConfig[];
  /** Execute after migration fails */
  postMigrationFailure?: HookConfig[];
  /** Execute before each table migration */
  preTable?: HookConfig[];
  /** Execute after each table migration */
  postTable?: HookConfig[];
}

/**
 * Hook executor
 */
export class HookExecutor {
  /**
   * Execute a single hook
   */
  async executeHook(
    hook: HookConfig,
    context: Record<string, string> = {}
  ): Promise<HookResult> {
    const startTime = Date.now();
    const result: HookResult = {
      success: false,
      stdout: '',
      stderr: '',
      duration: 0,
    };

    try {
      // Substitute environment variables in command
      const command = this.substituteVariables(hook.command, context);

      // Prepare environment
      const env = {
        ...process.env,
        ...hook.env,
        ...context,
      };

      // Execute command
      const { stdout, stderr } = await execAsync(command, {
        cwd: hook.cwd,
        env,
        timeout: hook.timeoutMs || 60000, // Default 1 minute
      });

      result.stdout = stdout;
      result.stderr = stderr;
      result.success = true;
    } catch (error: unknown) {
      result.error = error as Error;
      result.stderr = (error as Error).message;

      if (!hook.continueOnError) {
        throw error;
      }
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Execute multiple hooks in sequence
   */
  async executeHooks(
    hooks: HookConfig[],
    context: Record<string, string> = {}
  ): Promise<HookResult[]> {
    const results: HookResult[] = [];

    for (const hook of hooks) {
      const result = await this.executeHook(hook, context);
      results.push(result);

      if (!result.success && !hook.continueOnError) {
        break; // Stop on first failure
      }
    }

    return results;
  }

  /**
   * Substitute variables in command string
   */
  private substituteVariables(
    command: string,
    context: Record<string, string>
  ): string {
    let result = command;

    // Substitute ${VAR_NAME} style variables
    for (const [key, value] of Object.entries(context)) {
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }

    return result;
  }
}

/**
 * Default hooks for common scenarios
 */
export const COMMON_HOOKS = {
  /**
   * Create database backup before migration
   */
  backupDatabase: (dbUrl: string): HookConfig => ({
    command: `pg_dump ${dbUrl} > backup_$(date +%Y%m%d_%H%M%S).sql`,
    continueOnError: false,
  }),

  /**
   * Send notification on migration start
   */
  notifyStart: (webhook: string): HookConfig => ({
    command: `curl -X POST ${webhook} -H 'Content-Type: application/json' -d '{"text":"Migration started at $(date)"}'`,
    continueOnError: true,
  }),

  /**
   * Send notification on migration complete
   */
  notifyComplete: (webhook: string): HookConfig => ({
    command: `curl -X POST ${webhook} -H 'Content-Type: application/json' -d '{"text":"Migration completed at $(date)"}'`,
    continueOnError: true,
  }),

  /**
   * Deploy Convex functions
   */
  deployConvex: (): HookConfig => ({
    command: 'npx convex deploy',
    continueOnError: false,
  }),

  /**
   * Run smoke tests
   */
  runTests: (): HookConfig => ({
    command: 'npm run test:migration',
    continueOnError: false,
  }),
};
