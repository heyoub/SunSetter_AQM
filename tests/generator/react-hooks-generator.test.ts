/**
 * React Hooks Generator Tests
 *
 * Comprehensive testing for the React hooks code generation module.
 *
 * Test Categories:
 * - Example tests: Verify known input produces expected output
 * - Property tests: Verify invariants hold for any valid input
 * - Syntax tests: Verify generated code is syntactically valid
 * - Integration tests: Verify hooks work together correctly
 */

import * as fc from 'fast-check';
import {
  ReactHooksGenerator,
  generateReactHooks,
  type ReactHooksGeneratorOptions,
  type ReactHooksResult,
} from '../../src/generator/convex/react-hooks-generator';
import type {
  ConvexTableDefinition,
  ConvexFieldMapping,
} from '../../src/convex/types';
import { tableName, columnType } from '../utils/test-generators';

// ============================================================================
// TEST DATA GENERATORS
// ============================================================================

/**
 * Generate a Convex field mapping
 */
const fieldMapping = fc.record({
  fieldName: fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,20}$/),
  originalColumnName: fc.stringMatching(/^[a-z][a-z0-9_]{0,20}$/),
  validator: fc.constantFrom(
    'v.string()',
    'v.number()',
    'v.int64()',
    'v.float64()',
    'v.boolean()',
    'v.any()',
    'v.bytes()',
    'v.null()',
    'v.array(v.string())',
    'v.object({ key: v.string() })',
    'v.id("users")'
  ),
  isOptional: fc.boolean(),
  isId: fc.constant(false),
  referencedTable: fc.option(fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/), {
    nil: undefined,
  }),
  transformation: fc.option(fc.constant('toNumber'), { nil: undefined }),
});

/**
 * Generate a Convex table definition
 */
