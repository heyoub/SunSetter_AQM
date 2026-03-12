/**
 * Post-Migration Verification Tests
 *
 * Comprehensive testing suite for the verification engine that validates
 * data integrity after migration.
 *
 * Test Categories:
 * - Example tests: Known scenarios with expected outcomes
 * - Property tests: Invariants for verification logic
 * - Mock-based tests: Behavior with various adapter/client states
 */

import { jest } from '@jest/globals';
import * as fc from 'fast-check';
import {
  MigrationVerifier,
  formatVerificationReport,
  formatVerificationReportJson,
  type TableVerificationResult,
  type VerificationReport,
  type VerificationOptions,
} from '../../src/migration/verification';
import type { DatabaseAdapter } from '../../src/adapters/index';
import type { IConvexClient, IIdMapper } from '../../src/shared/types';
import { tableName, sourceId, convexId } from '../utils/test-generators';

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Create a mock database adapter
 */
function createMockAdapter(config: {
  rowCounts?: Record<string, number>;
  sampleRows?: Record<string, Array<Record<string, unknown>>>;
}): DatabaseAdapter {
  const { rowCounts = {}, sampleRows = {} } = config;

  return {
    type: 'postgresql' as const,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
    getTableRowCount: jest.fn().mockImplementation((_schema, table) => {
      return Promise.resolve(rowCounts[table] || 0);
    }),
    streamRows: jest.fn().mockImplementation(function* (_schema, table) {
      const rows = sampleRows[table] || [];
      yield { rows, totalFetched: rows.length, isLastBatch: true };
    }),
    getDefaultSchema: jest.fn().mockReturnValue('public'),
    getSchemas: jest.fn().mockResolvedValue(['public']),
    getTables: jest.fn().mockResolvedValue([]),
    getColumns: jest.fn().mockResolvedValue([]),
    getPrimaryKeys: jest.fn().mockResolvedValue([]),
    getForeignKeys: jest.fn().mockResolvedValue([]),
    getIndexes: jest.fn().mockResolvedValue([]),
    getDatabaseType: jest.fn().mockReturnValue('postgresql'),
    getDatabaseName: jest.fn().mockReturnValue('test'),
    escapeIdentifier: jest.fn().mockImplementation((name) => `"${name}"`),
    isConnected: jest.fn().mockReturnValue(true),
    testConnection: jest.fn().mockResolvedValue(true),
  };
}

/**
 * Create a mock Convex client
 */
function createMockConvexClient(config: {
  documentCounts?: Record<string, number>;
  documents?: Record<string, Array<Record<string, unknown>>>;
  documentMap?: Record<string, Record<string, unknown>>;
}): IConvexClient {
  const { documentCounts = {}, documents = {}, documentMap = {} } = config;

  return {
    insert: jest.fn(),
    batchInsert: jest.fn(),
    delete: jest.fn(),
    batchDelete: jest.fn(),
    truncateTable: jest.fn(),
    query: jest.fn().mockImplementation((table) => {
      return Promise.resolve(documents[table] || []);
    }),
    countDocuments: jest.fn().mockImplementation((table) => {
      return Promise.resolve(documentCounts[table] || 0);
    }),
    getDocument: jest.fn().mockImplementation((_table, id) => {
      return Promise.resolve(documentMap[id] || null);
    }),
    healthCheck: jest.fn().mockResolvedValue(true),
  };
}

/**
 * Create a mock ID mapper
 */
function createMockIdMapper(
  mappings: Record<string, Map<string | number, string>>
): IIdMapper {
  return {
    get: (table, sourceId) => mappings[table]?.get(sourceId),
    set: jest.fn(),
    has: (table, sourceId) => mappings[table]?.has(sourceId) || false,
    clear: jest.fn(),
    count: () => Object.values(mappings).reduce((sum, m) => sum + m.size, 0),
    countForTable: (table) => mappings[table]?.size || 0,
    getTableMappings: (table) => mappings[table] || new Map(),
    save: jest.fn(),
    load: jest.fn(),
  };
}

