/**
 * Edge Case Handler
 *
 * Detects and warns about PostgreSQL features that may need
 * special handling when migrating to Convex.
 */

import type {
  TableInfo,
  ColumnInfo,
  EdgeCaseWarning,
  EdgeCaseWarningType,
} from './types.js';

// ============================================================================
// Convex Limits (from docs.convex.dev/production/state/limits)
// ============================================================================

/**
 * Convex document and schema limits
 */
export const CONVEX_LIMITS = {
  /** Maximum document size in bytes */
  MAX_DOCUMENT_SIZE: 1024 * 1024, // 1 MB
  /** Maximum fields per document */
  MAX_FIELDS_PER_DOCUMENT: 1024,
  /** Maximum field name length */
  MAX_FIELD_NAME_LENGTH: 64,
  /** Maximum nesting depth */
  MAX_NESTING_DEPTH: 16,
  /** Maximum array elements */
  MAX_ARRAY_ELEMENTS: 8192,
  /** Maximum documents written per transaction */
  MAX_DOCS_PER_TRANSACTION: 16000,
  /** Maximum data written per transaction (bytes) */
  MAX_DATA_PER_TRANSACTION: 16 * 1024 * 1024, // 16 MB
  /** Maximum indexes per table */
  MAX_INDEXES_PER_TABLE: 32,
  /** Maximum search indexes per table */
  MAX_SEARCH_INDEXES_PER_TABLE: 32,
  /** Maximum vector indexes per table */
  MAX_VECTOR_INDEXES_PER_TABLE: 4,
  /** Maximum vector dimensions */
  MAX_VECTOR_DIMENSIONS: 4096,
  /** Minimum vector dimensions */
  MIN_VECTOR_DIMENSIONS: 2,
  /** Warning threshold for document size (80% of limit) */
  DOCUMENT_SIZE_WARNING_THRESHOLD: 0.8 * 1024 * 1024,
  /** Warning threshold for field count (80% of limit) */
  FIELD_COUNT_WARNING_THRESHOLD: 820,
} as const;

/**
 * PostgreSQL types that require special attention
 */
const PROBLEMATIC_TYPES = [
  'money', // Precision issues
  'numeric', // May need precision validation
  'decimal', // May need precision validation
  'interval', // Complex time representation
  'xml', // May need parsing
  'tsvector', // Full-text search
  'tsquery', // Full-text search
];

/**
 * PostgreSQL types that have special geometric handling
 */
const GEOMETRIC_TYPES = [
  'point',
  'line',
  'lseg',
  'box',
  'path',
  'polygon',
  'circle',
];

/**
 * PostgreSQL types that are range types
 */
const RANGE_TYPES = [
  'int4range',
  'int8range',
  'numrange',
  'tsrange',
  'tstzrange',
  'daterange',
];

/**
 * Handles edge cases and generates warnings/suggestions
 */
export class EdgeCaseHandler {
  private warnings: EdgeCaseWarning[] = [];

