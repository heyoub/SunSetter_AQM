/**
 * Configuration File Loader
 *
 * Supports loading configuration from:
 * - .sunsetterrc (JSON)
 * - .sunsetterrc.json
 * - .sunsetterrc.js
 * - sunsetter.config.js
 * - package.json (sunsetter key)
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface SunsetterConfig {
  /** Database connection settings */
  connection?: {
    /** Connection string (postgresql://..., mysql://..., etc.) */
    string?: string;
    /** Or individual connection parameters */
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    ssl?: boolean | object;
  };

  /** Convex deployment settings */
  convex?: {
    /** Convex deployment URL */
    deploymentUrl?: string;
    /** Admin key for API access */
    adminKey?: string;
  };

  /** Migration settings */
  migration?: {
    /** Tables to include (empty = all) */
    tables?: string[];
    /** Tables to exclude */
    excludeTables?: string[];
    /** Schemas to include */
    schemas?: string[];
    /** Batch size for data migration */
    batchSize?: number;
    /** Enable parallel table migration */
    parallel?: boolean;
    /** Max parallel tables */
    maxParallelTables?: number;
    /** Enable dry-run by default */
    dryRun?: boolean;
    /** Output directory for generated code */
    outputDir?: string;
  };

  /** Code generation settings */
  generation?: {
    /** Generate queries */
    queries?: boolean;
    /** Generate mutations */
    mutations?: boolean;
    /** Generate actions */
    actions?: boolean;
    /** Generate HTTP actions */
    httpActions?: boolean;
    /** Include batch operations */
    batchOperations?: boolean;
    /** Include search queries */
    search?: boolean;
    /** Include pagination */
    pagination?: boolean;
  };

  /** Output settings */
  output?: {
    /** Output format: 'pretty' | 'json' | 'minimal' */
    format?: 'pretty' | 'json' | 'minimal';
    /** Enable colors */
    colors?: boolean;
    /** Verbosity level */
    verbose?: boolean;
    /** Quiet mode (minimal output) */
    quiet?: boolean;
  };

  /** Logging settings */
  logging?: {
    /** Log level: 'debug' | 'info' | 'warn' | 'error' */
    level?: 'debug' | 'info' | 'warn' | 'error';
    /** Log file path */
    file?: string;
    /** Enable log rotation */
    rotate?: boolean;
  };
}

export interface LoadedConfig {
  config: SunsetterConfig;
  source: string;
  path: string | null;
}

// ============================================================================
// Config File Locations
// ============================================================================

const CONFIG_FILES = [
  '.sunsetterrc',
  '.sunsetterrc.json',
  '.sunsetterrc.js',
  '.sunsetterrc.cjs',
  'sunsetter.config.js',
  'sunsetter.config.cjs',
  'sunsetter.config.mjs',
];

// ============================================================================
// Loader Functions
// ============================================================================

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load JSON config file
 */
async function loadJsonConfig(filePath: string): Promise<SunsetterConfig> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Load JS/CJS config file
 */
async function loadJsConfig(filePath: string): Promise<SunsetterConfig> {
  const absolutePath = path.resolve(filePath);
  const module = await import(`file://${absolutePath}`);
  return module.default || module;
}

/**
 * Load config from package.json
 */
async function loadPackageJsonConfig(
  dir: string
): Promise<SunsetterConfig | null> {
  const pkgPath = path.join(dir, 'package.json');
  if (!(await fileExists(pkgPath))) {
    return null;
  }

  try {
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.sunsetter || null;
  } catch {
    return null;
  }
}

/**
 * Find and load configuration file
 */
export async function loadConfig(
  startDir: string = process.cwd()
): Promise<LoadedConfig> {
  // Search for config files in current directory
  for (const configFile of CONFIG_FILES) {
    const configPath = path.join(startDir, configFile);
    if (await fileExists(configPath)) {
      try {
        let config: SunsetterConfig;

        if (configFile.endsWith('.json') || configFile === '.sunsetterrc') {
          config = await loadJsonConfig(configPath);
        } else {
          config = await loadJsConfig(configPath);
        }

        return {
          config,
          source: configFile,
          path: configPath,
        };
      } catch (error) {
        console.warn(
          `Warning: Failed to load ${configFile}: ${(error as Error).message}`
        );
      }
    }
  }

  // Check package.json
  const pkgConfig = await loadPackageJsonConfig(startDir);
  if (pkgConfig) {
    return {
      config: pkgConfig,
      source: 'package.json',
      path: path.join(startDir, 'package.json'),
    };
  }

  // Walk up directory tree
  const parentDir = path.dirname(startDir);
  if (parentDir !== startDir) {
    // Check parent directories (up to 5 levels)
    let currentDir = parentDir;
    let depth = 0;
    while (depth < 5 && currentDir !== path.dirname(currentDir)) {
      for (const configFile of CONFIG_FILES) {
        const configPath = path.join(currentDir, configFile);
        if (await fileExists(configPath)) {
          try {
            let config: SunsetterConfig;

            if (configFile.endsWith('.json') || configFile === '.sunsetterrc') {
              config = await loadJsonConfig(configPath);
            } else {
              config = await loadJsConfig(configPath);
            }

            return {
              config,
              source: configFile,
              path: configPath,
            };
          } catch {
            // Continue searching
          }
        }
      }
      currentDir = path.dirname(currentDir);
      depth++;
    }
  }

  // Return empty config if nothing found
  return {
    config: {},
    source: 'default',
    path: null,
  };
}