// ============================================================================
// EXAMPLE-BASED TESTS
// ============================================================================

describe('MigrationVerifier - Example Tests', () => {
  describe('verifyTable', () => {
    it('should return success when counts match', async () => {
      const adapter = createMockAdapter({
        rowCounts: { users: 100 },
        sampleRows: {
          users: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
        },
      });

      const client = createMockConvexClient({
        documentCounts: { users: 100 },
        documentMap: {
          'users:abc123': { id: 1, name: 'Alice' },
          'users:def456': { id: 2, name: 'Bob' },
        },
      });

      const idMapper = createMockIdMapper({
        users: new Map([
          [1, 'users:abc123'],
          [2, 'users:def456'],
        ]),
      });

      const verifier = new MigrationVerifier(adapter, client, idMapper);
      const result = await verifier.verifyTable('users');

      expect(result.countMatch).toBe(true);
      expect(result.overallSuccess).toBe(true);
      expect(result.sourceRowCount).toBe(100);
      expect(result.convexDocumentCount).toBe(100);
    });

    it('should detect count mismatch with positive difference', async () => {
      const adapter = createMockAdapter({ rowCounts: { users: 100 } });
      const client = createMockConvexClient({ documentCounts: { users: 90 } });
      const idMapper = createMockIdMapper({ users: new Map() });

      const verifier = new MigrationVerifier(adapter, client, idMapper);
      const result = await verifier.verifyTable('users');

      expect(result.countMatch).toBe(false);
      expect(result.countDifference).toBe(10);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should detect count mismatch with negative difference', async () => {
      const adapter = createMockAdapter({ rowCounts: { users: 90 } });
      const client = createMockConvexClient({ documentCounts: { users: 100 } });
      const idMapper = createMockIdMapper({ users: new Map() });

      const verifier = new MigrationVerifier(adapter, client, idMapper);
      const result = await verifier.verifyTable('users');

      expect(result.countMatch).toBe(false);
      expect(result.countDifference).toBe(-10);
    });

    it('should skip sample verification for large tables', async () => {
      const adapter = createMockAdapter({ rowCounts: { users: 2000000 } });
      const client = createMockConvexClient({
        documentCounts: { users: 2000000 },
      });
      const idMapper = createMockIdMapper({ users: new Map() });

      const verifier = new MigrationVerifier(adapter, client, idMapper, {
        skipLargeTableThreshold: 1000000,
      });
      const result = await verifier.verifyTable('users');

      expect(result.warnings.some((w) => w.includes('too large'))).toBe(true);
      expect(result.sampleChecks).toHaveLength(0);
    });

    it('should detect missing ID mappings in sample checks', async () => {
      const adapter = createMockAdapter({
        rowCounts: { users: 10 },
        sampleRows: {
          users: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Charlie' },
          ],
        },
      });
      const client = createMockConvexClient({ documentCounts: { users: 10 } });
      // Only 1 and 2 are mapped, 3 is missing
      const idMapper = createMockIdMapper({
        users: new Map([
          [1, 'users:abc'],
          [2, 'users:def'],
        ]),
      });

      const verifier = new MigrationVerifier(adapter, client, idMapper, {
        sampleSize: 3,
      });
      const result = await verifier.verifyTable('users');

      // Should have a failed sample check for id=3
      expect(result.sampleChecks.some((s) => !s.success)).toBe(true);
    });
  });

  describe('verify (full)', () => {
    it('should verify multiple tables', async () => {
      const adapter = createMockAdapter({
        rowCounts: { users: 100, posts: 200 },
        sampleRows: {
          users: [{ id: 1 }],
          posts: [{ id: 1 }],
        },
      });
      const client = createMockConvexClient({
        documentCounts: { users: 100, posts: 200 },
      });
      const idMapper = createMockIdMapper({
        users: new Map([[1, 'users:a']]),
        posts: new Map([[1, 'posts:b']]),
      });

      const verifier = new MigrationVerifier(adapter, client, idMapper);
      const report = await verifier.verify(['users', 'posts'], 'migration-123');

      expect(report.tables).toHaveLength(2);
      expect(report.summary.totalTables).toBe(2);
      expect(report.summary.totalSourceRows).toBe(300);
      expect(report.summary.totalConvexDocs).toBe(300);
    });

    it('should generate recommendations for mismatches', async () => {
      const adapter = createMockAdapter({
        rowCounts: { users: 100 },
        sampleRows: { users: [{ id: 1 }] },
      });
      const client = createMockConvexClient({ documentCounts: { users: 50 } });
      const idMapper = createMockIdMapper({ users: new Map([[1, 'users:a']]) });

      const verifier = new MigrationVerifier(adapter, client, idMapper);
      const report = await verifier.verify(['users'], 'migration-123');

      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations[0]).toContain('users');
    });

    it('should report overall success only when all tables match', async () => {
      const adapter = createMockAdapter({
        rowCounts: { users: 100, posts: 100 },
        sampleRows: {
          users: [{ id: 1 }],
          posts: [{ id: 1 }],
        },
      });
      const client = createMockConvexClient({
        documentCounts: { users: 100, posts: 90 }, // posts has mismatch
        documentMap: {
          'users:a': { id: 1 },
          'posts:b': { id: 1 },
        },
      });
      const idMapper = createMockIdMapper({
        users: new Map([[1, 'users:a']]),
        posts: new Map([[1, 'posts:b']]),
      });

      const verifier = new MigrationVerifier(adapter, client, idMapper);
      const report = await verifier.verify(['users', 'posts'], 'migration-123');

      expect(report.summary.overallSuccess).toBe(false);
      expect(report.summary.tablesMismatched).toBe(1);
    });
  });

  describe('formatVerificationReport', () => {
    it('should format a successful report', () => {
      const report: VerificationReport = {
        migrationId: 'mig-123',
        timestamp: new Date('2024-01-15T10:30:00Z'),
        duration: 5000,
        tables: [
          {
            tableName: 'users',
            sourceRowCount: 100,
            convexDocumentCount: 100,
            countMatch: true,
            countDifference: 0,
            sampleChecks: [],
            overallSuccess: true,
            warnings: [],
            errors: [],
          },
        ],
        summary: {
          totalTables: 1,
          tablesVerified: 1,
          tablesMatched: 1,
          tablesMismatched: 0,
          totalSourceRows: 100,
          totalConvexDocs: 100,
          overallSuccess: true,
        },
        recommendations: [],
      };

      const formatted = formatVerificationReport(report);

      expect(formatted).toContain('VERIFICATION REPORT');
      expect(formatted).toContain('mig-123');
      expect(formatted).toContain('[OK]');
      expect(formatted).toContain('PASSED');
    });

    it('should format a failed report with recommendations', () => {
      const report: VerificationReport = {
        migrationId: 'mig-456',
        timestamp: new Date('2024-01-15T10:30:00Z'),
        duration: 3000,
        tables: [
          {
            tableName: 'posts',
            sourceRowCount: 200,
            convexDocumentCount: 150,
            countMatch: false,
            countDifference: 50,
            sampleChecks: [],
            overallSuccess: false,
            warnings: ['Row count mismatch'],
            errors: [],
          },
        ],
        summary: {
          totalTables: 1,
          tablesVerified: 1,
          tablesMatched: 0,
          tablesMismatched: 1,
          totalSourceRows: 200,
          totalConvexDocs: 150,
          overallSuccess: false,
        },
        recommendations: ['posts: 50 rows in source not in Convex'],
      };

      const formatted = formatVerificationReport(report);

      expect(formatted).toContain('[!!]');
      expect(formatted).toContain('FAILED');
      expect(formatted).toContain('RECOMMENDATIONS');
      expect(formatted).toContain('50 rows');
    });
  });

  describe('formatVerificationReportJson', () => {
    it('should produce valid JSON', () => {
      const report: VerificationReport = {
        migrationId: 'mig-789',
        timestamp: new Date('2024-01-15T10:30:00Z'),
        duration: 1000,
        tables: [],
        summary: {
          totalTables: 0,
          tablesVerified: 0,
          tablesMatched: 0,
          tablesMismatched: 0,
          totalSourceRows: 0,
          totalConvexDocs: 0,
          overallSuccess: true,
        },
        recommendations: [],
      };

      const json = formatVerificationReportJson(report);
      const parsed = JSON.parse(json);

      expect(parsed.migrationId).toBe('mig-789');
      expect(typeof parsed.timestamp).toBe('string');
    });
  });
});

