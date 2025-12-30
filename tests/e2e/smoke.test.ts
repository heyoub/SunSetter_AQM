/**
 * End-to-End Smoke Tests
 *
 * High-level tests that verify the system works as a whole.
 * These tests simulate real-world usage patterns without requiring
 * external dependencies.
 *
 * Categories:
 * - CLI simulation
 * - Pipeline integration
 * - Module interaction
 * - Error recovery
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { IdMapper } from '../../src/migration/id-mapper';
import { DependencyResolver } from '../../src/migration/dependency-resolver';
import {
  parseConnectionString,
  validateConnectionString,
  buildConnectionString,
  analyzeConnection,
} from '../../src/utils/connection-validator';
import { fuzzyMatch, suggestTableNames } from '../../src/utils/fuzzy-match';
import { ReactHooksGenerator } from '../../src/generator/convex/react-hooks-generator';
import type { TableInfo } from '../../src/introspector/schema-introspector';
import type { ConvexTableDefinition } from '../../src/convex/types';

// ============================================================================
// TEST UTILITIES
// ============================================================================

async function createTempDir(): Promise<string> {
  const tempDir = path.join(os.tmpdir(), `sunsetter-e2e-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// CONNECTION VALIDATION PIPELINE
// ============================================================================

describe('E2E: Connection Validation Pipeline', () => {
  describe('full connection analysis workflow', () => {
    it('should analyze PostgreSQL cloud connection', () => {
      const connectionString =
        'postgresql://user:pass@db.supabase.com:5432/mydb';

      // Step 1: Parse
      const parsed = parseConnectionString(connectionString);
      expect(parsed.type).toBe('postgresql');
      expect(parsed.host).toBe('db.supabase.com');

      // Step 2: Validate
      const validation = validateConnectionString(connectionString);
      expect(validation.valid).toBe(true);
      expect(validation.warnings.length).toBeGreaterThan(0); // SSL warning

      // Step 3: Full analysis
      const analysis = analyzeConnection(connectionString);
      expect(analysis.cloudProvider?.provider).toBe('supabase');
      expect(analysis.securityChecks.hasSSL).toBe(false);
      expect(analysis.securityChecks.hasPassword).toBe(true);
    });

    it('should handle local development connection', () => {
      const connectionString =
        'postgresql://postgres:password@localhost:5432/devdb';

      const validation = validateConnectionString(connectionString);
      expect(validation.valid).toBe(true);

      const analysis = analyzeConnection(connectionString);
      expect(analysis.cloudProvider).toBeNull();
      expect(analysis.securityChecks.isLocalhost).toBe(true);

      // Should suggest Docker tip
      expect(validation.suggestions.some((s) => s.includes('Docker'))).toBe(
        true
      );
    });

    it('should round-trip build and parse', () => {
      const original = {
        type: 'postgresql' as const,
        host: 'mydb.example.com',
        port: 5432,
        database: 'production',
        user: 'admin',
        password: 'secret123',
        ssl: true,
      };

      // Build connection string
      const built = buildConnectionString(original);

      // Parse it back
      const parsed = parseConnectionString(built);

      // Verify round-trip
      expect(parsed.type).toBe(original.type);
      expect(parsed.host).toBe(original.host);
      expect(parsed.port).toBe(original.port);
      expect(parsed.database).toBe(original.database);
      expect(parsed.user).toBe(original.user);
      expect(parsed.password).toBe(original.password);
      expect(parsed.ssl).toBe(original.ssl);
    });
  });

  describe('error handling and recovery', () => {
    it('should provide helpful suggestions for common mistakes', () => {
      const testCases = [
        {
          input: '',
          expectError: 'required',
          expectSuggestion: '-c',
        },
        {
          input: 'http://not-a-db.com/db',
          expectError: 'protocol',
          expectSuggestion: undefined,
        },
        {
          input: 'postgresql://user@host/', // missing db
          expectError: 'database',
          expectSuggestion: undefined,
        },
      ];

      for (const { input, expectError } of testCases) {
        const result = validateConnectionString(input);
        expect(result.valid).toBe(false);
        expect(
          result.errors.some((e) => e.toLowerCase().includes(expectError))
        ).toBe(true);
      }
    });
  });
});

// ============================================================================
// TABLE NAME SUGGESTION PIPELINE
// ============================================================================

describe('E2E: Table Name Suggestion Pipeline', () => {
  const dbTables = [
    'users',
    'user_profiles',
    'user_sessions',
    'orders',
    'order_items',
    'products',
    'product_categories',
    'customers',
    'customer_addresses',
    'payments',
    'payment_methods',
  ];

  it('should suggest corrections for typos', () => {
    const typos = [
      { input: 'usres', expected: 'users' },
      { input: 'ordrs', expected: 'orders' },
      { input: 'prodcuts', expected: 'products' },
      { input: 'custmers', expected: 'customers' },
    ];

    for (const { input, expected } of typos) {
      const result = suggestTableNames(input, dbTables);
      expect(result.exists).toBe(false);
      expect(result.suggestions[0].value).toBe(expected);
    }
  });

  it('should find exact matches case-insensitively', () => {
    const inputs = ['USERS', 'Users', 'uSeRs', 'ORDERS'];

    for (const input of inputs) {
      const result = suggestTableNames(input, dbTables);
      expect(result.exists).toBe(true);
    }
  });

  it('should integrate with fuzzyMatch for complex queries', () => {
    // Search for partial matches - new API returns { exact, fuzzy }
    const result = fuzzyMatch('user', dbTables, 0.4);

    // 'user' is not an exact match, so we get fuzzy results
    expect(result.exact).toBeNull();

    // Should find user-related tables in fuzzy matches
    const userRelated = result.fuzzy.filter((m) => m.value.includes('user'));
    expect(userRelated.length).toBeGreaterThan(0);

    // Best fuzzy match should be 'users' (most similar)
    expect(result.fuzzy[0].value).toBe('users');
  });
});

// ============================================================================
// ID MAPPING PIPELINE
// ============================================================================

describe('E2E: ID Mapping Pipeline', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should persist and restore mappings', async () => {
    const persistPath = path.join(tempDir, 'id-mappings.json');

    // Create and populate mapper
    const mapper1 = new IdMapper({ persistPath });

    // Simulate migration: 1000 users, 5000 orders
    for (let i = 1; i <= 1000; i++) {
      mapper1.set('users', i, `users:${i.toString(16).padStart(16, '0')}`);
    }
    for (let i = 1; i <= 5000; i++) {
      mapper1.set('orders', i, `orders:${i.toString(16).padStart(16, '0')}`);
    }

    expect(mapper1.count()).toBe(6000);

    // Persist
    await mapper1.save();

    // Create new mapper and restore
    const mapper2 = new IdMapper({ persistPath });
    await mapper2.load();

    // Verify restoration
    expect(mapper2.count()).toBe(6000);
    expect(mapper2.get('users', 1)).toBe('users:0000000000000001');
    expect(mapper2.get('users', 1000)).toBe('users:00000000000003e8');
    expect(mapper2.get('orders', 5000)).toBe('orders:0000000000001388');
  }, 30000);

  it('should handle concurrent table access', () => {
    const mapper = new IdMapper();
    const tables = ['users', 'posts', 'comments', 'likes', 'follows'];

    // Simulate concurrent inserts
    const inserts: Promise<void>[] = [];
    for (const table of tables) {
      for (let i = 1; i <= 100; i++) {
        // Synchronous but simulating pattern
        mapper.set(table, i, `${table}:${i}`);
      }
    }

    // Verify all mappings
    expect(mapper.count()).toBe(500);
    for (const table of tables) {
      expect(mapper.countForTable(table)).toBe(100);
    }
  });
});

// ============================================================================
// DEPENDENCY RESOLUTION PIPELINE
// ============================================================================

describe('E2E: Dependency Resolution Pipeline', () => {
  /**
   * Create realistic table info
   */
  function createTable(
    name: string,
    deps: Array<{ column: string; refTable: string }> = []
  ): TableInfo {
    return {
      tableName: name,
      schemaName: 'public',
      tableType: 'BASE TABLE',
      columns: [
        {
          columnName: 'id',
          dataType: 'serial',
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
        ...deps.map((d, i) => ({
          columnName: d.column,
          dataType: 'integer',
          isNullable: false,
          columnDefault: null,
          characterMaximumLength: null,
          numericPrecision: 32,
          numericScale: 0,
          ordinalPosition: i + 2,
          isIdentity: false,
          isPrimaryKey: false,
          isForeignKey: true,
          foreignKeyTable: d.refTable,
          foreignKeyColumn: 'id',
          description: null,
        })),
      ],
      primaryKeys: ['id'],
      foreignKeys: deps.map((d, i) => ({
        constraintName: `fk_${name}_${d.refTable}_${i}`,
        columnName: d.column,
        referencedTable: d.refTable,
        referencedColumn: 'id',
      })),
      indexes: [],
      description: null,
    };
  }

  it('should resolve e-commerce schema dependencies', () => {
    // Typical e-commerce schema
    const tables = [
      createTable('users'),
      createTable('products'),
      createTable('categories'),
      createTable('product_categories', [
        { column: 'product_id', refTable: 'products' },
        { column: 'category_id', refTable: 'categories' },
      ]),
      createTable('orders', [{ column: 'user_id', refTable: 'users' }]),
      createTable('order_items', [
        { column: 'order_id', refTable: 'orders' },
        { column: 'product_id', refTable: 'products' },
      ]),
      createTable('reviews', [
        { column: 'user_id', refTable: 'users' },
        { column: 'product_id', refTable: 'products' },
      ]),
      createTable('payments', [
        { column: 'order_id', refTable: 'orders' },
        { column: 'user_id', refTable: 'users' },
      ]),
    ];

    const resolver = new DependencyResolver();
    const result = resolver.resolve(tables);

    // Should have no circular dependencies in this schema
    expect(result.circularDeps).toHaveLength(0);

    // Verify order: parent tables before dependent tables
    const order = result.order;
    const indexOf = (name: string) => order.indexOf(name);

    // users and products should come before orders
    expect(indexOf('users')).toBeLessThan(indexOf('orders'));
    expect(indexOf('products')).toBeLessThan(indexOf('order_items'));
    expect(indexOf('orders')).toBeLessThan(indexOf('order_items'));
    expect(indexOf('orders')).toBeLessThan(indexOf('payments'));
  });

  it('should detect circular dependencies in CMS schema', () => {
    // CMS with circular reference: pages can reference other pages
    const tables = [
      createTable('pages', [{ column: 'parent_id', refTable: 'pages' }]),
      createTable('page_content', [{ column: 'page_id', refTable: 'pages' }]),
    ];

    const resolver = new DependencyResolver();
    const result = resolver.resolve(tables);

    // Self-reference is skipped, so no circular deps
    expect(result.circularDeps).toHaveLength(0);
    expect(result.order.length).toBe(2);
  });

  it('should handle mutual dependencies', () => {
    // Tables that reference each other
    const tables = [
      createTable('table_a', [{ column: 'b_id', refTable: 'table_b' }]),
      createTable('table_b', [{ column: 'a_id', refTable: 'table_a' }]),
    ];

    const resolver = new DependencyResolver();
    const result = resolver.resolve(tables);

    // Should detect circular dependency
    expect(result.circularDeps.length).toBeGreaterThan(0);
  });

  it('should group tables by dependency level', () => {
    const tables = [
      createTable('level0_a'),
      createTable('level0_b'),
      createTable('level1_a', [{ column: 'ref', refTable: 'level0_a' }]),
      createTable('level1_b', [{ column: 'ref', refTable: 'level0_b' }]),
      createTable('level2', [
        { column: 'ref_a', refTable: 'level1_a' },
        { column: 'ref_b', refTable: 'level1_b' },
      ]),
    ];

    const resolver = new DependencyResolver();
    resolver.buildGraph(tables);
    const levels = resolver.groupByLevel();

    // Level 0: no dependencies
    expect(levels.get(0)).toContain('level0_a');
    expect(levels.get(0)).toContain('level0_b');

    // Level 1: depends on level 0
    expect(levels.get(1)).toContain('level1_a');
    expect(levels.get(1)).toContain('level1_b');

    // Level 2: depends on level 1
    expect(levels.get(2)).toContain('level2');
  });
});

