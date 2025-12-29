/**
 * Data Transformer
 *
 * Transforms PostgreSQL row data to Convex document format.
 * Handles type conversion, field name mapping, foreign key resolution,
 * and special PostgreSQL types.
 */

import type {
  TableInfo,
  ColumnInfo,
} from '../introspector/schema-introspector.js';
import type {
  PostgresRow,
  ConvexDocument,
  IIdMapper,
  TableMigrationOptions,
  MigrationError,
} from './types.js';

/**
 * Transformer configuration
 */
export interface TransformerConfig {
  /** Convert snake_case to camelCase */
  convertFieldNames: boolean;
  /** Strip null values from output */
  stripNulls: boolean;
  /** Include empty strings as null */
  emptyStringsAsNull: boolean;
  /** How to handle unknown types */
  unknownTypeHandling: 'string' | 'skip' | 'error';
  /** Enable deferred FK mode for circular dependencies (default: false) */
  deferredForeignKeys: boolean;
}

/**
 * Default transformer configuration
 */
const DEFAULT_CONFIG: TransformerConfig = {
  convertFieldNames: true,
  stripNulls: false,
  emptyStringsAsNull: false,
  unknownTypeHandling: 'string',
  deferredForeignKeys: false,
};

/**
 * Transforms PostgreSQL rows to Convex documents
 */
export class DataTransformer {
  private config: TransformerConfig;
  private idMapper: IIdMapper;
  private customTransforms: Map<
    string,
    (value: unknown, column: ColumnInfo) => unknown
  >;

  constructor(idMapper: IIdMapper, config: Partial<TransformerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.idMapper = idMapper;
    this.customTransforms = new Map();
  }

  /**
   * Register a custom transform for a specific column type
   */
  registerTypeTransform(
    typeName: string,
    transform: (value: unknown, column: ColumnInfo) => unknown
  ): void {
    this.customTransforms.set(typeName.toLowerCase(), transform);
  }

  /**
   * Transform a single PostgreSQL row to Convex document
   */
  transform(
    row: PostgresRow,
    table: TableInfo,
    options: TableMigrationOptions = {}
  ): { document: ConvexDocument | null; errors: MigrationError[] } {
    const errors: MigrationError[] = [];
    const document: ConvexDocument = {};

    // Apply custom transform if provided
    if (options.transform) {
      const customResult = options.transform(row, table, this.idMapper);
      return { document: customResult, errors: [] };
    }

    for (const column of table.columns) {
      // Skip primary key ID columns (Convex generates _id)
      if (this.shouldSkipColumn(column, options)) {
        continue;
      }

      // Get field name (with optional mapping)
      const fieldName = this.getFieldName(column, options);
      const value = row[column.columnName];

      try {
        const transformedValue = this.transformValue(value, column);

        // Handle null values
        if (transformedValue === null || transformedValue === undefined) {
          if (!this.config.stripNulls && column.isNullable) {
            // Convex doesn't store null values, skip them
            continue;
          }
          continue;
        }

        document[fieldName] = transformedValue;
      } catch (error: unknown) {
        errors.push({
          code: 'TRANSFORM_ERROR',
          message: `Failed to transform ${column.columnName}: ${(error as Error).message}`,
          table: table.tableName,
          field: column.columnName,
          originalError: error as Error,
          retryable: false,
        });
      }
    }

    return { document, errors };
  }

  /**
   * Transform a batch of rows
   */
  transformBatch(
    rows: PostgresRow[],
    table: TableInfo,
    options: TableMigrationOptions = {}
  ): {
    documents: ConvexDocument[];
    errors: MigrationError[];
    skipped: number;
  } {
    const documents: ConvexDocument[] = [];
    const errors: MigrationError[] = [];
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const result = this.transform(rows[i], table, options);

      if (result.document) {
        documents.push(result.document);
      } else {
        skipped++;
      }

      for (const error of result.errors) {
        error.row = i;
        errors.push(error);
      }
    }