  /**
   * Processes a table for edge cases
   */
  processTable(table: TableInfo): EdgeCaseWarning[] {
    this.warnings = [];

    // Check for missing primary key
    if (table.primaryKeys.length === 0) {
      this.addWarning({
        type: 'warning',
        table: table.tableName,
        message: 'Table has no primary key',
        suggestion:
          'Convex will auto-generate _id. Consider if this is desired.',
      });
    }

    // Check for composite primary keys
    if (table.primaryKeys.length > 1) {
      this.addWarning({
        type: 'info',
        table: table.tableName,
        message: `Composite primary key (${table.primaryKeys.join(', ')})`,
        suggestion:
          'Convex uses single _id. Consider adding a unique index for the compound key.',
      });
    }

    // Process each column
    for (const column of table.columns) {
      this.processColumn(table.tableName, column);
    }

    // Check for self-referential foreign keys
    for (const fk of table.foreignKeys) {
      if (fk.referencedTable === table.tableName) {
        this.addWarning({
          type: 'info',
          table: table.tableName,
          column: fk.columnName,
          message: 'Self-referential foreign key detected',
          suggestion: 'Ensure proper null handling for root nodes.',
        });
      }
    }

    // Check for very wide tables
    if (table.columns.length > 50) {
      this.addWarning({
        type: 'info',
        table: table.tableName,
        message: `Wide table with ${table.columns.length} columns`,
        suggestion:
          'Consider if all columns are needed. Convex documents have size limits.',
      });
    }

    // ========================================================================
    // Convex Limit Validations
    // ========================================================================

    // Check field count against Convex limit
    if (table.columns.length > CONVEX_LIMITS.MAX_FIELDS_PER_DOCUMENT) {
      this.addWarning({
        type: 'error',
        table: table.tableName,
        message: `Table has ${table.columns.length} columns, exceeding Convex limit of ${CONVEX_LIMITS.MAX_FIELDS_PER_DOCUMENT} fields`,
        suggestion:
          'Split table into multiple related tables or reduce field count.',
      });
    } else if (
      table.columns.length > CONVEX_LIMITS.FIELD_COUNT_WARNING_THRESHOLD
    ) {
      this.addWarning({
        type: 'warning',
        table: table.tableName,
        message: `Table has ${table.columns.length} columns, approaching Convex limit of ${CONVEX_LIMITS.MAX_FIELDS_PER_DOCUMENT}`,
        suggestion:
          'Consider splitting into multiple tables if more fields will be added.',
      });
    }

    // Check index count against Convex limit
    const indexCount = table.indexes.length + table.foreignKeys.length;
    if (indexCount > CONVEX_LIMITS.MAX_INDEXES_PER_TABLE) {
      this.addWarning({
        type: 'error',
        table: table.tableName,
        message: `Table would have ${indexCount} indexes, exceeding Convex limit of ${CONVEX_LIMITS.MAX_INDEXES_PER_TABLE}`,
        suggestion:
          'Remove some indexes or use fewer foreign key relationships.',
      });
    } else if (indexCount > CONVEX_LIMITS.MAX_INDEXES_PER_TABLE * 0.8) {
      this.addWarning({
        type: 'warning',
        table: table.tableName,
        message: `Table would have ${indexCount} indexes, approaching Convex limit of ${CONVEX_LIMITS.MAX_INDEXES_PER_TABLE}`,
        suggestion: 'Be cautious about adding more indexes.',
      });
    }

    // Check field name lengths
    for (const column of table.columns) {
      const camelCaseName = column.columnName.replace(
        /_([a-z])/g,
        (_, letter) => letter.toUpperCase()
      );
      if (camelCaseName.length > CONVEX_LIMITS.MAX_FIELD_NAME_LENGTH) {
        this.addWarning({
          type: 'error',
          table: table.tableName,
          column: column.columnName,
          message: `Field name "${camelCaseName}" exceeds Convex limit of ${CONVEX_LIMITS.MAX_FIELD_NAME_LENGTH} characters`,
          suggestion:
            'Use a shorter field name or configure a custom name transformer.',
        });
      }
    }

    // Estimate document size (rough calculation based on column types)
    const estimatedSize = this.estimateDocumentSize(table);
    if (estimatedSize > CONVEX_LIMITS.MAX_DOCUMENT_SIZE) {
      this.addWarning({
        type: 'error',
        table: table.tableName,
        message: `Estimated document size (~${Math.round(estimatedSize / 1024)}KB) may exceed Convex 1MB limit`,
        suggestion:
          'Consider storing large text/binary data in Convex file storage.',
      });
    } else if (estimatedSize > CONVEX_LIMITS.DOCUMENT_SIZE_WARNING_THRESHOLD) {
      this.addWarning({
        type: 'warning',
        table: table.tableName,
        message: `Estimated document size (~${Math.round(estimatedSize / 1024)}KB) approaching Convex 1MB limit`,
        suggestion: 'Monitor document sizes during migration.',
      });
    }

    return this.warnings;
  }

