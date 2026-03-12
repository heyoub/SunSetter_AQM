/**
 * Base Convex Generator
 *
 * Abstract base class that consolidates shared logic across all Convex
 * code generators (schema, query, mutation, validator, type, action, http-action).
 *
 * Shared utilities:
 * - Column filtering (shouldSkipColumn, getCreateFields, getUpdateFields)
 * - Type mapping (mapToConvexType, mapSimpleConvexType, getConvexValidator)
 * - API version detection (useNewApiStyle)
 * - Constructor pattern with defaults + user overrides
 */

import type {
  TableInfo,
  ColumnInfo,
} from '../../introspector/schema-introspector.js';
import type { ConvexApiVersion } from '../../convex/types.js';

/**
 * Minimal options shared by all generators.
 * Each generator extends this with its own specific options.
 */
export interface BaseGeneratorOptions {
  convexApiVersion?: ConvexApiVersion;
}

/**
 * Abstract base class for Convex code generators.
 *
 * Subclasses supply their own TOptions that must extend BaseGeneratorOptions.
 * The constructor merges sensible defaults with user-supplied overrides so
 * every subclass gets the same "spread-defaults" pattern without duplication.
 */
export abstract class BaseConvexGenerator<
  TOptions extends BaseGeneratorOptions = BaseGeneratorOptions,
