/**
 * Tests for Configuration Loader
 */

import {
  generateSampleConfig,
  validateConfig,
  mergeConfig,
  SunsetterConfig,
} from '../../src/config/config-loader';

describe('Config Loader', () => {
  describe('generateSampleConfig', () => {
    it('should generate valid JSON', () => {
      const config = generateSampleConfig();
      expect(() => JSON.parse(config)).not.toThrow();
    });

    it('should include all required sections', () => {
      const config = JSON.parse(generateSampleConfig()) as SunsetterConfig;
      expect(config.connection).toBeDefined();
      expect(config.convex).toBeDefined();
      expect(config.migration).toBeDefined();
      expect(config.generation).toBeDefined();
      expect(config.output).toBeDefined();
      expect(config.logging).toBeDefined();
    });

    it('should have sensible defaults', () => {
      const config = JSON.parse(generateSampleConfig()) as SunsetterConfig;
      expect(config.migration?.batchSize).toBe(100);
      expect(config.migration?.parallel).toBe(true);
      expect(config.migration?.maxParallelTables).toBe(4);
      expect(config.output?.format).toBe('pretty');
    });
  });

  describe('validateConfig', () => {
    it('should validate empty config', () => {
      const result = validateConfig({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate valid config', () => {
      const config: SunsetterConfig = {
        connection: { string: 'postgresql://localhost/db' },
        migration: { batchSize: 100 },
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid batch size (too small)', () => {
      const config: SunsetterConfig = {
        migration: { batchSize: 0 },
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('batchSize'))).toBe(true);
    });

    it('should reject invalid batch size (too large)', () => {
      const config: SunsetterConfig = {
        migration: { batchSize: 100000 },
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('batchSize'))).toBe(true);
    });

    it('should reject invalid maxParallelTables', () => {
      const config: SunsetterConfig = {
        migration: { maxParallelTables: 50 },
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('maxParallelTables'))).toBe(
        true
      );
    });

    it('should reject invalid log level', () => {
      const config: SunsetterConfig = {
        logging: { level: 'invalid' as 'debug' },
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('level'))).toBe(true);
    });

    it('should reject invalid output format', () => {
      const config: SunsetterConfig = {
        output: { format: 'invalid' as 'json' },
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('format'))).toBe(true);
    });
  });

  describe('mergeConfig', () => {
    it('should merge CLI options with file config', () => {
      const fileConfig: SunsetterConfig = {
        connection: { string: 'postgresql://file' },
        migration: { batchSize: 50 },
      };
      const cliOptions = {
        connection: 'postgresql://cli',
        batchSize: '200',
      };
      const merged = mergeConfig(fileConfig, cliOptions);
      expect(merged.connection?.string).toBe('postgresql://cli');
      expect(merged.migration?.batchSize).toBe(200);
    });

    it('should preserve file config when CLI options not provided', () => {
      const fileConfig: SunsetterConfig = {
        connection: { string: 'postgresql://file' },
        migration: { batchSize: 50, parallel: true },
      };
      const cliOptions = {};
      const merged = mergeConfig(fileConfig, cliOptions);
      expect(merged.connection?.string).toBe('postgresql://file');
      expect(merged.migration?.batchSize).toBe(50);
      expect(merged.migration?.parallel).toBe(true);
    });

    it('should handle tables list from CLI', () => {
      const fileConfig: SunsetterConfig = {};
      const cliOptions = { tables: 'users,orders,products' };
      const merged = mergeConfig(fileConfig, cliOptions);
      expect(merged.migration?.tables).toEqual(['users', 'orders', 'products']);
    });

    it('should handle exclude list from CLI', () => {
      const fileConfig: SunsetterConfig = {};
      const cliOptions = { exclude: '_prisma_migrations, schema_migrations' };
      const merged = mergeConfig(fileConfig, cliOptions);
      expect(merged.migration?.excludeTables).toEqual([
        '_prisma_migrations',
        'schema_migrations',
      ]);
    });

    it('should handle JSON output mode', () => {
      const fileConfig: SunsetterConfig = {};
      const cliOptions = { json: true };
      const merged = mergeConfig(fileConfig, cliOptions);
      expect(merged.output?.format).toBe('json');
    });

    it('should handle dry-run flag', () => {
      const fileConfig: SunsetterConfig = {};
      const cliOptions = { dryRun: true };
      const merged = mergeConfig(fileConfig, cliOptions);
      expect(merged.migration?.dryRun).toBe(true);
    });
  });
});