  /**
   * Processes a column for edge cases
   */
  private processColumn(tableName: string, column: ColumnInfo): void {
    const baseType = column.dataType.split('(')[0].toLowerCase();

    // Check for problematic types
    if (PROBLEMATIC_TYPES.includes(baseType)) {
      this.addWarning({
        type: 'info',
        table: tableName,
        column: column.columnName,
        message: `PostgreSQL type "${column.dataType}" requires attention`,
        suggestion: this.getTypeSuggestion(baseType),
      });
    }

    // Check for geometric types
    if (GEOMETRIC_TYPES.includes(baseType)) {
      this.addWarning({
        type: 'info',
        table: tableName,
        column: column.columnName,
        message: `Geometric type "${column.dataType}"`,
        suggestion:
          'Will be converted to structured object. Ensure client code handles the format.',
      });
    }

    // Check for range types
    if (RANGE_TYPES.includes(baseType)) {
      this.addWarning({
        type: 'info',
        table: tableName,
        column: column.columnName,
        message: `Range type "${column.dataType}"`,
        suggestion:
          'Will be converted to object with lower/upper bounds. Ensure client code handles the format.',
      });
    }

    // Check for very long varchar
    if (
      column.characterMaximumLength &&
      column.characterMaximumLength > 10000
    ) {
      this.addWarning({
        type: 'info',
        table: tableName,
        column: column.columnName,
        message: `Very long varchar (${column.characterMaximumLength})`,
        suggestion:
          'Consider if this needs to be stored differently in Convex.',
      });
    }

    // Check for bytea (binary data)
    if (baseType === 'bytea') {
      this.addWarning({
        type: 'info',
        table: tableName,
        column: column.columnName,
        message: 'Binary data column',
        suggestion: 'Consider using Convex file storage for large binary data.',
      });
    }

    // Check for array types
    if (
      column.dataType.includes('[]') ||
      column.dataType.toUpperCase().includes('ARRAY')
    ) {
      this.addWarning({
        type: 'info',
        table: tableName,
        column: column.columnName,
        message: 'Array column detected',
        suggestion:
          'Will be converted to v.array(). Verify element type mapping.',
      });
    }

    // Check for enum types (USER-DEFINED)
    if (column.dataType.toUpperCase() === 'USER-DEFINED') {
      this.addWarning({
        type: 'warning',
        table: tableName,
        column: column.columnName,
        message: 'User-defined type (likely enum)',
        suggestion:
          'Register enum values using registerEnumMapping() for proper v.union() generation.',
      });
    }

    // Check for default expressions
    if (column.columnDefault) {
      const complexDefaults = [
        'now()',
        'current_timestamp',
        'current_date',
        'current_time',
        'gen_random_uuid()',
        'uuid_generate_v4()',
        'nextval(',
      ];
      const hasComplexDefault = complexDefaults.some((d) =>
        column.columnDefault?.toLowerCase().includes(d.toLowerCase())
      );

      if (hasComplexDefault) {
        this.addWarning({
          type: 'info',
          table: tableName,
          column: column.columnName,
          message: `Server-side default: ${column.columnDefault}`,
          suggestion:
            'Convex handles defaults differently. Implement in mutation logic.',
        });
      }
    }

    // Check for high precision numerics
    if (
      (baseType === 'numeric' || baseType === 'decimal') &&
      column.numericPrecision &&
      column.numericPrecision > 15
    ) {
      this.addWarning({
        type: 'warning',
        table: tableName,
        column: column.columnName,
        message: `High precision numeric (${column.numericPrecision} digits)`,
        suggestion:
          'JavaScript numbers have ~15 significant digits. Consider storing as string for exact precision.',
      });
    }

    // Check for very large numeric scale
    if (column.numericScale && column.numericScale > 10) {
      this.addWarning({
        type: 'info',
        table: tableName,
        column: column.columnName,
        message: `High numeric scale (${column.numericScale} decimal places)`,
        suggestion: 'Ensure this precision is needed in Convex.',
      });
    }

    // Check for bigint/serial8
    if (['bigint', 'int8', 'bigserial', 'serial8'].includes(baseType)) {
      this.addWarning({
        type: 'info',
        table: tableName,
        column: column.columnName,
        message: 'BigInt column',
        suggestion:
          'Will be stored as number. Values > 2^53 will lose precision. Consider v.int64() if needed.',
      });
    }
  }

  /**
   * Estimates document size based on column types
   * This is a rough estimate based on typical data sizes
   */
  private estimateDocumentSize(table: TableInfo): number {
    let totalBytes = 0;

    for (const column of table.columns) {
      const baseType = column.dataType.split('(')[0].toLowerCase();
      const maxLength = column.characterMaximumLength;

      // Estimate size based on type
      switch (baseType) {
        case 'text':
          // Text can be very large, estimate based on typical usage
          totalBytes += maxLength ? maxLength : 10000; // Default 10KB for unbounded text
          break;
        case 'varchar':
        case 'character varying':
          totalBytes += maxLength ? maxLength : 255;
          break;
        case 'char':
        case 'character':
          totalBytes += maxLength ? maxLength : 1;
          break;
        case 'json':
        case 'jsonb':
          // JSON can be large, estimate 10KB average
          totalBytes += 10000;
          break;
        case 'bytea':
          // Binary data can be large
          totalBytes += 50000; // Estimate 50KB
          break;
        case 'uuid':
          totalBytes += 36;
          break;
        case 'integer':
        case 'int':
        case 'int4':
        case 'smallint':
        case 'int2':
          totalBytes += 8; // JSON number representation
          break;
        case 'bigint':
        case 'int8':
          totalBytes += 20; // Large numbers as strings
          break;
        case 'numeric':
        case 'decimal':
        case 'real':
        case 'float4':
        case 'double precision':
        case 'float8':
          totalBytes += 24; // Floating point representation
          break;
        case 'boolean':
        case 'bool':
          totalBytes += 5; // "true" or "false"
          break;
        case 'timestamp':
        case 'timestamptz':
        case 'timestamp with time zone':
        case 'timestamp without time zone':
        case 'date':
          totalBytes += 13; // Unix timestamp as number
          break;
        case 'time':
        case 'interval':
          totalBytes += 30; // String representation
          break;
        case 'point':
        case 'lseg':
        case 'box':
        case 'circle':
          totalBytes += 100; // Structured object
          break;
        case 'path':
        case 'polygon':
          totalBytes += 500; // Array of points
          break;
        default:
          // Default estimate for unknown types
          totalBytes += 100;
      }

      // Account for field name overhead
      totalBytes += column.columnName.length + 10;

      // Account for array types (multiply base estimate)
      if (column.dataType.includes('[]')) {
        totalBytes *= 10; // Assume average 10 elements
      }
    }

    // Add Convex metadata overhead (~100 bytes for _id, _creationTime)
    totalBytes += 100;

    return totalBytes;
  }