> {
  protected options: TOptions;

  constructor(defaults: TOptions, userOptions?: Partial<TOptions>) {
    this.options = { ...defaults, ...userOptions } as TOptions;
  }

  // ---------------------------------------------------------------------------
  // API version helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if using Convex 1.31+ API style.
   * In 1.31+, db.get / db.patch / db.delete take the table name as the first arg.
   */
  protected useNewApiStyle(): boolean {
    return this.options.convexApiVersion === '1.31';
  }

  // ---------------------------------------------------------------------------
  // Column filtering
  // ---------------------------------------------------------------------------

  /**
   * Check if a column should be skipped entirely in generated output.
   * Skips auto-increment primary keys (Convex provides _id) and columns
   * named "id" that are primary keys.
   */
  protected shouldSkipColumn(column: ColumnInfo): boolean {
    // Skip auto-increment primary keys (Convex provides _id)
    if (column.isPrimaryKey && column.isIdentity) return true;
    // Skip columns named 'id' that are primary keys
    if (column.columnName.toLowerCase() === 'id' && column.isPrimaryKey)
      return true;
    return false;
  }

  /**
   * Get fields suitable for a "create" operation (excludes auto-generated
   * columns such as identity / serial / PK named "id").
   */
  protected getCreateFields(table: TableInfo): ColumnInfo[] {
    return this.getUniqueColumns(table).filter((col) => {
      // Skip auto-increment/identity columns
      if (col.isIdentity) return false;
      // Skip serial columns
      if (col.columnDefault?.includes('nextval')) return false;
      // Skip primary key columns named 'id'
      if (col.isPrimaryKey && col.columnName.toLowerCase() === 'id')
        return false;
      return true;
    });
  }

  /**
   * Get fields suitable for an "update" operation (excludes primary keys
   * and identity columns).
   */
  protected getUpdateFields(table: TableInfo): ColumnInfo[] {
    return this.getUniqueColumns(table).filter((col) => {
      // Skip primary keys
      if (col.isPrimaryKey) return false;
      // Skip identity columns
      if (col.isIdentity) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Type / validator mapping
  // ---------------------------------------------------------------------------

  /**
   * Get the full Convex validator string for a column, handling foreign keys,
   * nullability, and defaults.
   */
  protected getConvexValidator(column: ColumnInfo): string {
    // Handle foreign keys
    if (column.isForeignKey && column.foreignKeyTable) {
      const base = `v.id("${column.foreignKeyTable}")`;
      return column.isNullable || column.columnDefault
        ? `v.optional(${base})`
        : base;
    }

    const baseType = this.mapToConvexType(column);
    return column.isNullable || column.columnDefault
      ? `v.optional(${baseType})`
      : baseType;
  }

  /**
   * Map a column to its Convex validator, handling arrays.
   */
  protected mapToConvexType(column: ColumnInfo): string {
    const cleanType = this.normalizeTypeName(column.dataType);

    // Handle arrays
    if (column.dataType.includes('[]')) {
      const baseType = cleanType.replace('[]', '');
      const elementType = this.mapSimpleConvexType(baseType);
      return `v.array(${elementType})`;
    }

    return this.mapSimpleConvexType(cleanType);
  }

  /**
   * Map a simple SQL type name to a Convex validator string.
   * This is the ~30-entry canonical mapping table used across generators.
   */
  protected mapSimpleConvexType(pgType: string): string {
    const mapping: Record<string, string> = {
      // String types
      text: 'v.string()',
      varchar: 'v.string()',
      'character varying': 'v.string()',
      character: 'v.string()',
      char: 'v.string()',
      uuid: 'v.string()',
      citext: 'v.string()',

      // Number types
      integer: 'v.number()',
      int: 'v.number()',
      int4: 'v.number()',
      smallint: 'v.number()',
      bigint: 'v.number()',
      int8: 'v.number()',
      serial: 'v.number()',
      bigserial: 'v.number()',
      decimal: 'v.number()',
      numeric: 'v.number()',
      real: 'v.number()',
      float4: 'v.number()',
      'double precision': 'v.number()',
      float8: 'v.number()',
      money: 'v.number()',

      // Boolean
      boolean: 'v.boolean()',
      bool: 'v.boolean()',

      // Timestamps (stored as Unix ms)
      timestamp: 'v.number()',
      'timestamp without time zone': 'v.number()',
      'timestamp with time zone': 'v.number()',
      timestamptz: 'v.number()',
      date: 'v.number()',
      time: 'v.string()',
      interval: 'v.string()',

      // JSON
      json: 'v.any()',
      jsonb: 'v.any()',

      // Vector / embeddings
      vector: 'v.array(v.float64())',

      // Binary
      bytea: 'v.bytes()',
    };

    return mapping[pgType] || 'v.string()';
  }

  protected normalizeTypeName(dataType: string): string {
    return dataType.split('(')[0].split('[')[0].toLowerCase().trim();
  }

  /**
   * Dedupe columns defensively at generator time.
   * This protects CRUD emitters even if upstream introspection returns overlaps.
   */
  protected getUniqueColumns(table: TableInfo): ColumnInfo[] {
    const deduped = new Map<string, ColumnInfo>();

    for (const column of table.columns) {
      const existing = deduped.get(column.columnName);

      if (!existing) {
        deduped.set(column.columnName, { ...column });
        continue;
      }

      deduped.set(column.columnName, {
        ...existing,
        dataType:
          existing.dataType === 'USER-DEFINED'
            ? column.dataType
            : existing.dataType,
        columnDefault: existing.columnDefault ?? column.columnDefault,
        characterMaximumLength:
          existing.characterMaximumLength ?? column.characterMaximumLength,
        numericPrecision: existing.numericPrecision ?? column.numericPrecision,
        numericScale: existing.numericScale ?? column.numericScale,
        ordinalPosition: Math.min(
          existing.ordinalPosition,
          column.ordinalPosition
        ),
        isIdentity: existing.isIdentity || column.isIdentity,
        isPrimaryKey: existing.isPrimaryKey || column.isPrimaryKey,
        isForeignKey: existing.isForeignKey || column.isForeignKey,
        foreignKeyTable: existing.foreignKeyTable ?? column.foreignKeyTable,
        foreignKeyColumn: existing.foreignKeyColumn ?? column.foreignKeyColumn,
        description: existing.description ?? column.description,
        isGenerated: existing.isGenerated || column.isGenerated,
        generationExpression:
          existing.generationExpression ?? column.generationExpression,
        generationType: existing.generationType ?? column.generationType,
        domainName: existing.domainName ?? column.domainName,
        domainBaseType: existing.domainBaseType ?? column.domainBaseType,
      });
    }

    return Array.from(deduped.values()).sort(
      (left, right) => left.ordinalPosition - right.ordinalPosition
    );
  }

  protected getUniqueForeignKeys(table: TableInfo): TableInfo['foreignKeys'] {
    const deduped = new Map<string, TableInfo['foreignKeys'][number]>();

    for (const foreignKey of table.foreignKeys) {
      const key = [
        foreignKey.columnName,
        foreignKey.referencedSchema,
        foreignKey.referencedTable,
        foreignKey.referencedColumn,
      ].join('|');

      if (!deduped.has(key)) {
        deduped.set(key, { ...foreignKey });
      }
    }

    return Array.from(deduped.values());
  }
}
