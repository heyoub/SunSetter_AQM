/**
 * Convex Schema Generator
 *
 * Generates a complete Convex schema.ts file from PostgreSQL schema.
 * Handles tables, fields, validators, indexes, and relationships.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import type {
  SchemaInfo,
  TableInfo,
  ConvexSchemaDefinition,
  ConvexTableDefinition,
  ConvexIndexDefinition,
  ConvexFieldMapping,
  ConvexSchemaGeneratorOptions,
  ConvexTypeMapperOptions,
  RelationshipAnalyzerOptions,
  DetectedRelationship,
} from './types.js';
import { ConvexTypeMapper } from './convex-type-mapper.js';
import { RelationshipAnalyzer } from './relationship-analyzer.js';

/**
 * Default schema generator options
 */
const DEFAULT_OPTIONS: ConvexSchemaGeneratorOptions = {
  outputMode: 'single',
  generateTypes: true,
  includeComments: true,
  exportFieldValidators: false,
  schemaValidation: true,
  indexStrategy: 'all',
};

/**
 * Generates Convex schema from PostgreSQL schema
 */
export class ConvexSchemaGenerator {
  private typeMapper: ConvexTypeMapper;
  private relationshipAnalyzer: RelationshipAnalyzer;
  private options: ConvexSchemaGeneratorOptions;

  constructor(
    options: Partial<ConvexSchemaGeneratorOptions> = {},
    typeMapperOptions: Partial<ConvexTypeMapperOptions> = {},
    relationshipOptions: Partial<RelationshipAnalyzerOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.typeMapper = new ConvexTypeMapper(typeMapperOptions);
    this.relationshipAnalyzer = new RelationshipAnalyzer(relationshipOptions);
  }

  /**
   * Converts PostgreSQL schema to Convex schema definition
   */
  convertSchema(schema: SchemaInfo): ConvexSchemaDefinition {
    // Analyze relationships first
    const relationships = this.relationshipAnalyzer.analyzeSchema(schema);
    const junctionTables = this.relationshipAnalyzer.getJunctionTables(schema);

    // Convert each table
    const tables: ConvexTableDefinition[] = schema.tables.map((table) =>
      this.convertTable(
        table,
        relationships.filter(
          (r) =>
            r.sourceTable === table.tableName ||
            r.targetTable === table.tableName
        )
      )
    );

    return {
      tables,
      junctionTables,
      generatedAt: new Date(),
      sourceDatabase: 'postgresql',
      sourceSchema: schema.schemaName,
    };
  }

  /**
   * Converts a single table to Convex table definition
   */
  private convertTable(
    table: TableInfo,
    relationships: DetectedRelationship[]
  ): ConvexTableDefinition {
    // Map columns to fields (excluding PostgreSQL auto-generated fields that Convex provides)
    const fields = table.columns
      .filter(
        (col) =>
          !this.isConvexSystemField(
            col.columnName,
            col.isPrimaryKey,
            col.isIdentity
          )
      )
      .map((col) => this.typeMapper.mapColumn(col));

    // Convert indexes
    const indexes = this.convertIndexes(table, fields);

    // Transform table name if configured
    const tableName = this.options.tableNameTransformer
      ? this.options.tableNameTransformer(table.tableName)
      : table.tableName;

    return {
      tableName,
      fields,
      indexes,
      relationships: relationships.filter(
        (r) => r.sourceTable === table.tableName
      ),
      originalTableName: table.tableName,
      schemaName: table.schemaName,
      comment: table.description || undefined,
    };
  }

  /**
   * Checks if a column should be excluded (Convex system field)
   */
  private isConvexSystemField(
    columnName: string,
    isPrimaryKey: boolean,
    isIdentity: boolean
  ): boolean {
    // Convex automatically provides _id and _creationTime
    // Skip primary key columns that are auto-increment (id, serial, etc.)
    if (isPrimaryKey && isIdentity) {
      return true;
    }

    // Skip columns named 'id' that are primary keys
    if (columnName.toLowerCase() === 'id' && isPrimaryKey) {
      return true;
    }

    return false;
  }

