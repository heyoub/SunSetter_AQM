/**
 * Performance Benchmarks
 *
 * Measures execution time and resource usage for critical operations.
 * Run with: npx jest --testPathPattern=benchmarks --testTimeout=60000
 *
 * These tests establish performance baselines and detect regressions.
 * Each benchmark includes:
 * - Warmup runs to stabilize JIT
 * - Multiple iterations for statistical significance
 * - Memory measurements where applicable
 */

import {
  parseConnectionString,
  validateConnectionString,
  maskPassword,
} from '../../src/utils/connection-validator';
import {
  levenshteinDistance,
  similarityScore,
  calculateSimilarity,
  fuzzyMatch,
  fuzzyMatchLegacy,
} from '../../src/utils/fuzzy-match';
import { IdMapper } from '../../src/migration/id-mapper';
import { DependencyResolver } from '../../src/migration/dependency-resolver';
import type { TableInfo } from '../../src/introspector/schema-introspector';

// ============================================================================
// BENCHMARK UTILITIES
// ============================================================================

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTimeMs: number;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  opsPerSecond: number;
  memoryDeltaMB?: number;
}

/**
 * Run a benchmark with warmup and multiple iterations
 */
function benchmark(
  name: string,
  fn: () => void,
  options: { iterations?: number; warmup?: number } = {}
): BenchmarkResult {
  const { iterations = 1000, warmup = 100 } = options;

  // Warmup phase
  for (let i = 0; i < warmup; i++) {
    fn();
  }

  // Force GC if available
  if (global.gc) {
    global.gc();
  }

  const times: number[] = [];
  const startMemory = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }

  const endMemory = process.memoryUsage().heapUsed;

  const totalTimeMs = times.reduce((a, b) => a + b, 0);
  const avgTimeMs = totalTimeMs / iterations;
  const minTimeMs = Math.min(...times);
  const maxTimeMs = Math.max(...times);
  const opsPerSecond = 1000 / avgTimeMs;
  const memoryDeltaMB = (endMemory - startMemory) / 1024 / 1024;

  return {
    name,
    iterations,
    totalTimeMs,
    avgTimeMs,
    minTimeMs,
    maxTimeMs,
    opsPerSecond,
    memoryDeltaMB,
  };
}

/**
 * Run an async benchmark
 */
async function benchmarkAsync(
  name: string,
  fn: () => Promise<void>,
  options: { iterations?: number; warmup?: number } = {}
): Promise<BenchmarkResult> {
  const { iterations = 100, warmup = 10 } = options;

  // Warmup phase
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  const times: number[] = [];
  const startMemory = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  const endMemory = process.memoryUsage().heapUsed;

  const totalTimeMs = times.reduce((a, b) => a + b, 0);
  const avgTimeMs = totalTimeMs / iterations;
  const minTimeMs = Math.min(...times);
  const maxTimeMs = Math.max(...times);
  const opsPerSecond = 1000 / avgTimeMs;
  const memoryDeltaMB = (endMemory - startMemory) / 1024 / 1024;

  return {
    name,
    iterations,
    totalTimeMs,
    avgTimeMs,
    minTimeMs,
    maxTimeMs,
    opsPerSecond,
    memoryDeltaMB,
  };
}

/**
 * Print benchmark result
 */
function printResult(result: BenchmarkResult): void {
  console.log(`
  📊 ${result.name}
     Iterations: ${result.iterations}
     Avg time:   ${result.avgTimeMs.toFixed(4)} ms
     Min time:   ${result.minTimeMs.toFixed(4)} ms
     Max time:   ${result.maxTimeMs.toFixed(4)} ms
     Ops/sec:    ${result.opsPerSecond.toFixed(2)}
     ${result.memoryDeltaMB !== undefined ? `Memory Δ:  ${result.memoryDeltaMB.toFixed(2)} MB` : ''}
  `);
}

// ============================================================================
// CONNECTION VALIDATOR BENCHMARKS
// ============================================================================