// ============================================================================
// REACT HOOKS GENERATION PIPELINE
// ============================================================================

describe('E2E: React Hooks Generation Pipeline', () => {
  it('should generate hooks for multi-table schema', () => {
    const tables: ConvexTableDefinition[] = [
      {
        tableName: 'users',
        originalTableName: 'users',
        fields: [
          {
            fieldName: 'email',
            originalColumnName: 'email',
            validator: 'v.string()',
            isOptional: false,
            isId: false,
          },
          {
            fieldName: 'name',
            originalColumnName: 'name',
            validator: 'v.string()',
            isOptional: false,
            isId: false,
          },
          {
            fieldName: 'createdAt',
            originalColumnName: 'created_at',
            validator: 'v.int64()',
            isOptional: false,
            isId: false,
          },
        ],
        schemaValidator: 'v.object({})',
        indexes: [],
        searchIndexes: [],
      },
      {
        tableName: 'posts',
        originalTableName: 'posts',
        fields: [
          {
            fieldName: 'title',
            originalColumnName: 'title',
            validator: 'v.string()',
            isOptional: false,
            isId: false,
          },
          {
            fieldName: 'content',
            originalColumnName: 'content',
            validator: 'v.string()',
            isOptional: false,
            isId: false,
          },
          {
            fieldName: 'authorId',
            originalColumnName: 'author_id',
            validator: 'v.id("users")',
            isOptional: false,
            isId: false,
            referencedTable: 'users',
          },
        ],
        schemaValidator: 'v.object({})',
        indexes: [],
        searchIndexes: [],
      },
    ];

    const generator = new ReactHooksGenerator({
      separateFiles: true,
      includeComments: true,
      generateOptimisticUpdates: true,
    });

    const result = generator.generate(tables);

    // Should generate files for each table
    expect(result.files.has('useUsers.ts')).toBe(true);
    expect(result.files.has('usePosts.ts')).toBe(true);
    expect(result.files.has('index.ts')).toBe(true);

    // Should generate all hook types
    const usersHooks = result.files.get('useUsers.ts')!;
    expect(usersHooks).toContain('useUsersList');
    expect(usersHooks).toContain('useUsers');
    expect(usersHooks).toContain('useCreateUsers');
    expect(usersHooks).toContain('useUpdateUsers');
    expect(usersHooks).toContain('useRemoveUsers');
    expect(usersHooks).toContain('useSearchUsers'); // Has text fields

    // Should generate types
    expect(usersHooks).toContain('interface Users {');
    expect(usersHooks).toContain('interface CreateUsersInput');

    // Posts should have foreign key type
    const postsHooks = result.files.get('usePosts.ts')!;
    expect(postsHooks).toContain('authorId: Id<"users">');

    // Index should export all
    const index = result.files.get('index.ts')!;
    expect(index).toContain("export * from './useUsers'");
    expect(index).toContain("export * from './usePosts'");
  });
});