  /**
   * Converts PostgreSQL indexes to Convex index definitions
   */
  private convertIndexes(
    table: TableInfo,
    fields: ConvexFieldMapping[]
  ): ConvexIndexDefinition[] {
    if (this.options.indexStrategy === 'none') {
      return [];
    }

    // Group multi-column indexes
    const indexGroups = new Map<string, typeof table.indexes>();
    for (const idx of table.indexes) {
      // Skip primary key indexes (Convex handles _id)
      if (idx.indexName.endsWith('_pkey')) continue;

      const existing = indexGroups.get(idx.indexName) || [];
      existing.push(idx);
      indexGroups.set(idx.indexName, existing);
    }

    const convexIndexes: ConvexIndexDefinition[] = [];

    // Add indexes for foreign keys (always useful for queries)
    for (const fk of table.foreignKeys) {
      const fieldName = this.toCamelCase(fk.columnName);
      const indexName = `by_${fieldName}`;

      // Check if we already have this index
      if (!convexIndexes.some((i) => i.indexName === indexName)) {
        convexIndexes.push({
          indexName,
          fields: [fieldName],
          isUnique: false,
          originalIndexName: `fk_${fk.constraintName}`,
        });
      }
    }

    // Add indexes from PostgreSQL
    for (const [indexName, indexColumns] of indexGroups) {
      // Sort by ordinal position
      indexColumns.sort((a, b) => a.ordinalPosition - b.ordinalPosition);

      const isUnique = indexColumns[0].isUnique;

      // Skip non-unique if strategy is unique-only
      if (this.options.indexStrategy === 'unique-only' && !isUnique) {
        continue;
      }

      // Map column names to camelCase field names
      const fieldNames = indexColumns.map((ic) => {
        const field = fields.find(
          (f) => f.originalColumnName === ic.columnName
        );
        return field ? field.fieldName : this.toCamelCase(ic.columnName);
      });

      // Generate Convex-friendly index name
      const convexIndexName = this.generateIndexName(fieldNames);

      // Skip if we already have this index
      if (!convexIndexes.some((i) => i.indexName === convexIndexName)) {
        convexIndexes.push({
          indexName: convexIndexName,
          fields: fieldNames,
          isUnique,
          originalIndexName: indexName,
        });
      }
    }

    return convexIndexes;
  }

  /**
   * Generates a Convex-style index name
   */
  private generateIndexName(fields: string[]): string {
    return `by_${fields.join('_')}`;
  }

