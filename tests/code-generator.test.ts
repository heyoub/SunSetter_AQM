import { TypeMapper } from '../src/mapper/type-mapper';
import { CodeGenerator } from '../src/generator/code-generator';
import {
  SchemaInfo,
  TableInfo,
  ColumnInfo,
} from '../src/introspector/schema-introspector';

describe('CodeGenerator', () => {
  let typeMapper: TypeMapper;
  let codeGenerator: CodeGenerator;

  beforeEach(() => {
    typeMapper = new TypeMapper();
    codeGenerator = new CodeGenerator(
      {
        outputDir: './test-output',
        generateModels: true,
        generateRepositories: true,
        generateServices: true,
        generateValidators: false,
        generateConvexSchema: false,
        generateMigrations: false,
        useZod: false,
        useClassValidator: false,
      },
      typeMapper
    );
  });

  describe('TypeMapper', () => {
    it('should map PostgreSQL varchar to TypeScript string', () => {
      const column: ColumnInfo = {
        columnName: 'name',
        dataType: 'character varying',
        isNullable: false,
        columnDefault: null,
        characterMaximumLength: 255,
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

      const tsType = typeMapper.mapColumnToTypeScript(column);
      expect(tsType.type).toBe('string');
      expect(tsType.isOptional).toBe(false);
    });

    it('should map PostgreSQL integer to TypeScript number', () => {
      const column: ColumnInfo = {
        columnName: 'age',
        dataType: 'integer',
        isNullable: true,
        columnDefault: null,
        characterMaximumLength: null,
        numericPrecision: 32,
        numericScale: 0,
        ordinalPosition: 2,
        isIdentity: false,
        isPrimaryKey: false,
        isForeignKey: false,
        foreignKeyTable: null,
        foreignKeyColumn: null,
        description: null,
      };

      const tsType = typeMapper.mapColumnToTypeScript(column);
      expect(tsType.type).toBe('number');
      expect(tsType.isOptional).toBe(true);
    });

    it('should generate correct interface for a table', () => {
      const columns: ColumnInfo[] = [
        {
          columnName: 'id',
          dataType: 'integer',
          isNullable: false,
          columnDefault: "nextval('users_id_seq'::regclass)",
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
        {
          columnName: 'user_name',
          dataType: 'character varying',
          isNullable: false,
          columnDefault: null,
          characterMaximumLength: 255,
          numericPrecision: null,
          numericScale: null,
          ordinalPosition: 2,
          isIdentity: false,
          isPrimaryKey: false,
          isForeignKey: false,
          foreignKeyTable: null,
          foreignKeyColumn: null,
          description: null,
        },
        {
          columnName: 'email',
          dataType: 'character varying',
          isNullable: true,
          columnDefault: null,
          characterMaximumLength: 320,
          numericPrecision: null,
          numericScale: null,
          ordinalPosition: 3,
          isIdentity: false,
          isPrimaryKey: false,
          isForeignKey: false,
          foreignKeyTable: null,
          foreignKeyColumn: null,
          description: null,
        },
      ];

      const interfaceCode = typeMapper.generateTableInterface('users', columns);

      expect(interfaceCode).toContain('export interface Users');
      expect(interfaceCode).toContain('id: number;');
      expect(interfaceCode).toContain('userName: string;');
      expect(interfaceCode).toContain('email?: string | null;');
    });
  });

  describe('Schema Processing', () => {
    it('should process a complete schema', () => {
      const mockTable: TableInfo = {
        tableName: 'users',
        schemaName: 'public',
        tableType: 'BASE TABLE',
        columns: [
          {
            columnName: 'id',
            dataType: 'integer',
            isNullable: false,
            columnDefault: "nextval('users_id_seq'::regclass)",
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
          {
            columnName: 'name',
            dataType: 'character varying',
            isNullable: false,
            columnDefault: null,
            characterMaximumLength: 255,
            numericPrecision: null,
            numericScale: null,
            ordinalPosition: 2,
            isIdentity: false,
            isPrimaryKey: false,
            isForeignKey: false,
            foreignKeyTable: null,
            foreignKeyColumn: null,
            description: null,
          },
        ],
        primaryKeys: ['id'],
        foreignKeys: [],
        indexes: [],
        description: null,
      };

      const mockSchema: SchemaInfo = {
        schemaName: 'public',
        tables: [mockTable],
        views: [],
      };

      expect(mockSchema.tables).toHaveLength(1);
      expect(mockSchema.tables[0].tableName).toBe('users');
      expect(mockSchema.tables[0].columns).toHaveLength(2);
    });
  });
});