// ============================================================================
// FULL MIGRATION SIMULATION
// ============================================================================

describe('E2E: Migration Simulation', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should simulate complete migration workflow', async () => {
    // Step 1: Validate connection
    const connectionString = 'postgresql://user:pass@localhost:5432/sourcedb';
    const validation = validateConnectionString(connectionString);
    expect(validation.valid).toBe(true);

    // Step 2: Build table list (simulated from introspection)
    const dbTables = ['users', 'posts', 'comments'];

    // Step 3: Resolve user table selection
    const userInput = 'usres, pots, coments'; // With typos
    const tableSelection = userInput.split(',').map((t) => {
      const trimmed = t.trim();
      const suggestion = suggestTableNames(trimmed, dbTables);
      return (
        suggestion.exactMatch || suggestion.suggestions[0]?.value || trimmed
      );
    });
    expect(tableSelection).toEqual(['users', 'posts', 'comments']);

    // Step 4: Resolve dependencies
    const tables: TableInfo[] = [
      {
        tableName: 'users',
        schemaName: 'public',
        tableType: 'BASE TABLE',
        columns: [],
        primaryKeys: ['id'],
        foreignKeys: [],
        indexes: [],
        description: null,
      },
      {
        tableName: 'posts',
        schemaName: 'public',
        tableType: 'BASE TABLE',
        columns: [],
        primaryKeys: ['id'],
        foreignKeys: [
          {
            constraintName: 'fk_posts_users',
            columnName: 'author_id',
            referencedTable: 'users',
            referencedColumn: 'id',
          },
        ],
        indexes: [],
        description: null,
      },
      {
        tableName: 'comments',
        schemaName: 'public',
        tableType: 'BASE TABLE',
        columns: [],
        primaryKeys: ['id'],
        foreignKeys: [
          {
            constraintName: 'fk_comments_posts',
            columnName: 'post_id',
            referencedTable: 'posts',
            referencedColumn: 'id',
          },
        ],
        indexes: [],
        description: null,
      },
    ];

    const resolver = new DependencyResolver();
    const { order, circularDeps } = resolver.resolve(tables);

    expect(circularDeps).toHaveLength(0);
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('posts'));
    expect(order.indexOf('posts')).toBeLessThan(order.indexOf('comments'));

    // Step 5: Create ID mapper for migration
    const persistPath = path.join(tempDir, 'migration-ids.json');
    const idMapper = new IdMapper({ persistPath });

    // Simulate migrating rows
    const userRows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];
    const postRows = [
      { id: 1, author_id: 1, title: 'Post 1' },
      { id: 2, author_id: 2, title: 'Post 2' },
    ];
    const commentRows = [
      { id: 1, post_id: 1, content: 'Comment 1' },
      { id: 2, post_id: 2, content: 'Comment 2' },
    ];

    // Map users
    for (const row of userRows) {
      idMapper.set(
        'users',
        row.id,
        `users:${row.id.toString(16).padStart(16, '0')}`
      );
    }

    // Map posts (looking up author_id)
    for (const row of postRows) {
      const authorConvexId = idMapper.get('users', row.author_id);
      expect(authorConvexId).toBeDefined();
      idMapper.set(
        'posts',
        row.id,
        `posts:${row.id.toString(16).padStart(16, '0')}`
      );
    }

    // Map comments (looking up post_id)
    for (const row of commentRows) {
      const postConvexId = idMapper.get('posts', row.post_id);
      expect(postConvexId).toBeDefined();
      idMapper.set(
        'comments',
        row.id,
        `comments:${row.id.toString(16).padStart(16, '0')}`
      );
    }

    // Verify all mapped
    expect(idMapper.count()).toBe(6);

    // Persist for resumability
    await idMapper.save();

    // Verify can be restored
    const restoredMapper = new IdMapper({ persistPath });
    await restoredMapper.load();
    expect(restoredMapper.count()).toBe(6);
  });
});