describe('Benchmarks: Connection Validator', () => {
  it('should parse connection strings efficiently', () => {
    const connectionString =
      'postgresql://user:pass@localhost:5432/mydb?sslmode=require';

    const result = benchmark(
      'parseConnectionString',
      () => parseConnectionString(connectionString),
      { iterations: 10000 }
    );

    printResult(result);

    // Performance assertion: should parse at least 10,000 ops/sec
    expect(result.opsPerSecond).toBeGreaterThan(10000);
    // Should complete in under 0.1ms on average
    expect(result.avgTimeMs).toBeLessThan(0.1);
  });

  it('should validate connection strings efficiently', () => {
    const connectionString = 'postgresql://user:pass@db.supabase.com:5432/mydb';

    const result = benchmark(
      'validateConnectionString',
      () => validateConnectionString(connectionString),
      { iterations: 5000 }
    );

    printResult(result);

    // Should handle at least 5,000 ops/sec
    expect(result.opsPerSecond).toBeGreaterThan(5000);
  });

  it('should mask passwords efficiently', () => {
    const connectionStrings = [
      'postgresql://user:secretpassword123@localhost:5432/mydb',
      'mysql://admin:P@ssw0rd!@db.example.com:3306/production',
      'postgresql://user:very-long-password-with-special-chars-!@#$%@host/db',
    ];

    for (const conn of connectionStrings) {
      const result = benchmark(
        `maskPassword (${conn.length} chars)`,
        () => maskPassword(conn),
        { iterations: 10000 }
      );

      // Should be reasonably fast (URL parsing + regex is ~0.1ms)
      // The new implementation prioritizes correctness over speed
      expect(result.avgTimeMs).toBeLessThan(0.2);
    }
  });

  it('should handle long connection strings', () => {
    // Create a connection string with many query parameters
    const params = Array.from(
      { length: 100 },
      (_, i) => `param${i}=value${i}`
    ).join('&');
    const connectionString = `postgresql://user:pass@localhost:5432/mydb?${params}`;

    const result = benchmark(
      'parseConnectionString (long)',
      () => parseConnectionString(connectionString),
      { iterations: 1000 }
    );

    printResult(result);

    // Should still be fast even with many parameters
    expect(result.avgTimeMs).toBeLessThan(1);
  });
});

// ============================================================================
// FUZZY MATCH BENCHMARKS
// ============================================================================

