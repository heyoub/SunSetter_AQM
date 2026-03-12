import { DataTransformer } from '../../src/migration/data-transformer';
import type { ColumnInfo, TableInfo } from '../../src/introspector/schema-introspector';
import type { IIdMapper } from '../../src/shared/types';

const mockIdMapper: IIdMapper = {
  set: () => {},
  get: () => undefined,
  has: () => false,
  getTableMappings: () => new Map(),
  count: () => 0,
  countForTable: () => 0,
  tryResolveForeignKey: (_tableName, postgresId) =>
    postgresId == null ? null : undefined,
  toJSON: () => ({}),
  fromJSON: () => {},
  clear: () => {},
};

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

describe('DataTransformer', () => {
  it('parses pgvector strings into numeric arrays', () => {
    const transformer = new DataTransformer(mockIdMapper);
    const table: TableInfo = {
      tableName: 'documents',
      schemaName: 'public',
      tableType: 'BASE TABLE',
      columns: [createColumn('embedding', 'vector(3)')],
      primaryKeys: [],
      foreignKeys: [],
      indexes: [],
      checkConstraints: [],
      description: null,
    };

    const result = transformer.transform(
      { embedding: '[1, 2.5, 3]' },
      table
    );

    expect(result.errors).toHaveLength(0);
    expect(result.document).toEqual({ embedding: [1, 2.5, 3] });
  });
});