  /**
   * Generates the complete schema.ts file content
   */
  generateSchemaFile(schemaDef: ConvexSchemaDefinition): string {
    const lines: string[] = [];

    // Header comment
    lines.push('// Generated Convex Schema');
    lines.push(`// Source: PostgreSQL schema "${schemaDef.sourceSchema}"`);
    lines.push(`// Generated at: ${schemaDef.generatedAt.toISOString()}`);
    lines.push('// Do not edit directly - regenerate from source database');
    lines.push('');

    // Imports
    lines.push('import { defineSchema, defineTable } from "convex/server";');
    lines.push('import { v } from "convex/values";');
    lines.push('');

    // Export field validators if configured
    if (this.options.exportFieldValidators) {
      lines.push(
        '// ═══════════════════════════════════════════════════════════════'
      );
      lines.push('// Reusable Field Validators');
      lines.push(
        '// ═══════════════════════════════════════════════════════════════'
      );
      lines.push('');

      for (const table of schemaDef.tables) {
        const fieldsName = `${this.toCamelCase(table.tableName)}Fields`;
        lines.push(`export const ${fieldsName} = {`);

        for (const field of table.fields) {
          if (this.options.includeComments && field.comment) {
            lines.push(`  /** ${field.comment} */`);
          }
          lines.push(`  ${field.fieldName}: ${field.validator},`);
        }

        lines.push('};');
        lines.push('');
      }
    }

    // Main schema definition
    lines.push(
      '// ═══════════════════════════════════════════════════════════════'
    );
    lines.push('// Schema Definition');
    lines.push(
      '// ═══════════════════════════════════════════════════════════════'
    );
    lines.push('');

    const schemaValidationOption = this.options.schemaValidation
      ? ''
      : ', { schemaValidation: false }';

    lines.push('export default defineSchema({');

    for (let i = 0; i < schemaDef.tables.length; i++) {
      const table = schemaDef.tables[i];
      const isLast = i === schemaDef.tables.length - 1;

      lines.push(...this.generateTableDefinition(table, isLast));
    }

    lines.push(`}${schemaValidationOption});`);

    // Generate TypeScript types if configured
    if (this.options.generateTypes) {
      lines.push('');
      lines.push(
        '// ═══════════════════════════════════════════════════════════════'
      );
      lines.push('// TypeScript Types (for type-safe queries)');
      lines.push(
        '// ═══════════════════════════════════════════════════════════════'
      );
      lines.push('');
      lines.push('import type { Id } from "./_generated/dataModel";');
      lines.push('');

      for (const table of schemaDef.tables) {
        lines.push(...this.generateTypeDefinition(table));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Generates the defineTable code for a single table
   */
  private generateTableDefinition(
    table: ConvexTableDefinition,
    isLast: boolean
  ): string[] {
    const lines: string[] = [];
    const indent = '  ';

    // Table comment
    if (this.options.includeComments && table.comment) {
      lines.push(`${indent}/** ${table.comment} */`);
    }

    // Table definition start
    lines.push(`${indent}${table.tableName}: defineTable({`);

    // Fields
    for (const field of table.fields) {
      if (this.options.includeComments && field.comment) {
        lines.push(`${indent}${indent}/** ${field.comment} */`);
      }
      lines.push(`${indent}${indent}${field.fieldName}: ${field.validator},`);
    }

    lines.push(`${indent}})`);

    // Indexes
    for (const index of table.indexes) {
      const fieldsStr = index.fields.map((f) => `"${f}"`).join(', ');
      lines.push(
        `${indent}${indent}.index("${index.indexName}", [${fieldsStr}])`
      );
    }

    // Trailing comma except for last table
    const lastLineIdx = lines.length - 1;
    lines[lastLineIdx] = lines[lastLineIdx] + (isLast ? '' : ',');
    lines.push('');

    return lines;
  }

  /**
   * Generates TypeScript type definition for a table
   */
  private generateTypeDefinition(table: ConvexTableDefinition): string[] {
    const lines: string[] = [];
    const typeName = this.toPascalCase(table.tableName);

    lines.push(`export interface ${typeName} {`);
    lines.push(`  _id: Id<"${table.tableName}">;`);
    lines.push(`  _creationTime: number;`);

    for (const field of table.fields) {
      const tsType = this.validatorToTypeScript(field.validator);
      lines.push(
        `  ${field.fieldName}${field.isOptional ? '?' : ''}: ${tsType};`
      );
    }

    lines.push('}');

    // Create input type
    lines.push('');
    lines.push(`export interface Create${typeName}Input {`);
    for (const field of table.fields) {
      const tsType = this.validatorToTypeScript(field.validator);
      const isRequired = !field.isOptional;
      lines.push(`  ${field.fieldName}${isRequired ? '' : '?'}: ${tsType};`);
    }
    lines.push('}');

    // Update input type
    lines.push('');
    lines.push(`export interface Update${typeName}Input {`);
    for (const field of table.fields) {
      const tsType = this.validatorToTypeScript(field.validator);
      lines.push(`  ${field.fieldName}?: ${tsType};`);
    }
    lines.push('}');

    return lines;
  }

  /**
   * Extracts inner content from a validator wrapper, handling nested parentheses
   * e.g., 'v.optional(v.object({ x: v.number() }))' -> 'v.object({ x: v.number() })'
   */
  private extractInnerValidator(validator: string, prefix: string): string {
    if (!validator.startsWith(prefix + '(')) {
      return validator;
    }

    const start = prefix.length + 1; // Skip 'prefix('
    let depth = 1;
    let i = start;

    while (i < validator.length && depth > 0) {
      if (validator[i] === '(') {
        depth++;
      } else if (validator[i] === ')') {
        depth--;
      }
      i++;
    }

    // Extract everything between the opening and matching closing paren
    return validator.slice(start, i - 1);
  }

  /**
   * Converts a Convex validator expression to TypeScript type
   */
  private validatorToTypeScript(validator: string): string {
    // Handle optional wrapper - use proper parenthesis matching
    if (validator.startsWith('v.optional(')) {
      const inner = this.extractInnerValidator(validator, 'v.optional');
      return this.validatorToTypeScript(inner) + ' | undefined';
    }

    // Handle v.id()
    const idMatch = validator.match(/v\.id\("(\w+)"\)/);
    if (idMatch) {
      return `Id<"${idMatch[1]}">`;
    }

    // Handle v.array() - use proper parenthesis matching
    if (validator.startsWith('v.array(')) {
      const inner = this.extractInnerValidator(validator, 'v.array');
      return `${this.validatorToTypeScript(inner)}[]`;
    }

    // Handle v.object() - simplified
    if (validator.startsWith('v.object(')) {
      return 'Record<string, any>';
    }

    // Handle v.union() - simplified
    if (validator.startsWith('v.union(')) {
      return 'any'; // Union types are complex, simplify to any
    }

    // Handle basic types
    const typeMap: Record<string, string> = {
      'v.string()': 'string',
      'v.number()': 'number',
      'v.boolean()': 'boolean',
      'v.bytes()': 'ArrayBuffer',
      'v.null()': 'null',
      'v.any()': 'any',
      'v.int64()': 'bigint',
      'v.float64()': 'number',
    };

    return typeMap[validator] || 'any';
  }

  /**
   * Writes the generated schema to file(s)
   */
  async writeSchema(
    schemaDef: ConvexSchemaDefinition,
    outputDir: string
  ): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });

    if (this.options.outputMode === 'single') {
      const content = this.generateSchemaFile(schemaDef);
      await fs.writeFile(join(outputDir, 'schema.ts'), content, 'utf8');
    } else {
      // Split mode: one file per table + index file
      for (const table of schemaDef.tables) {
        const content = this.generateTableFile(table);
        await fs.writeFile(
          join(outputDir, `${table.tableName}.ts`),
          content,
          'utf8'
        );
      }

      // Generate index file
      const indexContent = this.generateIndexFile(schemaDef);
      await fs.writeFile(join(outputDir, 'schema.ts'), indexContent, 'utf8');
    }
  }