describe('Benchmarks: Fuzzy Match', () => {
  it('should calculate Levenshtein distance efficiently', () => {
    const testCases = [
      { a: 'hello', b: 'hello' }, // Identical
      { a: 'kitten', b: 'sitting' }, // Classic example
      { a: 'saturday', b: 'sunday' }, // Another classic
      { a: 'a'.repeat(100), b: 'b'.repeat(100) }, // Long strings
    ];

    for (const { a, b } of testCases) {
      const result = benchmark(
        `levenshteinDistance (${a.length} x ${b.length})`,
        () => levenshteinDistance(a, b),
        { iterations: 1000 }
      );

      printResult(result);
    }
  });

  it('should handle small candidate lists quickly', () => {
    const candidates = [
      'users',
      'orders',
      'products',
      'categories',
      'customers',
    ];

    const result = benchmark(
      'fuzzyMatch (5 candidates)',
      () => fuzzyMatch('usres', candidates, 0.5),
      { iterations: 5000 }
    );

    printResult(result);
    expect(result.avgTimeMs).toBeLessThan(0.5);
  });

  it('should handle medium candidate lists', () => {
    const candidates = Array.from({ length: 100 }, (_, i) => `table_${i}`);

    const result = benchmark(
      'fuzzyMatch (100 candidates)',
      () => fuzzyMatch('table_50', candidates, 0.5),
      { iterations: 100 }
    );

    printResult(result);
    expect(result.avgTimeMs).toBeLessThan(10);
  });

  it('should handle large candidate lists', () => {
    const candidates = Array.from({ length: 1000 }, (_, i) => `item_${i}`);

    const result = benchmark(
      'fuzzyMatch (1000 candidates)',
      () => fuzzyMatch('item_500', candidates, 0.5),
      { iterations: 20 }
    );

    printResult(result);
    expect(result.avgTimeMs).toBeLessThan(100);
  });

  it('should demonstrate early termination for exact matches', () => {
    const candidates = Array.from({ length: 1000 }, (_, i) => `table_${i}`);

    // Test with exact match at beginning - should be fast due to early termination
    const resultExactFirst = benchmark(
      'fuzzyMatch (exact match at position 0)',
      () => fuzzyMatch('table_0', candidates, 0.5),
      { iterations: 1000 }
    );

    // Test with exact match in middle - should stop early
    const resultExactMiddle = benchmark(
      'fuzzyMatch (exact match at position 500)',
      () => fuzzyMatch('table_500', candidates, 0.5),
      { iterations: 1000 }
    );

    // Test with no exact match - needs to check all candidates
    const resultNoExact = benchmark(
      'fuzzyMatch (no exact match)',
      () => fuzzyMatch('missing_table', candidates, 0.5),
      { iterations: 100 }
    );

    printResult(resultExactFirst);
    printResult(resultExactMiddle);
    printResult(resultNoExact);

    // Exact match at beginning should be significantly faster
    expect(resultExactFirst.avgTimeMs).toBeLessThan(resultNoExact.avgTimeMs);
    // Exact match in middle should still be faster than checking all
    expect(resultExactMiddle.avgTimeMs).toBeLessThan(resultNoExact.avgTimeMs);
  });

  it('should show calculateSimilarity is efficient (single pass)', () => {
    // Compare calculating score and distance separately vs combined
    const str1 = 'users_table_primary';
    const str2 = 'user_table_primary';

    const separateResult = benchmark(
      'Separate: similarityScore + levenshtein',
      () => {
        similarityScore(str1, str2);
        levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
      },
      { iterations: 10000 }
    );

    const combinedResult = benchmark(
      'Combined: calculateSimilarity',
      () => {
        calculateSimilarity(str1, str2);
      },
      { iterations: 10000 }
    );

    printResult(separateResult);
    printResult(combinedResult);

    // Combined should be faster (single distance calculation)
    expect(combinedResult.avgTimeMs).toBeLessThanOrEqual(
      separateResult.avgTimeMs
    );
  });
});

// ============================================================================
// ID MAPPER BENCHMARKS
// ============================================================================

describe('Benchmarks: ID Mapper', () => {
  it('should set mappings efficiently', () => {
    const mapper = new IdMapper();

    const result = benchmark(
      'IdMapper.set',
      () => {
        mapper.set('users', Math.random(), `convex_${Math.random()}`);
      },
      { iterations: 100000 }
    );

    printResult(result);
    expect(result.opsPerSecond).toBeGreaterThan(100000);
  });

  it('should get mappings efficiently', () => {
    const mapper = new IdMapper();

    // Pre-populate with data
    for (let i = 0; i < 10000; i++) {
      mapper.set('users', i, `convex_${i}`);
    }

    let idx = 0;
    const result = benchmark(
      'IdMapper.get (10k entries)',
      () => {
        mapper.get('users', idx++ % 10000);
      },
      { iterations: 100000 }
    );

    printResult(result);
    expect(result.opsPerSecond).toBeGreaterThan(500000);
  });

  it('should scale with large datasets', () => {
    const mapper = new IdMapper();

    // Pre-populate with more data
    for (let i = 0; i < 100000; i++) {
      mapper.set('users', i, `convex_${i}`);
    }

    let idx = 0;
    const result = benchmark(
      'IdMapper.get (100k entries)',
      () => {
        mapper.get('users', idx++ % 100000);
      },
      { iterations: 100000 }
    );

    printResult(result);
    // Map lookup should still be O(1)
    expect(result.opsPerSecond).toBeGreaterThan(500000);
  });

  it('should handle multiple tables efficiently', () => {
    const mapper = new IdMapper();
    const tables = ['users', 'posts', 'comments', 'likes', 'followers'];

    // Pre-populate
    for (const table of tables) {
      for (let i = 0; i < 10000; i++) {
        mapper.set(table, i, `convex_${table}_${i}`);
      }
    }

    let idx = 0;
    const result = benchmark(
      'IdMapper.get (5 tables x 10k)',
      () => {
        const table = tables[idx % 5];
        mapper.get(table, idx++ % 10000);
      },
      { iterations: 100000 }
    );

    printResult(result);
    expect(result.opsPerSecond).toBeGreaterThan(500000);
  });
});