  /**
   * Gets suggestion for specific PostgreSQL types
   */
  private getTypeSuggestion(pgType: string): string {
    const suggestions: Record<string, string> = {
      money: 'Store as number (cents) to avoid floating point issues.',
      numeric:
        'Ensure precision is acceptable with v.number(). Consider string for high precision.',
      decimal:
        'Ensure precision is acceptable with v.number(). Consider string for high precision.',
      interval:
        'Will be stored as ISO 8601 duration string. Parse in application code.',
      xml: 'Will be stored as string. Consider JSON conversion if structured data.',
      tsvector:
        'Full-text search not directly supported. Consider Convex search features.',
      tsquery:
        'Full-text search not directly supported. Consider Convex search features.',
    };
    return suggestions[pgType] || 'Review type conversion carefully.';
  }

  private addWarning(warning: EdgeCaseWarning): void {
    this.warnings.push(warning);
  }

  /**
   * Processes all tables in a schema
   */
  processSchema(tables: TableInfo[]): EdgeCaseWarning[] {
    const allWarnings: EdgeCaseWarning[] = [];

    for (const table of tables) {
      const tableWarnings = this.processTable(table);
      allWarnings.push(...tableWarnings);
    }

    return allWarnings;
  }

  /**
   * Formats warnings for console output
   */
  formatWarnings(warnings: EdgeCaseWarning[]): string {
    if (warnings.length === 0) {
      return 'No edge cases detected.';
    }

    const lines: string[] = ['Edge Cases and Suggestions:', ''];

    // Group by table
    const byTable = new Map<string, EdgeCaseWarning[]>();
    for (const w of warnings) {
      const existing = byTable.get(w.table) || [];
      existing.push(w);
      byTable.set(w.table, existing);
    }

    for (const [table, tableWarnings] of byTable) {
      lines.push(`  ${table}:`);

      for (const w of tableWarnings) {
        const prefix = this.getPrefix(w.type);
        const location = w.column ? `${w.column}` : '(table)';
        lines.push(`    ${prefix} ${location}: ${w.message}`);
        if (w.suggestion) {
          lines.push(`         Suggestion: ${w.suggestion}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Gets prefix for warning type
   */
  private getPrefix(type: EdgeCaseWarningType): string {
    switch (type) {
      case 'error':
        return '[ERROR]';
      case 'warning':
        return '[WARN]';
      case 'info':
      default:
        return '[INFO]';
    }
  }

  /**
   * Gets summary statistics
   */
  getSummary(warnings: EdgeCaseWarning[]): {
    errors: number;
    warnings: number;
    info: number;
  } {
    return {
      errors: warnings.filter((w) => w.type === 'error').length,
      warnings: warnings.filter((w) => w.type === 'warning').length,
      info: warnings.filter((w) => w.type === 'info').length,
    };
  }

  /**
   * Filters warnings by severity
   */
  filterByType(
    warnings: EdgeCaseWarning[],
    type: EdgeCaseWarningType
  ): EdgeCaseWarning[] {
    return warnings.filter((w) => w.type === type);
  }

  /**
   * Filters warnings by table
   */
  filterByTable(
    warnings: EdgeCaseWarning[],
    tableName: string
  ): EdgeCaseWarning[] {
    return warnings.filter((w) => w.table === tableName);
  }
}