  /**
   * Generates a single table file (for split mode)
   */
  private generateTableFile(table: ConvexTableDefinition): string {
    const lines: string[] = [];

    lines.push(`// Table definition for ${table.tableName}`);
    lines.push('import { defineTable } from "convex/server";');
    lines.push('import { v } from "convex/values";');
    lines.push('');

    if (table.comment) {
      lines.push(`/** ${table.comment} */`);
    }

    lines.push(
      `export const ${this.toCamelCase(table.tableName)} = defineTable({`
    );

    for (const field of table.fields) {
      if (field.comment) {
        lines.push(`  /** ${field.comment} */`);
      }
      lines.push(`  ${field.fieldName}: ${field.validator},`);
    }

    lines.push('})');

    for (const index of table.indexes) {
      const fieldsStr = index.fields.map((f) => `"${f}"`).join(', ');
      lines.push(`  .index("${index.indexName}", [${fieldsStr}])`);
    }

    lines.push(';');

    return lines.join('\n');
  }

  /**
   * Generates the index file that imports all tables (for split mode)
   */
  private generateIndexFile(schemaDef: ConvexSchemaDefinition): string {
    const lines: string[] = [];

    lines.push('// Convex Schema - Auto-generated');
    lines.push('import { defineSchema } from "convex/server";');

    for (const table of schemaDef.tables) {
      const varName = this.toCamelCase(table.tableName);
      lines.push(`import { ${varName} } from "./${table.tableName}.js";`);
    }

    lines.push('');
    lines.push('export default defineSchema({');

    for (const table of schemaDef.tables) {
      const varName = this.toCamelCase(table.tableName);
      lines.push(`  ${table.tableName}: ${varName},`);
    }

    lines.push('});');

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // Utility methods
  // ═══════════════════════════════════════════════════════════════

  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  private toPascalCase(str: string): string {
    const camel = this.toCamelCase(str);
    return camel.charAt(0).toUpperCase() + camel.slice(1);
  }

  /**
   * Gets the type mapper for custom configuration
   */
  getTypeMapper(): ConvexTypeMapper {
    return this.typeMapper;
  }

  /**
   * Gets the relationship analyzer for custom queries
   */
  getRelationshipAnalyzer(): RelationshipAnalyzer {
    return this.relationshipAnalyzer;
  }
}
