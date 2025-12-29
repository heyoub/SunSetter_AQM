/**
 * ID Mapper Tests
 *
 * Tests for PostgreSQL to Convex ID mapping functionality.
 */

import { IdMapper } from '../../src/migration/id-mapper';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('IdMapper', () => {
  let tempDir: string;
  let persistPath: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `id-mapper-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    persistPath = path.join(tempDir, 'id-mappings.json');
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('basic operations', () => {
    it('should store and retrieve ID mappings', () => {
      const mapper = new IdMapper();

      mapper.set('users', 1, 'convex_abc123');
      mapper.set('users', 2, 'convex_def456');

      expect(mapper.get('users', 1)).toBe('convex_abc123');
      expect(mapper.get('users', 2)).toBe('convex_def456');
    });

    it('should return undefined for non-existent mappings', () => {
      const mapper = new IdMapper();

      expect(mapper.get('users', 999)).toBeUndefined();
      expect(mapper.get('nonexistent', 1)).toBeUndefined();
    });

    it('should check if mapping exists', () => {
      const mapper = new IdMapper();

      mapper.set('users', 1, 'convex_abc123');

      expect(mapper.has('users', 1)).toBe(true);
      expect(mapper.has('users', 2)).toBe(false);
      expect(mapper.has('posts', 1)).toBe(false);
    });

    it('should get all mappings for a table', () => {
      const mapper = new IdMapper();

      mapper.set('users', 1, 'convex_1');
      mapper.set('users', 2, 'convex_2');
      mapper.set('users', 3, 'convex_3');

      const mappings = mapper.getTableMappings('users');

      expect(mappings.size).toBe(3);
    });

    it('should return empty map for non-existent table', () => {
      const mapper = new IdMapper();

      const mappings = mapper.getTableMappings('nonexistent');

      expect(mappings.size).toBe(0);
    });

    it('should handle string IDs', () => {
      const mapper = new IdMapper();

      mapper.set('users', 'uuid-123', 'convex_abc');
      mapper.set('users', 'uuid-456', 'convex_def');

      expect(mapper.get('users', 'uuid-123')).toBe('convex_abc');
      expect(mapper.get('users', 'uuid-456')).toBe('convex_def');
    });
  });

  describe('clear', () => {
    it('should clear all mappings', () => {
      const mapper = new IdMapper();

      mapper.set('users', 1, 'convex_1');
      mapper.set('posts', 1, 'convex_2');

      mapper.clear();

      expect(mapper.has('users', 1)).toBe(false);
      expect(mapper.has('posts', 1)).toBe(false);
    });
  });

  describe('count', () => {
    it('should return total mapping count', () => {
      const mapper = new IdMapper();

      mapper.set('users', 1, 'convex_1');
      mapper.set('users', 2, 'convex_2');
      mapper.set('posts', 1, 'convex_3');

      expect(mapper.count()).toBe(3);
    });

    it('should return count for specific table', () => {
      const mapper = new IdMapper();

      mapper.set('users', 1, 'convex_1');
      mapper.set('users', 2, 'convex_2');
      mapper.set('posts', 1, 'convex_3');

      expect(mapper.countForTable('users')).toBe(2);
      expect(mapper.countForTable('posts')).toBe(1);
      expect(mapper.countForTable('comments')).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should save and load mappings', async () => {
      const mapper1 = new IdMapper({ persistPath });

      mapper1.set('users', 1, 'convex_1');
      mapper1.set('users', 2, 'convex_2');
      mapper1.set('posts', 1, 'convex_3');

      await mapper1.save();

      const mapper2 = new IdMapper({ persistPath });
      await mapper2.load();

      expect(mapper2.get('users', 1)).toBe('convex_1');
      expect(mapper2.get('users', 2)).toBe('convex_2');
      expect(mapper2.get('posts', 1)).toBe('convex_3');
    });

    it('should handle loading when no file exists', async () => {
      const nonExistentPath = path.join(tempDir, 'nonexistent', 'mappings.json');
      const mapper = new IdMapper({ persistPath: nonExistentPath });

      // Should not throw
      await expect(mapper.load()).resolves.toBeUndefined();
    });
  });

  describe('multiple tables', () => {
    it('should keep mappings separate per table', () => {
      const mapper = new IdMapper();

      // Same PostgreSQL ID in different tables
      mapper.set('users', 1, 'convex_user_1');
      mapper.set('posts', 1, 'convex_post_1');
      mapper.set('comments', 1, 'convex_comment_1');

      expect(mapper.get('users', 1)).toBe('convex_user_1');
      expect(mapper.get('posts', 1)).toBe('convex_post_1');
      expect(mapper.get('comments', 1)).toBe('convex_comment_1');
    });
  });

});
