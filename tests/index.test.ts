/**
 * Integration Tests
 *
 * Tests for core module exports and basic functionality.
 */

import { DatabaseTypeMapper, TypeMapper } from '../src/mapper/type-mapper';
import type { ColumnInfo } from '../src/introspector/schema-introspector';

// Helper to create a ColumnInfo object
function createColumn(
  name: string,
  dataType: string,
  nullable = false
): ColumnInfo {
  return {
    columnName: name,
    dataType,
    isNullable: nullable,
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
  };
}

describe('DatabaseTypeMapper', () => {
  describe('PostgreSQL type mapping', () => {
    let mapper: DatabaseTypeMapper;

    beforeEach(() => {
      mapper = new DatabaseTypeMapper('postgresql');
    });

    it('should map varchar to string validator', () => {
      const result = mapper.mapColumn(
        createColumn('name', 'character varying')
      );
      expect(result.validator).toBe('v.string()');
      expect(result.typescript).toBe('string');
    });

    it('should map text to string validator', () => {
      const result = mapper.mapColumn(createColumn('bio', 'text'));
      expect(result.validator).toBe('v.string()');
    });

    it('should map integer to number validator', () => {
      const result = mapper.mapColumn(createColumn('age', 'integer'));
      expect(result.validator).toBe('v.number()');
      expect(result.typescript).toBe('number');
    });

    it('should map bigint to number validator', () => {
      const result = mapper.mapColumn(createColumn('count', 'bigint'));
      expect(result.validator).toBe('v.number()');
    });

    it('should map numeric to number validator', () => {
      const result = mapper.mapColumn(createColumn('price', 'numeric'));
      expect(result.validator).toBe('v.number()');
    });

    it('should map boolean to boolean validator', () => {
      const result = mapper.mapColumn(createColumn('active', 'boolean'));
      expect(result.validator).toBe('v.boolean()');
      expect(result.typescript).toBe('boolean');
    });

    it('should map timestamp to number validator', () => {
      const result = mapper.mapColumn(
        createColumn('created_at', 'timestamp without time zone')
      );
      expect(result.validator).toBe('v.number()');
    });

    it('should map json/jsonb to any validator', () => {
      const jsonResult = mapper.mapColumn(createColumn('data', 'json'));
      const jsonbResult = mapper.mapColumn(createColumn('settings', 'jsonb'));
      expect(jsonResult.validator).toBe('v.any()');
      expect(jsonbResult.validator).toBe('v.any()');
    });

    it('should map uuid to string validator', () => {
      const result = mapper.mapColumn(createColumn('id', 'uuid'));
      expect(result.validator).toBe('v.string()');
    });

    it('should map bytea to bytes validator', () => {
      const result = mapper.mapColumn(createColumn('file', 'bytea'));
      expect(result.validator).toBe('v.bytes()');
      expect(result.typescript).toBe('ArrayBuffer');
    });

    it('should map pgvector to float array validator', () => {
      const result = mapper.mapColumn(createColumn('embedding', 'vector(1536)'));
      expect(result.validator).toBe('v.array(v.float64())');
      expect(result.typescript).toBe('number[]');
    });
  });

  describe('MySQL type mapping', () => {
    let mapper: DatabaseTypeMapper;

    beforeEach(() => {
      mapper = new DatabaseTypeMapper('mysql');
    });

    it('should map varchar to string validator', () => {
      const result = mapper.mapColumn(createColumn('name', 'varchar'));
      expect(result.validator).toBe('v.string()');
    });

    it('should map int to number validator', () => {
      const result = mapper.mapColumn(createColumn('age', 'int'));
      expect(result.validator).toBe('v.number()');
    });

    it('should map tinyint(1) to boolean validator', () => {
      const result = mapper.mapColumn(createColumn('active', 'tinyint(1)'));
      expect(result.validator).toBe('v.boolean()');
    });
  });

  describe('SQLite type mapping', () => {
    let mapper: DatabaseTypeMapper;

    beforeEach(() => {
      mapper = new DatabaseTypeMapper('sqlite');
    });

    it('should map TEXT to string validator', () => {
      const result = mapper.mapColumn(createColumn('name', 'TEXT'));
      expect(result.validator).toBe('v.string()');
    });

    it('should map INTEGER to number validator', () => {
      const result = mapper.mapColumn(createColumn('age', 'INTEGER'));
      expect(result.validator).toBe('v.number()');
    });

    it('should map REAL to number validator', () => {
      const result = mapper.mapColumn(createColumn('price', 'REAL'));
      expect(result.validator).toBe('v.number()');
    });

    it('should map BLOB to bytes validator', () => {
      const result = mapper.mapColumn(createColumn('data', 'BLOB'));
      expect(result.validator).toBe('v.bytes()');
    });
  });
});

describe('TypeMapper', () => {
  let mapper: TypeMapper;

  beforeEach(() => {
    mapper = new TypeMapper();
  });

  describe('TypeScript type generation', () => {
    it('should map column to TypeScript type info', () => {
      const result = mapper.mapColumnToTypeScript(
        createColumn('email', 'character varying', false)
      );

      expect(result.type).toBe('string');
      expect(result.isOptional).toBe(false);
    });

    it('should make nullable columns optional', () => {
      const result = mapper.mapColumnToTypeScript(
        createColumn('bio', 'text', true)
      );

      expect(result.isOptional).toBe(true);
    });

    it('should map integer types to number', () => {
      const result = mapper.mapColumnToTypeScript(
        createColumn('count', 'integer', false)
      );

      expect(result.type).toBe('number');
    });

    it('should map boolean types', () => {
      const result = mapper.mapColumnToTypeScript(
        createColumn('active', 'boolean', false)
      );

      expect(result.type).toBe('boolean');
    });
  });

  describe('interface generation', () => {
    it('should generate a complete TypeScript interface', () => {
      const columns: ColumnInfo[] = [
        createColumn('id', 'integer'),
        createColumn('email', 'character varying'),
      ];

      const interfaceCode = mapper.generateTableInterface('users', columns);

      expect(interfaceCode).toContain('export interface Users');
      expect(interfaceCode).toContain('id: number');
      expect(interfaceCode).toContain('email: string');
    });

    it('should handle nullable columns in interface', () => {
      const columns: ColumnInfo[] = [
        createColumn('id', 'integer'),
        createColumn('bio', 'text', true),
      ];

      const interfaceCode = mapper.generateTableInterface('profiles', columns);

      expect(interfaceCode).toContain('export interface Profiles');
      expect(interfaceCode).toContain('bio?: string | null');
    });
  });
});
