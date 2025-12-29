import { promises as fs } from 'fs';
import { join } from 'path';
import { DatabaseConfig } from './database.js';
import { GeneratorOptions } from '../generator/code-generator.js';
import { TypeMappingOptions } from '../mapper/type-mapper.js';
import dotenv from 'dotenv';
import logger from '../utils/logger';

export interface CodegenConfig {
  database: DatabaseConfig;
  generator: GeneratorOptions;
  typeMapping: TypeMappingOptions;
  version: string;
}

export class ConfigManager {
  private configPath: string;

  constructor(configPath: string = './codegen.config.json') {
    this.configPath = configPath;
  }

  async loadConfig(): Promise<CodegenConfig | null> {
    try {
      const configContent = await fs.readFile(this.configPath, 'utf8');
      return JSON.parse(configContent);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        logger.warn('Config file does not exist. Using defaults.');
        return null;
      }
      logger.error(`Failed to load config: ${(error as Error).message}`);
      throw error;
    }
  }

  async saveConfig(config: CodegenConfig): Promise<void> {
    try {
      const configContent = JSON.stringify(config, null, 2);
      await fs.writeFile(this.configPath, configContent, 'utf8');
    } catch (error) {
      logger.error(`Failed to save config: ${(error as Error).message}`);
      throw error;
    }
  }

  async initConfig(): Promise<CodegenConfig> {
    dotenv.config();

    const defaultConfig: CodegenConfig = {
      database: {
        host: 'localhost',
        port: 5432,
        database: 'your_database',
        username: 'your_username',
        password: 'your_password',
        ssl: false,
      },
      generator: {
        outputDir: './generated',
        generateModels: true,
        generateRepositories: true,
        generateServices: true,
        generateValidators: false,
        generateConvexSchema: false,
        generateMigrations: false,
        useZod: false,
        useClassValidator: false,
      },
      typeMapping: {
        useStrict: true,
        useBigInt: true,
        useDate: true,
        useDecimal: false,
        enumAsUnion: true,
        nullableAsOptional: true,
      },
      version: '1.0.0',
    };

    await this.saveConfig(defaultConfig);
    return defaultConfig;
  }

  async updateConfig(updates: Partial<CodegenConfig>): Promise<CodegenConfig> {
    const existingConfig = await this.loadConfig();

    if (!existingConfig) {
      throw new Error('No config file found. Run init command first.');
    }

    const updatedConfig = {
      ...existingConfig,
      ...updates,
      database: {
        ...existingConfig.database,
        ...(updates.database || {}),
      },
      generator: {
        ...existingConfig.generator,
        ...(updates.generator || {}),
      },
      typeMapping: {
        ...existingConfig.typeMapping,
        ...(updates.typeMapping || {}),
      },
    };

    await this.saveConfig(updatedConfig);
    return updatedConfig;
  }

  async validateConfig(config: CodegenConfig): Promise<string[]> {
    const errors: string[] = [];

    // Validate database config
    if (!config.database.host) {
      errors.push('Database host is required');
    }
    if (
      !config.database.port ||
      config.database.port < 1 ||
      config.database.port > 65535
    ) {
      errors.push('Database port must be between 1 and 65535');
    }
    if (!config.database.database) {
      errors.push('Database name is required');
    }
    if (!config.database.username) {
      errors.push('Database username is required');
    }
    if (!config.database.password) {
      errors.push('Database password is required');
    }

    // Validate generator config
    if (!config.generator.outputDir) {
      errors.push('Output directory is required');
    }

    // Validate that at least one generator option is enabled
    const generatorOptions = [
      config.generator.generateModels,
      config.generator.generateRepositories,
      config.generator.generateServices,
      config.generator.generateValidators,
      config.generator.generateConvexSchema,
    ];

    if (!generatorOptions.some((option) => option)) {
      errors.push('At least one generator option must be enabled');
    }

    // Validate that validation options are not conflicting
    if (config.generator.useZod && config.generator.useClassValidator) {
      errors.push('Cannot use both Zod and class-validator simultaneously');
    }

    return errors;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async configExists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }
}

export async function loadConfigFromFile(
  configPath?: string
): Promise<CodegenConfig | null> {
  const manager = new ConfigManager(configPath);
  return manager.loadConfig();
}

export async function saveConfigToFile(
  config: CodegenConfig,
  configPath?: string
): Promise<void> {
  const manager = new ConfigManager(configPath);
  await manager.saveConfig(config);
}
