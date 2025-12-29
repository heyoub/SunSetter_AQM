import { ColumnInfo } from '../introspector/schema-introspector.js';

export interface TypeMappingOptions {
  useStrict: boolean;
  useBigInt: boolean;
  useDate: boolean;
  useDecimal: boolean;
  enumAsUnion: boolean;
  nullableAsOptional: boolean;
}

export interface TypeScriptType {
  type: string;
  isOptional: boolean;
  isArray: boolean;
  imports: string[];
}

export class TypeMapper {
  private options: TypeMappingOptions;

  constructor(options: Partial<TypeMappingOptions> = {}) {
    this.options = {
      useStrict: true,
      useBigInt: true,
      useDate: true,
      useDecimal: false,
      enumAsUnion: true,
      nullableAsOptional: true,
      ...options,
    };
  }

  mapColumnToTypeScript(column: ColumnInfo): TypeScriptType {
    const baseType = this.mapPostgreSQLTypeToTypeScript(column.dataType);
    const isOptional = this.options.nullableAsOptional && column.isNullable;
    const isArray = column.dataType.includes('[]');

    return {
      type: baseType.type,
      isOptional,
      isArray,
      imports: baseType.imports,
    };
  }

  private mapPostgreSQLTypeToTypeScript(pgType: string): {
    type: string;
    imports: string[];
  } {
    const imports: string[] = [];

    // Handle array types
    if (pgType.includes('[]')) {
      const baseType = pgType.replace('[]', '');
      const mapped = this.mapPostgreSQLTypeToTypeScript(baseType);
      return {
        type: `${mapped.type}[]`,
        imports: mapped.imports,
      };
    }

    // Remove any type modifiers (e.g., character varying(255) -> character varying)
    const cleanType = pgType.split('(')[0].toLowerCase();

    switch (cleanType) {
      // String types
      case 'character varying':
      case 'varchar':
      case 'character':
      case 'char':
      case 'text':
      case 'citext':
      case 'uuid':
        return { type: 'string', imports };

      // Number types
      case 'smallint':
      case 'integer':
      case 'int':
      case 'int4':
      case 'serial':
      case 'smallserial':
        return { type: 'number', imports };

      case 'bigint':
      case 'int8':
      case 'bigserial':
        return {
          type: this.options.useBigInt ? 'bigint' : 'number',
          imports,
        };

      case 'decimal':
      case 'numeric':
      case 'real':
      case 'float4':
      case 'double precision':
      case 'float8':
      case 'money':
        return {
          type: this.options.useDecimal ? 'Decimal' : 'number',
          imports: this.options.useDecimal ? ['Decimal'] : [],
        };

      // Boolean type
      case 'boolean':
      case 'bool':
        return { type: 'boolean', imports };

      // Date/Time types
      case 'timestamp':
      case 'timestamp without time zone':
      case 'timestamp with time zone':
      case 'timestamptz':
      case 'date':
      case 'time':
      case 'time without time zone':
      case 'time with time zone':
      case 'timetz':
      case 'interval':
        return {
          type: this.options.useDate ? 'Date' : 'string',
          imports,
        };

      // JSON types
      case 'json':
      case 'jsonb':
        return { type: 'Record<string, any>', imports };

      // Binary types
      case 'bytea':
        return { type: 'Buffer', imports };

      // Network types
      case 'inet':
      case 'cidr':
      case 'macaddr':
      case 'macaddr8':
        return { type: 'string', imports };

      // Geometric types
      case 'point':
      case 'line':
      case 'lseg':
      case 'box':
      case 'path':
      case 'polygon':
      case 'circle':
        return { type: 'string', imports };

      // Bit string types
      case 'bit':
      case 'bit varying':
      case 'varbit':
        return { type: 'string', imports };

      // Text search types
      case 'tsvector':
      case 'tsquery':
        return { type: 'string', imports };

      // Range types
      case 'int4range':
      case 'int8range':
      case 'numrange':
      case 'tsrange':
      case 'tstzrange':
      case 'daterange':
        return { type: 'string', imports };

      // Default for unknown types
      default:
        // Check if it's an enum type (you might want to enhance this)
        if (this.options.enumAsUnion) {
          return { type: 'string', imports }; // For now, treat enums as strings
        }
        return { type: 'any', imports };
    }
  }

  generateInterfaceProperty(
    columnName: string,
    tsType: TypeScriptType
  ): string {
    const propName = this.toCamelCase(columnName);
    const optional = tsType.isOptional ? '?' : '';
    const nullableType = tsType.isOptional ? ` | null` : '';

    return `  ${propName}${optional}: ${tsType.type}${nullableType};`;
  }

  generateTableInterface(tableName: string, columns: ColumnInfo[]): string {
    const interfaceName = this.toPascalCase(tableName);
    const imports = new Set<string>();

    const properties = columns
      .map((column) => {
        const tsType = this.mapColumnToTypeScript(column);
        tsType.imports.forEach((imp) => imports.add(imp));
        return this.generateInterfaceProperty(column.columnName, tsType);
      })
      .join('\n');

    const importStatements =
      imports.size > 0
        ? `${Array.from(imports)
            .map((imp) => `import { ${imp} } from 'decimal.js';`)
            .join('\n')}\n\n`
        : '';

    return `${importStatements}export interface ${interfaceName} {
${properties}
}`;
  }

  generateCreateInput(tableName: string, columns: ColumnInfo[]): string {
    const interfaceName = `Create${this.toPascalCase(tableName)}Input`;
    const imports = new Set<string>();

    const properties = columns
      .filter(
        (column) =>
          !column.isIdentity && !column.columnDefault?.includes('nextval')
      ) // Exclude auto-generated columns
      .map((column) => {
        const tsType = this.mapColumnToTypeScript(column);
        tsType.imports.forEach((imp) => imports.add(imp));

        // Make non-nullable columns with defaults optional in create input
        if (!column.isNullable && column.columnDefault) {
          tsType.isOptional = true;
        }

        return this.generateInterfaceProperty(column.columnName, tsType);
      })
      .join('\n');

    const importStatements =
      imports.size > 0
        ? `${Array.from(imports)
            .map((imp) => `import { ${imp} } from 'decimal.js';`)
            .join('\n')}\n\n`
        : '';

    return `${importStatements}export interface ${interfaceName} {
${properties}
}`;
  }

  generateUpdateInput(tableName: string, columns: ColumnInfo[]): string {
    const interfaceName = `Update${this.toPascalCase(tableName)}Input`;
    const imports = new Set<string>();

    const properties = columns
      .filter((column) => !column.isPrimaryKey && !column.isIdentity) // Exclude primary keys and identity columns
      .map((column) => {
        const tsType = this.mapColumnToTypeScript(column);
        tsType.imports.forEach((imp) => imports.add(imp));

        // All fields are optional in update input
        tsType.isOptional = true;

        return this.generateInterfaceProperty(column.columnName, tsType);
      })
      .join('\n');

    const importStatements =
      imports.size > 0
        ? `${Array.from(imports)
            .map((imp) => `import { ${imp} } from 'decimal.js';`)
            .join('\n')}\n\n`
        : '';

    return `${importStatements}export interface ${interfaceName} {
${properties}
}`;
  }

  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  private toPascalCase(str: string): string {
    const camelCase = this.toCamelCase(str);
    return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
  }
}