// ============================================================================
// PROPERTY-BASED TESTS
// ============================================================================

describe('MigrationVerifier - Property Tests', () => {
  describe('count difference calculation', () => {
    /**
     * PROPERTY: Count difference is source - convex
     * The difference should always equal sourceRowCount - convexDocumentCount
     */
    it('should correctly calculate count difference', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          async (sourceCount, convexCount) => {
            const adapter = createMockAdapter({
              rowCounts: { test: sourceCount },
            });
            const client = createMockConvexClient({
              documentCounts: { test: convexCount },
            });
            const idMapper = createMockIdMapper({ test: new Map() });

            const verifier = new MigrationVerifier(adapter, client, idMapper, {
              sampleSize: 0,
            });
            const result = await verifier.verifyTable('test');

            expect(result.countDifference).toBe(sourceCount - convexCount);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * PROPERTY: countMatch is true iff difference is 0
     */
    it('should set countMatch true only when counts equal', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 10000 }),
          async (sourceCount, convexCount) => {
            const adapter = createMockAdapter({
              rowCounts: { test: sourceCount },
            });
            const client = createMockConvexClient({
              documentCounts: { test: convexCount },
            });
            const idMapper = createMockIdMapper({ test: new Map() });

            const verifier = new MigrationVerifier(adapter, client, idMapper, {
              sampleSize: 0,
            });
            const result = await verifier.verifyTable('test');

            expect(result.countMatch).toBe(sourceCount === convexCount);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('summary aggregation', () => {
    /**
     * PROPERTY: Total source rows equals sum of individual tables
     */
    it('should correctly sum source rows across tables', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              name: tableName,
              count: fc.integer({ min: 0, max: 10000 }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          async (tables) => {
            // Dedupe table names
            const uniqueTables = tables.reduce(
              (acc, t) => {
                if (!acc.some((x) => x.name === t.name)) acc.push(t);
                return acc;
              },
              [] as typeof tables
            );

            const rowCounts = Object.fromEntries(
              uniqueTables.map((t) => [t.name, t.count])
            );
            const adapter = createMockAdapter({
              rowCounts,
              sampleRows: Object.fromEntries(
                uniqueTables.map((t) => [t.name, []])
              ),
            });
            const client = createMockConvexClient({
              documentCounts: rowCounts,
            });
            const idMapper = createMockIdMapper({});

            const verifier = new MigrationVerifier(adapter, client, idMapper, {
              sampleSize: 0,
            });
            const report = await verifier.verify(
              uniqueTables.map((t) => t.name),
              'test'
            );

            const expectedTotal = uniqueTables.reduce(
              (sum, t) => sum + t.count,
              0
            );
            expect(report.summary.totalSourceRows).toBe(expectedTotal);
          }
        ),
        { numRuns: 20 }
      );
    });

    /**
     * PROPERTY: tablesMatched + tablesMismatched = tablesVerified
     */
    it('should partition tables into matched and mismatched', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              name: tableName,
              sourceCount: fc.integer({ min: 0, max: 1000 }),
              convexCount: fc.integer({ min: 0, max: 1000 }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          async (tables) => {
            const uniqueTables = tables.reduce(
              (acc, t) => {
                if (!acc.some((x) => x.name === t.name)) acc.push(t);
                return acc;
              },
              [] as typeof tables
            );

            const rowCounts = Object.fromEntries(
              uniqueTables.map((t) => [t.name, t.sourceCount])
            );
            const docCounts = Object.fromEntries(
              uniqueTables.map((t) => [t.name, t.convexCount])
            );
            const adapter = createMockAdapter({
              rowCounts,
              sampleRows: Object.fromEntries(
                uniqueTables.map((t) => [t.name, []])
              ),
            });
            const client = createMockConvexClient({
              documentCounts: docCounts,
            });
            const idMapper = createMockIdMapper({});

            const verifier = new MigrationVerifier(adapter, client, idMapper, {
              sampleSize: 0,
            });
            const report = await verifier.verify(
              uniqueTables.map((t) => t.name),
              'test'
            );

            expect(
              report.summary.tablesMatched + report.summary.tablesMismatched
            ).toBe(report.summary.tablesVerified);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('report formatting', () => {
    /**
     * PROPERTY: Formatted report always contains migration ID
     */
    it('should always include migration ID in formatted output', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^mig-[a-z0-9]{5,10}$/),
          (migrationId) => {
            const report: VerificationReport = {
              migrationId,
              timestamp: new Date(),
              duration: 0,
              tables: [],
              summary: {
                totalTables: 0,
                tablesVerified: 0,
                tablesMatched: 0,
                tablesMismatched: 0,
                totalSourceRows: 0,
                totalConvexDocs: 0,
                overallSuccess: true,
              },
              recommendations: [],
            };

            const formatted = formatVerificationReport(report);
            expect(formatted).toContain(migrationId);
          }
        )
      );
    });

    /**
     * PROPERTY: JSON output is always valid JSON
     */
    it('should always produce valid JSON', () => {
      fc.assert(
        fc.property(
          fc.record({
            migrationId: fc.string({ minLength: 1, maxLength: 20 }),
            duration: fc.integer({ min: 0, max: 1000000 }),
            totalRows: fc.integer({ min: 0, max: 1000000 }),
          }),
          ({ migrationId, duration, totalRows }) => {
            const report: VerificationReport = {
              migrationId,
              timestamp: new Date(),
              duration,
              tables: [],
              summary: {
                totalTables: 1,
                tablesVerified: 1,
                tablesMatched: 1,
                tablesMismatched: 0,
                totalSourceRows: totalRows,
                totalConvexDocs: totalRows,
                overallSuccess: true,
              },
              recommendations: [],
            };

            const json = formatVerificationReportJson(report);
            expect(() => JSON.parse(json)).not.toThrow();
          }
        )
      );
    });
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('MigrationVerifier - Edge Cases', () => {
  it('should handle empty table list', async () => {
    const adapter = createMockAdapter({});
    const client = createMockConvexClient({});
    const idMapper = createMockIdMapper({});

    const verifier = new MigrationVerifier(adapter, client, idMapper);
    const report = await verifier.verify([], 'empty-migration');

    expect(report.tables).toHaveLength(0);
    expect(report.summary.overallSuccess).toBe(true);
  });

  it('should handle tables with 0 rows', async () => {
    const adapter = createMockAdapter({
      rowCounts: { empty_table: 0 },
      sampleRows: { empty_table: [] },
    });
    const client = createMockConvexClient({
      documentCounts: { empty_table: 0 },
    });
    const idMapper = createMockIdMapper({ empty_table: new Map() });

    const verifier = new MigrationVerifier(adapter, client, idMapper);
    const result = await verifier.verifyTable('empty_table');

    expect(result.countMatch).toBe(true);
    expect(result.overallSuccess).toBe(true);
  });

  it('should handle adapter errors gracefully', async () => {
    const adapter = createMockAdapter({});
    (adapter.getTableRowCount as jest.Mock).mockRejectedValue(
      new Error('Connection failed')
    );

    const client = createMockConvexClient({});
    const idMapper = createMockIdMapper({});

    const verifier = new MigrationVerifier(adapter, client, idMapper);
    const result = await verifier.verifyTable('users');

    expect(result.overallSuccess).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Connection failed');
  });

  it('should handle Convex client errors gracefully', async () => {
    const adapter = createMockAdapter({ rowCounts: { users: 100 } });
    const client = createMockConvexClient({});
    (client.countDocuments as jest.Mock).mockRejectedValue(
      new Error('API rate limit')
    );

    const idMapper = createMockIdMapper({});

    const verifier = new MigrationVerifier(adapter, client, idMapper);
    const result = await verifier.verifyTable('users');

    expect(result.overallSuccess).toBe(false);
    expect(result.errors.some((e) => e.includes('API rate limit'))).toBe(true);
  });

  it('should handle very large row counts', async () => {
    const largeCount = 10_000_000_000; // 10 billion
    const adapter = createMockAdapter({ rowCounts: { big_table: largeCount } });
    const client = createMockConvexClient({
      documentCounts: { big_table: largeCount },
    });
    const idMapper = createMockIdMapper({ big_table: new Map() });

    const verifier = new MigrationVerifier(adapter, client, idMapper, {
      skipLargeTableThreshold: 1000000,
    });
    const result = await verifier.verifyTable('big_table');

    expect(result.sourceRowCount).toBe(largeCount);
    expect(result.countMatch).toBe(true);
  });

  it('should handle tables with special characters in names', async () => {
    const specialName = 'user_profiles_v2';
    const adapter = createMockAdapter({
      rowCounts: { [specialName]: 10 },
      sampleRows: { [specialName]: [] },
    });
    const client = createMockConvexClient({
      documentCounts: { [specialName]: 10 },
    });
    const idMapper = createMockIdMapper({});

    const verifier = new MigrationVerifier(adapter, client, idMapper, {
      sampleSize: 0,
    });
    const result = await verifier.verifyTable(specialName);

    expect(result.tableName).toBe(specialName);
    expect(result.countMatch).toBe(true);
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe('MigrationVerifier - Configuration', () => {
  it('should respect custom sampleSize', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
    const adapter = createMockAdapter({
      rowCounts: { users: 100 },
      sampleRows: { users: rows },
    });
    const client = createMockConvexClient({ documentCounts: { users: 100 } });
    const mappings = new Map(
      rows.map((r) => [r.id, `users:${r.id}`] as [number, string])
    );
    const idMapper = createMockIdMapper({ users: mappings });

    const verifier = new MigrationVerifier(adapter, client, idMapper, {
      sampleSize: 5,
    });
    const result = await verifier.verifyTable('users');

    // Should have checked 5 samples
    expect(result.sampleChecks.length).toBeLessThanOrEqual(5);
  });

  it('should respect skipLargeTableThreshold', async () => {
    const adapter = createMockAdapter({ rowCounts: { users: 500 } });
    const client = createMockConvexClient({ documentCounts: { users: 500 } });
    const idMapper = createMockIdMapper({ users: new Map() });

    const verifier = new MigrationVerifier(adapter, client, idMapper, {
      skipLargeTableThreshold: 100,
    });
    const result = await verifier.verifyTable('users');

    expect(result.warnings.some((w) => w.includes('too large'))).toBe(true);
  });

  it('should merge default options with provided options', async () => {
    const adapter = createMockAdapter({ rowCounts: { users: 10 } });
    const client = createMockConvexClient({ documentCounts: { users: 10 } });
    const idMapper = createMockIdMapper({ users: new Map() });

    // Only provide sampleSize, other options should use defaults
    const verifier = new MigrationVerifier(adapter, client, idMapper, {
      sampleSize: 3,
    });

    // Should work without errors (using default skipLargeTableThreshold etc)
    const result = await verifier.verifyTable('users');
    expect(result).toBeDefined();
  });
});