const tableDefinition: fc.Arbitrary<ConvexTableDefinition> = fc.record({
  tableName: fc.stringMatching(/^[a-z][a-z0-9_]{2,20}$/),
  originalTableName: fc.stringMatching(/^[a-z][a-z0-9_]{2,20}$/),
  fields: fc.array(fieldMapping, { minLength: 1, maxLength: 10 }),
  schemaValidator: fc.constant('v.object({})'),
  indexes: fc.constant([]),
  searchIndexes: fc.constant([]),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a minimal valid table definition for testing
 */
function createTableDef(
  name: string,
  fields: Partial<ConvexFieldMapping>[] = []
): ConvexTableDefinition {
  const defaultFields: ConvexFieldMapping[] = [
    {
      fieldName: 'id',
      originalColumnName: 'id',
      validator: 'v.string()',
      isOptional: false,
      isId: true,
    },
    {
      fieldName: 'name',
      originalColumnName: 'name',
      validator: 'v.string()',
      isOptional: false,
      isId: false,
    },
  ];

  const mergedFields = [
    ...defaultFields,
    ...fields.map((f) => ({
      fieldName: f.fieldName || 'field',
      originalColumnName: f.originalColumnName || f.fieldName || 'field',
      validator: f.validator || 'v.string()',
      isOptional: f.isOptional || false,
      isId: f.isId || false,
      referencedTable: f.referencedTable,
      transformation: f.transformation,
    })),
  ];

  return {
    tableName: name,
    originalTableName: name,
    fields: mergedFields,
    schemaValidator: 'v.object({})',
    indexes: [],
    searchIndexes: [],
  };
}

/**
 * Check if code is syntactically valid TypeScript/JavaScript
 * Note: This is a basic check - real validation would use a parser
 */
function isValidSyntax(code: string): boolean {
  // Check for balanced braces
  const braces = { '{': 0, '(': 0, '[': 0 };
  for (const char of code) {
    if (char === '{') braces['{']++;
    if (char === '}') braces['{']--;
    if (char === '(') braces['(']++;
    if (char === ')') braces['(']--;
    if (char === '[') braces['[']++;
    if (char === ']') braces['[']--;
  }
  return Object.values(braces).every((v) => v === 0);
}

// ============================================================================
// EXAMPLE-BASED TESTS
// ============================================================================

describe('ReactHooksGenerator - Example Tests', () => {
  describe('generate', () => {
    it('should generate hooks for a simple table', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.hookCount).toBeGreaterThan(0);
      expect(result.content).toContain('useUsersList');
      expect(result.content).toContain('useUser');
      expect(result.content).toContain('useCreateUser');
      expect(result.content).toContain('useUpdateUser');
      expect(result.content).toContain('useRemoveUser');
    });

    it('should generate search hook when text fields exist', () => {
      const generator = new ReactHooksGenerator();
      const tables = [
        createTableDef('products', [
          {
            fieldName: 'description',
            originalColumnName: 'description',
            validator: 'v.string()',
            isOptional: false,
            isId: false,
          },
        ]),
      ];
      const result = generator.generate(tables);

      expect(result.content).toContain('useSearchProducts');
    });

    it('should generate separate files when configured', () => {
      const generator = new ReactHooksGenerator({ separateFiles: true });
      const tables = [createTableDef('users'), createTableDef('posts')];
      const result = generator.generate(tables);

      expect(result.files.has('useUsers.ts')).toBe(true);
      expect(result.files.has('usePosts.ts')).toBe(true);
      expect(result.files.has('index.ts')).toBe(true);
    });

    it('should generate index file with exports', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users'), createTableDef('orders')];
      const result = generator.generate(tables);

      const indexContent = result.files.get('index.ts');
      expect(indexContent).toContain("export * from './useUsers'");
      expect(indexContent).toContain("export * from './useOrders'");
    });

    it('should include JSDoc comments when enabled', () => {
      const generator = new ReactHooksGenerator({ includeComments: true });
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain('/**');
      expect(result.content).toContain('@param');
      expect(result.content).toContain('@example');
    });

    it('should omit comments when disabled', () => {
      const generator = new ReactHooksGenerator({ includeComments: false });
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      // Should not have JSDoc blocks
      expect(result.content).not.toContain('@param');
      expect(result.content).not.toContain('@example');
    });

    it('should generate optimistic helpers when enabled', () => {
      const generator = new ReactHooksGenerator({
        generateOptimisticUpdates: true,
      });
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain('OptimisticHelpers');
      expect(result.content).toContain('addToList');
      expect(result.content).toContain('removeFromList');
      expect(result.content).toContain('updateInList');
    });

    it('should use custom convex functions path', () => {
      const generator = new ReactHooksGenerator({
        convexFunctionsPath: '@/convex',
      });
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain("from '@/convex/_generated/api'");
    });
  });

  describe('type generation', () => {
    it('should generate document type', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain('interface Users {');
      expect(result.content).toContain('_id: Id<"users">');
      expect(result.content).toContain('_creationTime: number');
    });

    it('should generate create input type', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain('interface CreateUsersInput {');
    });

    it('should generate update input type', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain('interface UpdateUsersInput {');
    });

    it('should generate filter options type', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain('interface UsersFilterOptions {');
      expect(result.content).toContain('limit?: number');
      expect(result.content).toContain('cursor?: string');
      expect(result.content).toContain('sortBy?:');
    });

    it('should map validators to TypeScript types correctly', () => {
      const generator = new ReactHooksGenerator();
      const tables = [
        createTableDef('items', [
          {
            fieldName: 'count',
            validator: 'v.number()',
            isOptional: false,
            isId: false,
          },
          {
            fieldName: 'active',
            validator: 'v.boolean()',
            isOptional: false,
            isId: false,
          },
          {
            fieldName: 'data',
            validator: 'v.any()',
            isOptional: true,
            isId: false,
          },
          {
            fieldName: 'authorId',
            validator: 'v.id("users")',
            isOptional: false,
            isId: false,
            referencedTable: 'users',
          },
        ]),
      ];
      const result = generator.generate(tables);

      expect(result.content).toContain('count: number');
      expect(result.content).toContain('active: boolean');
      expect(result.content).toContain('data?: unknown');
      expect(result.content).toContain('authorId: Id<"users">');
    });
  });

  describe('hook content', () => {
    it('should generate useList with pagination options', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain(
        'useUsersList(options: UsersFilterOptions'
      );
      expect(result.content).toContain(
        'const { limit = 50, cursor, sortBy, sortOrder } = options'
      );
    });

    it('should generate useGet with skip pattern', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain("id ? { id } : 'skip'");
    });

    it('should generate useMutation hooks correctly', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain('useMutation(api.users.create)');
      expect(result.content).toContain('useMutation(api.users.update)');
      expect(result.content).toContain('useMutation(api.users.remove)');
    });

    it('should use useCallback for mutation functions', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain('useCallback(');
      expect(result.content).toContain('[mutation]');
    });

    it('should use useMemo for query results', () => {
      const generator = new ReactHooksGenerator();
      const tables = [createTableDef('users')];
      const result = generator.generate(tables);

      expect(result.content).toContain('useMemo(() => ({');
    });
  });
});