/**
 * Merge CLI options with config file
 * CLI options take precedence
 */
export function mergeConfig(
  fileConfig: SunsetterConfig,
  cliOptions: Record<string, unknown>
): SunsetterConfig {
  const merged = { ...fileConfig };

  // Map CLI options to config structure
  if (cliOptions.connection) {
    merged.connection = merged.connection || {};
    merged.connection.string = cliOptions.connection as string;
  }

  if (cliOptions.host) {
    merged.connection = merged.connection || {};
    merged.connection.host = cliOptions.host as string;
  }

  if (cliOptions.port) {
    merged.connection = merged.connection || {};
    merged.connection.port = parseInt(cliOptions.port as string);
  }

  if (cliOptions.database) {
    merged.connection = merged.connection || {};
    merged.connection.database = cliOptions.database as string;
  }

  if (cliOptions.tables) {
    merged.migration = merged.migration || {};
    merged.migration.tables = (cliOptions.tables as string)
      .split(',')
      .map((t) => t.trim());
  }

  if (cliOptions.exclude) {
    merged.migration = merged.migration || {};
    merged.migration.excludeTables = (cliOptions.exclude as string)
      .split(',')
      .map((t) => t.trim());
  }

  if (cliOptions.output) {
    merged.migration = merged.migration || {};
    merged.migration.outputDir = cliOptions.output as string;
  }

  if (cliOptions.batchSize) {
    merged.migration = merged.migration || {};
    merged.migration.batchSize = parseInt(cliOptions.batchSize as string);
  }

  if (cliOptions.parallel !== undefined) {
    merged.migration = merged.migration || {};
    merged.migration.parallel = cliOptions.parallel as boolean;
  }

  if (cliOptions.dryRun !== undefined) {
    merged.migration = merged.migration || {};
    merged.migration.dryRun = cliOptions.dryRun as boolean;
  }

  if (cliOptions.json !== undefined) {
    merged.output = merged.output || {};
    merged.output.format = cliOptions.json ? 'json' : 'pretty';
  }

  if (cliOptions.quiet !== undefined) {
    merged.output = merged.output || {};
    merged.output.quiet = cliOptions.quiet as boolean;
  }

  if (cliOptions.verbose !== undefined) {
    merged.output = merged.output || {};
    merged.output.verbose = cliOptions.verbose as boolean;
  }

  return merged;
}

/**
 * Create a sample config file
 */
export function generateSampleConfig(): string {
  const sample: SunsetterConfig = {
    connection: {
      string: 'postgresql://user:password@localhost:5432/database',
    },
    convex: {
      deploymentUrl: 'https://your-deployment.convex.cloud',
      adminKey: 'your-admin-key',
    },
    migration: {
      tables: [],
      excludeTables: ['_prisma_migrations', 'schema_migrations'],
      schemas: ['public'],
      batchSize: 100,
      parallel: true,
      maxParallelTables: 4,
      dryRun: false,
      outputDir: './convex',
    },
    generation: {
      queries: true,
      mutations: true,
      actions: true,
      httpActions: false,
      batchOperations: true,
      search: true,
      pagination: true,
    },
    output: {
      format: 'pretty',
      colors: true,
      verbose: false,
      quiet: false,
    },
    logging: {
      level: 'info',
      file: './logs/migration.log',
      rotate: true,
    },
  };

  return JSON.stringify(sample, null, 2);
}

/**
 * Validate config file
 */
export function validateConfig(config: SunsetterConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check connection
  if (config.connection) {
    if (!config.connection.string && !config.connection.host) {
      errors.push('connection: Either "string" or "host" must be specified');
    }
  }

  // Check migration settings
  if (config.migration) {
    if (config.migration.batchSize !== undefined) {
      if (
        config.migration.batchSize < 1 ||
        config.migration.batchSize > 10000
      ) {
        errors.push('migration.batchSize: Must be between 1 and 10000');
      }
    }

    if (config.migration.maxParallelTables !== undefined) {
      if (
        config.migration.maxParallelTables < 1 ||
        config.migration.maxParallelTables > 16
      ) {
        errors.push('migration.maxParallelTables: Must be between 1 and 16');
      }
    }
  }

  // Check logging settings
  if (config.logging?.level) {
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLevels.includes(config.logging.level)) {
      errors.push(`logging.level: Must be one of: ${validLevels.join(', ')}`);
    }
  }

  // Check output format
  if (config.output?.format) {
    const validFormats = ['pretty', 'json', 'minimal'];
    if (!validFormats.includes(config.output.format)) {
      errors.push(`output.format: Must be one of: ${validFormats.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