    return { documents, errors, skipped };
  }

  /**
   * Transform a single value based on column type
   */
  private transformValue(value: unknown, column: ColumnInfo): unknown {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return null;
    }

    // Handle empty strings
    if (this.config.emptyStringsAsNull && value === '') {
      return null;
    }

    // Handle foreign keys
    if (column.isForeignKey && column.foreignKeyTable) {
      return this.transformForeignKey(value, column);
    }

    // Check for custom transform
    const baseType = column.dataType.split('(')[0].toLowerCase();
    if (this.customTransforms.has(baseType)) {
      return this.customTransforms.get(baseType)!(value, column);
    }

    // Handle by PostgreSQL type
    return this.transformByType(value, column);
  }

  /**
   * Transform foreign key value to Convex ID
   * CRITICAL FIX: Added deferred FK mode for circular dependencies
   */
  private transformForeignKey(value: unknown, column: ColumnInfo): unknown {
    if (!column.foreignKeyTable) return null;

    // Try to resolve the foreign key
    const convexId = this.idMapper.tryResolveForeignKey(
      column.foreignKeyTable,
      value as string | number | null
    );

    if (convexId === undefined) {
      // Foreign key not found - could be not migrated yet or circular dependency

      // CRITICAL FIX: If deferred FK mode is enabled, set to null temporarily
      // This allows circular dependencies to be resolved in a second pass
      if (this.config.deferredForeignKeys) {
        console.warn(
          `Deferred FK: ${column.columnName} -> ${column.foreignKeyTable}[${value}] (will be resolved in second pass)`
        );
        return null;
      }

      // Return null for nullable columns, throw for required
      if (column.isNullable) {
        return null;
      }
      throw new Error(
        `Foreign key reference not found: ${column.foreignKeyTable}[${value}]. ` +
          `Enable deferredForeignKeys mode to handle circular dependencies.`
      );
    }

    return convexId;
  }

  /**
   * Transform value based on PostgreSQL type
   */
  private transformByType(value: unknown, column: ColumnInfo): unknown {
    const baseType = column.dataType.split('(')[0].toLowerCase();

    // Handle arrays
    if (
      column.dataType.includes('[]') ||
      column.dataType.toLowerCase().includes('array')
    ) {
      return this.transformArray(value, baseType.replace('[]', ''), column);
    }

    switch (baseType) {
      // String types
      case 'text':
      case 'varchar':
      case 'character varying':
      case 'character':
      case 'char':
      case 'citext':
        return String(value);

      // UUID
      case 'uuid':
        return String(value);

      // Integer types
      case 'integer':
      case 'int':
      case 'int4':
      case 'smallint':
      case 'int2':
        return Number(value);

      // BigInt (careful with precision)
      case 'bigint':
      case 'int8':
      case 'bigserial':
      case 'serial8':
        return this.transformBigInt(value);

      // Serial types
      case 'serial':
      case 'serial4':
        return Number(value);

      // Floating point
      case 'real':
      case 'float4':
      case 'double precision':
      case 'float8':
      case 'float':
        return Number(value);

      // Decimal/Numeric
      case 'decimal':
      case 'numeric':
        return this.transformNumeric(value, column);

      // Money
      case 'money':
        return this.transformMoney(value);

      // Boolean
      case 'boolean':
      case 'bool':
        return this.transformBoolean(value);

      // Timestamps
      case 'timestamp':
      case 'timestamp without time zone':
      case 'timestamp with time zone':
      case 'timestamptz':
        return this.transformTimestamp(value);

      // Date
      case 'date':
        return this.transformDate(value);

      // Time
      case 'time':
      case 'time without time zone':
      case 'time with time zone':
      case 'timetz':
        return this.transformTime(value);

      // Interval
      case 'interval':
        return this.transformInterval(value);

      // JSON
      case 'json':
      case 'jsonb':
        return this.transformJson(value);

      // Binary
      case 'bytea':
        return this.transformBytea(value);

      // Geometric types
      case 'point':
        return this.transformPoint(value);
      case 'line':
      case 'lseg':
      case 'box':
      case 'path':
      case 'polygon':
      case 'circle':
        return this.transformGeometric(value, baseType);

      // Range types
      case 'int4range':
      case 'int8range':
      case 'numrange':
      case 'tsrange':
      case 'tstzrange':
      case 'daterange':
        return this.transformRange(value);

      // Network types
      case 'inet':
      case 'cidr':
      case 'macaddr':
      case 'macaddr8':
        return String(value);

      // Full text search (convert to string representation)
      case 'tsvector':
      case 'tsquery':
        return String(value);

      // XML
      case 'xml':
        return String(value);

      // Enum (user-defined)
      case 'user-defined':
        return String(value);

      default:
        if (this.config.unknownTypeHandling === 'string') {
          return String(value);
        } else if (this.config.unknownTypeHandling === 'skip') {
          return null;
        } else {
          throw new Error(`Unknown PostgreSQL type: ${column.dataType}`);
        }
    }
  }

  /**
   * Transform array values
   */
  private transformArray(
    value: unknown,
    elementType: string,
    column: ColumnInfo
  ): unknown[] {
    if (!Array.isArray(value)) {
      // PostgreSQL might return arrays as strings like "{1,2,3}"
      if (typeof value === 'string') {
        return this.parseArrayString(value, elementType);
      }
      return [];
    }

    return value.map((item) => {
      // Create a temporary column info for element type
      const elementColumn: ColumnInfo = {
        ...column,
        dataType: elementType,
      };
      return this.transformByType(item, elementColumn);
    });
  }

  /**
   * Parse PostgreSQL array string format
   */
  private parseArrayString(str: string, elementType: string): unknown[] {
    // Remove curly braces
    const inner = str.slice(1, -1);
    if (!inner) return [];

    // Split by comma (handle quoted strings)
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of inner) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current) {
      parts.push(current.trim());
    }

    // Convert each part based on element type
    return parts.map((part) => {
      if (part === 'NULL') return null;
      if (part.startsWith('"') && part.endsWith('"')) {
        part = part.slice(1, -1);
      }

      // Basic type conversion
      switch (elementType) {
        case 'integer':
        case 'int':
        case 'smallint':
        case 'bigint':
          return Number(part);
        case 'boolean':
        case 'bool':
          return part === 't' || part === 'true';
        default:
          return part;
      }
    });
  }

  /**
   * Transform bigint with precision handling
   */
  private transformBigInt(value: unknown): number {
    const num = typeof value === 'bigint' ? Number(value) : Number(value);

    // Warn if precision might be lost
    if (num > Number.MAX_SAFE_INTEGER || num < Number.MIN_SAFE_INTEGER) {
      console.warn(
        `BigInt value ${value} exceeds safe integer range. Precision may be lost.`
      );
    }

    return num;
  }

  /**
   * Transform numeric/decimal with precision handling
   */
  private transformNumeric(value: unknown, column: ColumnInfo): number {
    const num = Number(value);

    // Check precision
    if (column.numericPrecision && column.numericPrecision > 15) {
      console.warn(
        `Numeric value with precision ${column.numericPrecision} may lose precision in JavaScript.`
      );
    }

    return num;
  }

  /**
   * Transform money type
   */
  private transformMoney(value: unknown): number {
    // Money is typically returned as string like "$1,234.56"
    const str = String(value).replace(/[$,]/g, '');
    return Number(str);
  }

  /**
   * Transform boolean
   */
  private transformBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true' || value === 't' || value === '1';
    }
    return Boolean(value);
  }

  /**
   * Transform timestamp to Unix milliseconds
   */
  private transformTimestamp(value: unknown): number {
    if (value instanceof Date) {
      return value.getTime();
    }
    return new Date(String(value)).getTime();
  }

  /**
   * Transform date to Unix milliseconds (midnight)
   */
  private transformDate(value: unknown): number {
    if (value instanceof Date) {
      return value.getTime();
    }
    // Parse date string (YYYY-MM-DD)
    const date = new Date(String(value));
    return date.getTime();
  }

  /**
   * Transform time to string (HH:MM:SS)
   */
  private transformTime(value: unknown): string {
    return String(value);
  }

  /**
   * Transform interval to ISO 8601 duration string
   */
  private transformInterval(value: unknown): string {
    // PostgreSQL intervals are complex, store as string
    return String(value);
  }

  /**
   * Transform JSON/JSONB
   */
  private transformJson(value: unknown): unknown {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  /**
   * Transform bytea to ArrayBuffer representation
   */
  private transformBytea(value: unknown): string {
    // For now, convert to base64 string
    // Convex supports ArrayBuffer but needs special handling
    if (Buffer.isBuffer(value)) {
      return value.toString('base64');
    }
    if (typeof value === 'string') {
      // Handle hex format \x...
      if (value.startsWith('\\x')) {
        return Buffer.from(value.slice(2), 'hex').toString('base64');
      }
    }
    return String(value);
  }

  /**
   * Transform point type
   */
  private transformPoint(value: unknown): { x: number; y: number } {
    if (typeof value === 'string') {
      // Parse "(x,y)" format
      const match = value.match(/\((-?[\d.]+),(-?[\d.]+)\)/);
      if (match) {
        return { x: Number(match[1]), y: Number(match[2]) };
      }
    }
    // Already an object
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      return { x: Number(obj.x), y: Number(obj.y) };
    }
    return { x: 0, y: 0 };
  }

  /**
   * Transform generic geometric type
   */
  private transformGeometric(value: unknown, type: string): unknown {
    // Store as string representation for now
    return { type, value: String(value) };
  }

  /**
   * Transform range type
   */
  private transformRange(value: unknown): {
    lower: unknown;
    upper: unknown;
    bounds: string;
  } {
    if (typeof value === 'string') {
      // Parse "[lower,upper)" format
      const match = value.match(/([[(])([^,]*),([^)\]]*)([)\]])/);
      if (match) {
        return {
          lower: match[2] || null,
          upper: match[3] || null,
          bounds: match[1] + match[4],
        };
      }
    }
    return { lower: null, upper: null, bounds: '[]' };
  }

  /**
   * Check if column should be skipped
   */
  private shouldSkipColumn(
    column: ColumnInfo,
    options: TableMigrationOptions
  ): boolean {
    // Skip if in skipFields
    if (options.skipFields?.includes(column.columnName)) {
      return true;
    }

    // Skip auto-generated primary key 'id' columns
    if (column.isPrimaryKey && column.isIdentity) {
      return true;
    }
    if (column.isPrimaryKey && column.columnName.toLowerCase() === 'id') {
      return true;
    }

    return false;
  }

  /**
   * Get field name for column (with mapping and case conversion)
   */
  private getFieldName(
    column: ColumnInfo,
    options: TableMigrationOptions
  ): string {
    // Check custom mapping first
    if (options.fieldMappings?.[column.columnName]) {
      return options.fieldMappings[column.columnName];
    }

    // Convert to camelCase if enabled
    if (this.config.convertFieldNames) {
      return this.toCamelCase(column.columnName);
    }

    return column.columnName;
  }

  /**
   * Convert snake_case to camelCase
   */
  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * Get primary key value from row
   */
  getPrimaryKeyValue(
    row: PostgresRow,
    table: TableInfo,
    options: TableMigrationOptions = {}
  ): unknown {
    // Use custom primary key if specified
    if (options.primaryKey) {
      return row[options.primaryKey];
    }

    // Find primary key column
    const pkColumn = table.columns.find((c) => c.isPrimaryKey);
    if (pkColumn) {
      return row[pkColumn.columnName];
    }

    // Try common names
    return row['id'] || row['_id'] || row[`${table.tableName}_id`];
  }
}

/**
 * Create a pre-configured transformer with common settings
 */
export function createTransformer(
  idMapper: IIdMapper,
  options: Partial<TransformerConfig> = {}
): DataTransformer {
  const transformer = new DataTransformer(idMapper, options);

  // Register some useful custom transforms
  transformer.registerTypeTransform('inet', (value) => String(value));
  transformer.registerTypeTransform('cidr', (value) => String(value));

  return transformer;
}