// ============================================================================
// DEPENDENCY RESOLVER BENCHMARKS
// ============================================================================

describe('Benchmarks: Dependency Resolver', () => {
  /**
   * Create test table info
   */
  function createTable(name: string, deps: string[] = []): TableInfo {
    return {
      tableName: name,
      schemaName: 'public',
      tableType: 'BASE TABLE',
      columns: [
        {
          columnName: 'id',
          dataType: 'integer',
          isNullable: false,
          columnDefault: null,
          characterMaximumLength: null,
          numericPrecision: 32,
          numericScale: 0,
          ordinalPosition: 1,
          isIdentity: true,
          isPrimaryKey: true,
          isForeignKey: false,
          foreignKeyTable: null,
          foreignKeyColumn: null,
          description: null,
        },
      ],
      primaryKeys: ['id'],
      foreignKeys: deps.map((dep, i) => ({
        constraintName: `fk_${name}_${dep}_${i}`,
        columnName: `${dep}_id`,
        referencedTable: dep,
        referencedColumn: 'id',
      })),
      indexes: [],
      description: null,
    };
  }

  it('should resolve small graphs quickly', () => {
    const tables = [
      createTable('users'),
      createTable('posts', ['users']),
      createTable('comments', ['posts', 'users']),
    ];

    const result = benchmark(
      'DependencyResolver (3 tables)',
      () => {
        const resolver = new DependencyResolver();
        resolver.resolve(tables);
      },
      { iterations: 10000 }
    );

    printResult(result);
    expect(result.avgTimeMs).toBeLessThan(0.1);
  });

  it('should resolve medium graphs', () => {
    // Create a chain of dependencies
    const tables: TableInfo[] = [];
    for (let i = 0; i < 50; i++) {
      const deps = i > 0 ? [`table_${i - 1}`] : [];
      tables.push(createTable(`table_${i}`, deps));
    }

    const result = benchmark(
      'DependencyResolver (50 table chain)',
      () => {
        const resolver = new DependencyResolver();
        resolver.resolve(tables);
      },
      { iterations: 100 }
    );

    printResult(result);
    expect(result.avgTimeMs).toBeLessThan(10);
  });

  it('should resolve wide dependency graphs', () => {
    // Hub-and-spoke pattern: many tables depend on one central table
    const tables: TableInfo[] = [createTable('central')];
    for (let i = 0; i < 100; i++) {
      tables.push(createTable(`spoke_${i}`, ['central']));
    }

    const result = benchmark(
      'DependencyResolver (hub-spoke, 101 tables)',
      () => {
        const resolver = new DependencyResolver();
        resolver.resolve(tables);
      },
      { iterations: 50 }
    );

    printResult(result);
    expect(result.avgTimeMs).toBeLessThan(50);
  });
});

// ============================================================================
// MEMORY BENCHMARKS
// ============================================================================

describe('Benchmarks: Memory Usage', () => {
  it('should track ID mapper memory growth', () => {
    const sizes = [1000, 10000, 100000];

    for (const size of sizes) {
      const startMemory = process.memoryUsage().heapUsed;

      const mapper = new IdMapper();
      for (let i = 0; i < size; i++) {
        mapper.set('users', i, `convex_user_${i}`);
      }

      const endMemory = process.memoryUsage().heapUsed;
      const memoryMB = (endMemory - startMemory) / 1024 / 1024;
      const bytesPerEntry = (endMemory - startMemory) / size;

      console.log(`
      📊 IdMapper Memory (${size} entries)
         Total: ${memoryMB.toFixed(2)} MB
         Per entry: ${bytesPerEntry.toFixed(2)} bytes
      `);

      // Cleanup
      mapper.clear();
    }
  });
});