// ============================================================================
// PROPERTY-BASED TESTS
// ============================================================================

describe('ReactHooksGenerator - Property Tests', () => {
  describe('hook count invariants', () => {
    /**
     * PROPERTY: Hook count is always positive for non-empty tables
     */
    it('should generate at least 5 hooks per table', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/),
          (tableName) => {
            const generator = new ReactHooksGenerator();
            const tables = [createTableDef(tableName)];
            const result = generator.generate(tables);

            // At minimum: list, get, create, update, remove
            expect(result.hookCount).toBeGreaterThanOrEqual(5);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * PROPERTY: Hook count scales with table count
     * More tables should mean more hooks
     */
    it('should generate more hooks for more tables', () => {
      fc.assert(
        fc.property(
          fc.array(fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/), {
            minLength: 1,
            maxLength: 5,
          }),
          (tableNames) => {
            // Dedupe table names
            const uniqueNames = [...new Set(tableNames)];
            const generator = new ReactHooksGenerator();
            const tables = uniqueNames.map((name) => createTableDef(name));
            const result = generator.generate(tables);

            // At least 5 hooks per unique table
            expect(result.hookCount).toBeGreaterThanOrEqual(
              uniqueNames.length * 5
            );
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('file generation invariants', () => {
    /**
     * PROPERTY: Always generates index file
     */
    it('should always generate index.ts', () => {
      fc.assert(
        fc.property(
          fc.array(fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/), {
            minLength: 1,
            maxLength: 3,
          }),
          (tableNames) => {
            const uniqueNames = [...new Set(tableNames)];
            const generator = new ReactHooksGenerator({ separateFiles: true });
            const tables = uniqueNames.map((name) => createTableDef(name));
            const result = generator.generate(tables);

            expect(result.files.has('index.ts')).toBe(true);
          }
        )
      );
    });

    /**
     * PROPERTY: Separate files mode creates one file per table plus index
     */
    it('should create correct number of files', () => {
      fc.assert(
        fc.property(
          fc.array(fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/), {
            minLength: 1,
            maxLength: 5,
          }),
          (tableNames) => {
            const uniqueNames = [...new Set(tableNames)];
            const generator = new ReactHooksGenerator({ separateFiles: true });
            const tables = uniqueNames.map((name) => createTableDef(name));
            const result = generator.generate(tables);

            // One file per table + index file
            expect(result.files.size).toBe(uniqueNames.length + 1);
          }
        )
      );
    });
  });

  describe('content invariants', () => {
    /**
     * PROPERTY: Generated content has balanced braces
     */
    it('should generate syntactically balanced code', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/),
          (tableName) => {
            const generator = new ReactHooksGenerator();
            const tables = [createTableDef(tableName)];
            const result = generator.generate(tables);

            expect(isValidSyntax(result.content)).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * PROPERTY: Content always includes required imports
     */
    it('should always include React hook imports', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/),
          (tableName) => {
            const generator = new ReactHooksGenerator();
            const tables = [createTableDef(tableName)];
            const result = generator.generate(tables);

            expect(result.content).toContain('useQuery');
            expect(result.content).toContain('useMutation');
            expect(result.content).toContain('useCallback');
            expect(result.content).toContain('useMemo');
          }
        )
      );
    });

    /**
     * PROPERTY: Table name appears in generated hooks
     */
    it('should include table name in hook names', () => {
      fc.assert(
        fc.property(fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/), (tableName) => {
          const generator = new ReactHooksGenerator();
          const tables = [createTableDef(tableName)];
          const result = generator.generate(tables);

          // Table name should appear in PascalCase in hook names
          const pascalName =
            tableName.charAt(0).toUpperCase() + tableName.slice(1);
          expect(result.content).toContain(`use${pascalName}`);
        })
      );
    });
  });

  describe('type safety invariants', () => {
    /**
     * PROPERTY: Generated types include _id and _creationTime
     */
    it('should always include Convex document fields', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/),
          (tableName) => {
            const generator = new ReactHooksGenerator();
            const tables = [createTableDef(tableName)];
            const result = generator.generate(tables);

            expect(result.content).toContain('_id: Id<');
            expect(result.content).toContain('_creationTime: number');
          }
        )
      );
    });

    /**
     * PROPERTY: Optional fields are marked with ?
     */
    it('should mark optional fields correctly', () => {
      fc.assert(
        fc.property(fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/), (fieldName) => {
          const generator = new ReactHooksGenerator();
          const tables = [
            createTableDef('test', [
              {
                fieldName,
                originalColumnName: fieldName,
                validator: 'v.string()',
                isOptional: true,
                isId: false,
              },
            ]),
          ];
          const result = generator.generate(tables);

          // The field should appear with ? in at least one type
          expect(result.content).toContain(`${fieldName}?:`);
        })
      );
    });
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('ReactHooksGenerator - Edge Cases', () => {
  it('should handle empty table list', () => {
    const generator = new ReactHooksGenerator();
    const result = generator.generate([]);

    expect(result.hookCount).toBe(0);
    expect(result.files.size).toBeGreaterThanOrEqual(1); // At least index
  });

  it('should handle table with single field', () => {
    const generator = new ReactHooksGenerator();
    const tables: ConvexTableDefinition[] = [
      {
        tableName: 'minimal',
        originalTableName: 'minimal',
        fields: [
          {
            fieldName: 'value',
            originalColumnName: 'value',
            validator: 'v.string()',
            isOptional: false,
            isId: false,
          },
        ],
        schemaValidator: 'v.object({})',
        indexes: [],
        searchIndexes: [],
      },
    ];
    const result = generator.generate(tables);

    expect(result.hookCount).toBeGreaterThan(0);
    expect(isValidSyntax(result.content)).toBe(true);
  });

  it('should handle table with many fields', () => {
    const generator = new ReactHooksGenerator();
    const fields: ConvexFieldMapping[] = Array.from({ length: 50 }, (_, i) => ({
      fieldName: `field${i}`,
      originalColumnName: `field_${i}`,
      validator: 'v.string()',
      isOptional: i % 2 === 0,
      isId: false,
    }));

    const tables: ConvexTableDefinition[] = [
      {
        tableName: 'large_table',
        originalTableName: 'large_table',
        fields,
        schemaValidator: 'v.object({})',
        indexes: [],
        searchIndexes: [],
      },
    ];
    const result = generator.generate(tables);

    expect(result.hookCount).toBeGreaterThan(0);
    expect(isValidSyntax(result.content)).toBe(true);
  });

  it('should handle reserved JavaScript keywords as field names', () => {
    const generator = new ReactHooksGenerator();
    const tables = [
      createTableDef('items', [
        {
          fieldName: 'class', // Reserved word
          validator: 'v.string()',
          isOptional: false,
          isId: false,
        },
        {
          fieldName: 'function', // Reserved word
          validator: 'v.number()',
          isOptional: false,
          isId: false,
        },
      ]),
    ];

    // Should not crash
    expect(() => generator.generate(tables)).not.toThrow();
  });

  it('should handle tables with only ID fields', () => {
    const generator = new ReactHooksGenerator();
    const tables: ConvexTableDefinition[] = [
      {
        tableName: 'links',
        originalTableName: 'links',
        fields: [
          {
            fieldName: 'fromId',
            originalColumnName: 'from_id',
            validator: 'v.id("nodes")',
            isOptional: false,
            isId: false,
            referencedTable: 'nodes',
          },
          {
            fieldName: 'toId',
            originalColumnName: 'to_id',
            validator: 'v.id("nodes")',
            isOptional: false,
            isId: false,
            referencedTable: 'nodes',
          },
        ],
        schemaValidator: 'v.object({})',
        indexes: [],
        searchIndexes: [],
      },
    ];
    const result = generator.generate(tables);

    // Should not generate search hook (no text fields)
    expect(result.content).not.toContain('useSearchLinks');
    // Should still generate other hooks
    expect(result.content).toContain('useLinksList');
  });

  it('should handle snake_case table names', () => {
    const generator = new ReactHooksGenerator();
    const tables = [createTableDef('user_profiles')];
    const result = generator.generate(tables);

    // Should convert to PascalCase for hook names
    expect(result.content).toContain('useUserProfilesList');
    expect(result.files.has('useUserProfiles.ts')).toBe(true);
  });

  it('should handle numeric suffixes in table names', () => {
    const generator = new ReactHooksGenerator();
    const tables = [createTableDef('events_v2')];
    const result = generator.generate(tables);

    expect(result.hookCount).toBeGreaterThan(0);
    expect(isValidSyntax(result.content)).toBe(true);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('ReactHooksGenerator - Integration', () => {
  it('should generate consistent output for same input', () => {
    const generator = new ReactHooksGenerator();
    const tables = [createTableDef('users'), createTableDef('posts')];

    const result1 = generator.generate(tables);
    const result2 = generator.generate(tables);

    expect(result1.content).toBe(result2.content);
    expect(result1.hookCount).toBe(result2.hookCount);
  });

  it('should work with all option combinations', () => {
    const optionSets: Partial<ReactHooksGeneratorOptions>[] = [
      { includeComments: true, generateOptimisticUpdates: true },
      { includeComments: false, generateOptimisticUpdates: true },
      { includeComments: true, generateOptimisticUpdates: false },
      { includeComments: false, generateOptimisticUpdates: false },
      { separateFiles: true },
      { separateFiles: false },
    ];

    const tables = [createTableDef('users')];

    for (const options of optionSets) {
      const generator = new ReactHooksGenerator(options);
      const result = generator.generate(tables);

      expect(result.hookCount).toBeGreaterThan(0);
      expect(isValidSyntax(result.content)).toBe(true);
    }
  });

  it('should use generateReactHooks convenience function', () => {
    const tables = [createTableDef('users')];
    const result = generateReactHooks(tables, { includeComments: true });

    expect(result.hookCount).toBeGreaterThan(0);
    expect(result.content).toContain('useUsersList');
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('ReactHooksGenerator - Performance', () => {
  it('should generate hooks for many tables in reasonable time', () => {
    const generator = new ReactHooksGenerator();
    const tables = Array.from({ length: 50 }, (_, i) =>
      createTableDef(`table_${i}`)
    );

    const start = Date.now();
    const result = generator.generate(tables);
    const elapsed = Date.now() - start;

    expect(result.hookCount).toBeGreaterThanOrEqual(250); // 5+ hooks per table
    expect(elapsed).toBeLessThan(5000); // Should complete in under 5 seconds
  });

  it('should handle tables with many fields efficiently', () => {
    const generator = new ReactHooksGenerator();
    const fields: ConvexFieldMapping[] = Array.from(
      { length: 100 },
      (_, i) => ({
        fieldName: `field${i}`,
        originalColumnName: `field_${i}`,
        validator: 'v.string()',
        isOptional: false,
        isId: false,
      })
    );

    const tables: ConvexTableDefinition[] = [
      {
        tableName: 'wide_table',
        originalTableName: 'wide_table',
        fields,
        schemaValidator: 'v.object({})',
        indexes: [],
        searchIndexes: [],
      },
    ];

    const start = Date.now();
    const result = generator.generate(tables);
    const elapsed = Date.now() - start;

    expect(result.hookCount).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000); // Should complete in under 1 second
  });
});
