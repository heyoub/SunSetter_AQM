/**
 * Dependency Resolver Tests
 *
 * Tests for table dependency resolution, topological sorting,
 * and circular dependency detection.
 */

import { DependencyResolver } from '../../src/migration/dependency-resolver';
import type { TableInfo } from '../../src/introspector/schema-introspector';

// Helper to create a minimal TableInfo
function createTable(
  name: string,
  foreignKeys: Array<{
    columnName: string;
    referencedTable: string;
    referencedColumn: string;
  }> = []
): TableInfo {
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
    foreignKeys: foreignKeys.map((fk, i) => ({
      constraintName: `fk_${name}_${fk.referencedTable}_${i}`,
      columnName: fk.columnName,
      referencedTable: fk.referencedTable,
      referencedColumn: fk.referencedColumn,
    })),
    indexes: [],
    description: null,
  };
}

describe('DependencyResolver', () => {
  let resolver: DependencyResolver;

  beforeEach(() => {
    resolver = new DependencyResolver();
  });

  describe('buildGraph', () => {
    it('should build empty graph for no tables', () => {
      const graph = resolver.buildGraph([]);
      expect(graph.size).toBe(0);
    });

    it('should build graph for single table with no dependencies', () => {
      const tables = [createTable('users')];
      const graph = resolver.buildGraph(tables);

      expect(graph.size).toBe(1);
      expect(graph.get('users')).toBeDefined();
      expect(graph.get('users')!.dependencies).toHaveLength(0);
      expect(graph.get('users')!.dependents).toHaveLength(0);
    });

    it('should build graph with foreign key dependencies', () => {
      const tables = [
        createTable('users'),
        createTable('posts', [
          {
            columnName: 'author_id',
            referencedTable: 'users',
            referencedColumn: 'id',
          },
        ]),
      ];

      const graph = resolver.buildGraph(tables);

      expect(graph.size).toBe(2);
      expect(graph.get('posts')!.dependencies).toContain('users');
      expect(graph.get('users')!.dependents).toContain('posts');
    });

    it('should skip self-referencing foreign keys', () => {
      const tables = [
        createTable('categories', [
          {
            columnName: 'parent_id',
            referencedTable: 'categories',
            referencedColumn: 'id',
          },
        ]),
      ];

      const graph = resolver.buildGraph(tables);

      expect(graph.get('categories')!.dependencies).toHaveLength(0);
    });

    it('should skip references to tables not in the set', () => {
      const tables = [
        createTable('posts', [
          {
            columnName: 'author_id',
            referencedTable: 'users',
            referencedColumn: 'id',
          },
        ]),
      ];

      const graph = resolver.buildGraph(tables);

      // users table doesn't exist in our set, so the dependency should be skipped
      expect(graph.get('posts')!.dependencies).toHaveLength(0);
    });
  });

  describe('resolve', () => {
    it('should resolve empty table list', () => {
      const result = resolver.resolve([]);

      expect(result.order).toHaveLength(0);
      expect(result.circularDeps).toHaveLength(0);
    });

    it('should resolve single table', () => {
      const tables = [createTable('users')];
      const result = resolver.resolve(tables);

      expect(result.order).toEqual(['users']);
      expect(result.circularDeps).toHaveLength(0);
    });

    it('should resolve tables in dependency order', () => {
      const tables = [
        createTable('posts', [
          {
            columnName: 'author_id',
            referencedTable: 'users',
            referencedColumn: 'id',
          },
        ]),
        createTable('users'),
      ];

      const result = resolver.resolve(tables);

      // users should come before posts
      const usersIndex = result.order.indexOf('users');
      const postsIndex = result.order.indexOf('posts');
      expect(usersIndex).toBeLessThan(postsIndex);
    });

    it('should handle complex dependency chains', () => {
      // users <- posts <- comments
      const tables = [
        createTable('comments', [
          {
            columnName: 'post_id',
            referencedTable: 'posts',
            referencedColumn: 'id',
          },
        ]),
        createTable('posts', [
          {
            columnName: 'author_id',
            referencedTable: 'users',
            referencedColumn: 'id',
          },
        ]),
        createTable('users'),
      ];

      const result = resolver.resolve(tables);

      const usersIndex = result.order.indexOf('users');
      const postsIndex = result.order.indexOf('posts');
      const commentsIndex = result.order.indexOf('comments');

      expect(usersIndex).toBeLessThan(postsIndex);
      expect(postsIndex).toBeLessThan(commentsIndex);
    });

    it('should handle diamond dependencies', () => {
      // A <- B, A <- C, B <- D, C <- D
      const tables = [
        createTable('A'),
        createTable('B', [
          { columnName: 'a_id', referencedTable: 'A', referencedColumn: 'id' },
        ]),
        createTable('C', [
          { columnName: 'a_id', referencedTable: 'A', referencedColumn: 'id' },
        ]),
        createTable('D', [
          { columnName: 'b_id', referencedTable: 'B', referencedColumn: 'id' },
          { columnName: 'c_id', referencedTable: 'C', referencedColumn: 'id' },
        ]),
      ];

      const result = resolver.resolve(tables);

      const aIndex = result.order.indexOf('A');
      const bIndex = result.order.indexOf('B');
      const cIndex = result.order.indexOf('C');
      const dIndex = result.order.indexOf('D');

      expect(aIndex).toBeLessThan(bIndex);
      expect(aIndex).toBeLessThan(cIndex);
      expect(bIndex).toBeLessThan(dIndex);
      expect(cIndex).toBeLessThan(dIndex);
    });
  });

  describe('detectCycles', () => {
    it('should detect simple circular dependency', () => {
      // A -> B -> A
      const tables = [
        createTable('A', [
          { columnName: 'b_id', referencedTable: 'B', referencedColumn: 'id' },
        ]),
        createTable('B', [
          { columnName: 'a_id', referencedTable: 'A', referencedColumn: 'id' },
        ]),
      ];

      const result = resolver.resolve(tables);

      expect(result.circularDeps.length).toBeGreaterThan(0);
    });

    it('should detect longer circular chains', () => {
      // A -> B -> C -> A
      const tables = [
        createTable('A', [
          { columnName: 'b_id', referencedTable: 'B', referencedColumn: 'id' },
        ]),
        createTable('B', [
          { columnName: 'c_id', referencedTable: 'C', referencedColumn: 'id' },
        ]),
        createTable('C', [
          { columnName: 'a_id', referencedTable: 'A', referencedColumn: 'id' },
        ]),
      ];

      const result = resolver.resolve(tables);

      expect(result.circularDeps.length).toBeGreaterThan(0);
    });

    it('should not detect cycles where none exist', () => {
      const tables = [
        createTable('users'),
        createTable('posts', [
          {
            columnName: 'author_id',
            referencedTable: 'users',
            referencedColumn: 'id',
          },
        ]),
        createTable('comments', [
          {
            columnName: 'post_id',
            referencedTable: 'posts',
            referencedColumn: 'id',
          },
        ]),
      ];

      const result = resolver.resolve(tables);

      expect(result.circularDeps).toHaveLength(0);
    });
  });

  describe('getMigrationOrder', () => {
    it('should filter included tables', () => {
      const tables = [
        createTable('users'),
        createTable('posts'),
        createTable('comments'),
      ];

      resolver.buildGraph(tables);
      const order = resolver.getMigrationOrder(tables, {
        include: ['users', 'posts'],
      });

      expect(order).toContain('users');
      expect(order).toContain('posts');
      expect(order).not.toContain('comments');
    });

    it('should filter excluded tables', () => {
      const tables = [
        createTable('users'),
        createTable('posts'),
        createTable('comments'),
      ];

      resolver.buildGraph(tables);
      const order = resolver.getMigrationOrder(tables, {
        exclude: ['comments'],
      });

      expect(order).toContain('users');
      expect(order).toContain('posts');
      expect(order).not.toContain('comments');
    });
  });

  describe('groupByLevel', () => {
    it('should group independent tables at level 0', () => {
      const tables = [
        createTable('users'),
        createTable('products'),
        createTable('categories'),
      ];

      resolver.buildGraph(tables);
      const levels = resolver.groupByLevel();

      expect(levels.get(0)).toBeDefined();
      expect(levels.get(0)!.length).toBe(3);
    });

    it('should place dependent tables at higher levels', () => {
      const tables = [
        createTable('users'),
        createTable('posts', [
          {
            columnName: 'author_id',
            referencedTable: 'users',
            referencedColumn: 'id',
          },
        ]),
      ];

      resolver.buildGraph(tables);
      const levels = resolver.groupByLevel();

      expect(levels.get(0)).toContain('users');
      expect(levels.get(1)).toContain('posts');
    });
  });
});
