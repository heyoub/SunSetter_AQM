import { ConvexFunctionGenerator } from '../../src/generator/convex/index';
import type {
  ColumnInfo,
  TableInfo,
} from '../../src/introspector/schema-introspector';

function createColumn(
  columnName: string,
  dataType: string,
  overrides: Partial<ColumnInfo> = {}
): ColumnInfo {
  return {
    columnName,
    dataType,
    isNullable: false,
    columnDefault: null,
    characterMaximumLength: null,
    numericPrecision: null,
    numericScale: null,
    ordinalPosition: 1,
    isIdentity: false,
    isPrimaryKey: false,
    isForeignKey: false,
    foreignKeyTable: null,
    foreignKeyColumn: null,
    description: null,
    isGenerated: false,
    generationExpression: null,
    generationType: null,
    domainName: null,
    domainBaseType: null,
    ...overrides,
  };
}

describe('ConvexFunctionGenerator', () => {
  it('dedupes repeated columns and generated index/getBy names, and emits schema commas', () => {
    const table: TableInfo = {
      tableName: 'cellstate_agent',
      schemaName: 'public',
      tableType: 'BASE TABLE',
      columns: [
        createColumn('owner_principal_id', 'uuid', {
          ordinalPosition: 1,
          isForeignKey: true,
          foreignKeyTable: 'cellstate_principal',
          foreignKeyColumn: 'id',
        }),
        createColumn('owner_principal_id', 'uuid', {
          ordinalPosition: 1,
        }),
      ],
      primaryKeys: [],
      foreignKeys: [
        {
          constraintName: 'cellstate_agent_owner_principal_id_fkey',
          columnName: 'owner_principal_id',
          referencedTable: 'cellstate_principal',
          referencedColumn: 'id',
          referencedSchema: 'public',
        },
      ],
      indexes: [
        {
          indexName: 'cellstate_agent_owner_principal_id_key',
          columnName: 'owner_principal_id',
          columns: [
            {
              columnName: 'owner_principal_id',
              ordinalPosition: 1,
              sortOrder: 'asc',
              nullsPosition: 'last',
              isExpression: false,
            },
          ],
          isUnique: true,
          ordinalPosition: 1,
          isExpression: false,
          indexMethod: 'btree',
          isPartial: false,
        },
      ],
      checkConstraints: [],
      description: null,
    };

    const generator = new ConvexFunctionGenerator();
    const output = generator.generate([table]);
    const queries = output.tables.get('cellstate_agent')?.queries ?? '';

    expect(output.schema.match(/ownerPrincipalId:/g)).toHaveLength(1);
    expect(
      output.schema.match(/\.index\("by_ownerPrincipalId", \["ownerPrincipalId"\]\)/g)
    ).toHaveLength(1);
    expect(output.schema).toContain(
      '    .index("by_ownerPrincipalId", ["ownerPrincipalId"]),'
    );
    expect(queries.match(/export const getByOwnerPrincipalId = query/g)).toHaveLength(1);
    expect(queries).not.toContain('export const search = query');
  });

  it('only emits search helpers when search indexes are enabled', () => {
    const table: TableInfo = {
      tableName: 'articles',
      schemaName: 'public',
      tableType: 'BASE TABLE',
      columns: [createColumn('title', 'text', { ordinalPosition: 1 })],
      primaryKeys: [],
      foreignKeys: [],
      indexes: [],
      checkConstraints: [],
      description: null,
    };

    const generator = new ConvexFunctionGenerator({
      generateSearchIndexes: true,
    });
    const output = generator.generate([table]);
    const queries = output.tables.get('articles')?.queries ?? '';

    expect(output.schema).toContain('.searchIndex("search_title"');
    expect(queries).toContain('export const search = query');
  });

  it('maps pgvector columns to Convex float arrays and TypeScript number arrays', () => {
    const table: TableInfo = {
      tableName: 'documents',
      schemaName: 'public',
      tableType: 'BASE TABLE',
      columns: [
        createColumn('embedding', 'vector(1536)', {
          ordinalPosition: 1,
          isNullable: true,
        }),
      ],
      primaryKeys: [],
      foreignKeys: [],
      indexes: [],
      checkConstraints: [],
      description: null,
    };

    const generator = new ConvexFunctionGenerator();
    const output = generator.generate([table]);
    const types = output.tables.get('documents')?.types ?? '';

    expect(output.schema).toContain(
      'embedding: v.optional(v.array(v.float64()))'
    );
    expect(types).toContain('embedding?: number[];');
  });
});
