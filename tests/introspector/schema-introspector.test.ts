import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
} from '../../src/introspector/schema-introspector';
import { SchemaIntrospector } from '../../src/introspector/schema-introspector';
import {
  DatabaseType,
  type DatabaseAdapter,
  type StreamBatch,
  type StreamOptions,
} from '../../src/adapters/base';

function createMockAdapter(): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    query: async <T = Record<string, unknown>>(
      sql: string
    ): Promise<T[]> => {
      if (sql.includes('d.is_nullable')) {
        throw new Error(
          'Domain introspection query must not reference information_schema.domains.is_nullable'
        );
      }

      if (sql.includes("t.table_type = 'BASE TABLE'")) {
        return [] as T[];
      }

      if (sql.includes("t.table_type = 'VIEW'")) {
        return [] as T[];
      }

      if (sql.includes('FROM information_schema.domains d')) {
        return [
          {
            domain_name: 'positive_int',
            domain_schema: 'public',
            data_type: 'integer',
            domain_default: null,
            is_nullable: 'NO',
            domain_comment: 'Positive integer domain',
            check_constraints: ['CHECK ((VALUE > 0))'],
          },
          {
            domain_name: 'optional_label',
            domain_schema: 'public',
            data_type: 'text',
            domain_default: "'untitled'",
            is_nullable: 'YES',
            domain_comment: null,
            check_constraints: [],
          },
        ] as T[];
      }

      if (sql.includes('FROM pg_type t') && sql.includes('JOIN pg_enum e')) {
        return [] as T[];
      }

      return [] as T[];
    },
    getSchemas: async () => ['public'],
    getTables: async (_schema: string) => [],
    getColumns: async (_schema: string, _table: string): Promise<ColumnInfo[]> =>
      [],
    getPrimaryKeys: async (_schema: string, _table: string) => [],
    getForeignKeys: async (
      _schema: string,
      _table: string
    ): Promise<ForeignKeyInfo[]> => [],
    getIndexes: async (
      _schema: string,
      _table: string
    ): Promise<IndexInfo[]> => [],
    getTableRowCount: async (_schema: string, _table: string) => 0,
    streamRows: async function* (
      _schema: string,
      _table: string,
      _options: StreamOptions
    ): AsyncGenerator<StreamBatch, void, unknown> {},
    getDatabaseType: () => DatabaseType.POSTGRESQL,
    escapeIdentifier: (name: string) => `"${name}"`,
    isConnected: () => true,
    getDatabaseName: () => 'test',
    testConnection: async () => true,
    getDefaultSchema: () => 'public',
  };
}

describe('SchemaIntrospector', () => {
  it('introspects domain nullability without relying on information_schema.domains.is_nullable', async () => {
    const introspector = new SchemaIntrospector(createMockAdapter());

    const result = await introspector.introspectSchema('public');

    expect(result.domains).toEqual([
      {
        domainName: 'positive_int',
        schemaName: 'public',
        dataType: 'integer',
        domainDefault: null,
        isNullable: false,
        checkConstraints: ['CHECK ((VALUE > 0))'],
        description: 'Positive integer domain',
      },
      {
        domainName: 'optional_label',
        schemaName: 'public',
        dataType: 'text',
        domainDefault: "'untitled'",
        isNullable: true,
        checkConstraints: [],
        description: null,
      },
    ]);
  });
});
