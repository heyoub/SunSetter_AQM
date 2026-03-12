/**
 * Index Suggestion Generator
 *
 * Analyzes PostgreSQL indexes and generates optimized Convex index suggestions.
 * Convex has different indexing characteristics than PostgreSQL:
 * - No expression indexes (use base columns)
 * - No partial indexes (filter in queries)
 * - Composite indexes work differently (order matters for queries)
 */

import type { TableInfo } from '../introspector/schema-introspector.js';
import { toCamelCase } from '../utils/naming.js';

export interface ConvexIndexSuggestion {
  /** Suggested index name (camelCase) */
  indexName: string;
  /** Column(s) to index */
  columns: string[];
  /** Whether this should be unique */
  isUnique: boolean;
  /** Priority: high, medium, low */
  priority: 'high' | 'medium' | 'low';
  /** Reason for suggestion */
  reason: string;
  /** Original PostgreSQL index (if converted) */
  sourceIndex?: string;
  /** Warning if there are caveats */
  warning?: string;
}

/**
 * Generate Convex index suggestions from PostgreSQL indexes
 */
export function generateConvexIndexSuggestions(
  table: TableInfo
): ConvexIndexSuggestion[] {
  const suggestions: ConvexIndexSuggestion[] = [];
  const processedColumns = new Set<string>();

  // 1. Process existing PostgreSQL indexes
  for (const index of table.indexes) {
    // Skip expression indexes (not supported in Convex)
    if (index.isExpression) {
      suggestions.push({
        indexName: toCamelCase(index.indexName),
        columns: [],
        isUnique: false,
        priority: 'low',
        reason: 'Expression index - not supported in Convex',
        sourceIndex: index.indexName,
        warning:
          'Expression indexes are not supported. Consider indexing the base column(s) used in the expression.',
      });
      continue;
    }

    // Skip partial indexes (not supported in Convex)
    if (index.isPartial) {
      const baseColumns = index.columns
        .filter((c) => !c.isExpression)
        .map((c) => c.columnName);

      if (baseColumns.length > 0) {
        suggestions.push({
          indexName: toCamelCase(index.indexName),
          columns: baseColumns,
          isUnique: false,
          priority: 'medium',
          reason: 'Converted from partial index (WHERE clause removed)',
          sourceIndex: index.indexName,
          warning: `Original index had WHERE clause: ${index.partialPredicate}. Filter in your queries instead.`,
        });
        baseColumns.forEach((col) => processedColumns.add(col));
      }
      continue;
    }

    // Regular index
    const indexColumns = index.columns
      .filter((c) => !c.isExpression)
      .map((c) => c.columnName);

    if (indexColumns.length > 0) {
      // Determine priority based on index characteristics
      let priority: 'high' | 'medium' | 'low' = 'medium';
      let reason = `Converted from PostgreSQL ${index.indexMethod.toUpperCase()} index`;

      // High priority for unique indexes
      if (index.isUnique) {
        priority = 'high';
        reason = 'Unique constraint - critical for data integrity';
      }

      // High priority for btree single-column indexes (most common query pattern)
      if (index.indexMethod === 'btree' && indexColumns.length === 1) {
        priority = 'high';
        reason =
          'Single-column B-tree index - optimal for equality and range queries';
      }

      // Medium priority for composite indexes
      if (indexColumns.length > 1) {
        priority = 'medium';
        reason = `Composite index on ${indexColumns.length} columns - useful for multi-field queries`;
      }

      // Low priority for hash indexes (Convex doesn't distinguish index types)
      if (index.indexMethod === 'hash') {
        priority = 'low';
        reason =
          'Hash index - Convex uses B-tree style indexes for all queries';
      }

      // Special handling for GIN/GiST indexes (typically for full-text or geometric data)
      if (index.indexMethod === 'gin' || index.indexMethod === 'gist') {
        priority = 'low';
        reason = `${index.indexMethod.toUpperCase()} index - specialized PostgreSQL feature`;
        suggestions.push({
          indexName: toCamelCase(index.indexName),
          columns: indexColumns,
          isUnique: false,
          priority,
          reason,
          sourceIndex: index.indexName,
          warning: `${index.indexMethod.toUpperCase()} indexes are not supported. Consider Convex search indexes for full-text search.`,
        });
        indexColumns.forEach((col) => processedColumns.add(col));
        continue;
      }

      suggestions.push({
        indexName: toCamelCase(index.indexName),
        columns: indexColumns,
        isUnique: index.isUnique,
        priority,
        reason,
        sourceIndex: index.indexName,
      });

      indexColumns.forEach((col) => processedColumns.add(col));
    }
  }

  // 2. Suggest indexes for foreign keys (if not already indexed)
  for (const fk of table.foreignKeys) {
    if (!processedColumns.has(fk.columnName)) {
      suggestions.push({
        indexName: toCamelCase(`idx_${table.tableName}_${fk.columnName}`),
        columns: [fk.columnName],
        isUnique: false,
        priority: 'high',
        reason: `Foreign key to ${fk.referencedTable} - essential for relationship queries`,
      });
      processedColumns.add(fk.columnName);
    }
  }

  // 3. Suggest indexes for commonly queried columns (heuristics)
  for (const column of table.columns) {
    if (processedColumns.has(column.columnName)) continue;

    // Timestamp columns (created_at, updated_at, etc.) - very common in queries
    if (
      column.columnName.match(/created_at|updated_at|timestamp|date/i) &&
      (column.dataType.includes('timestamp') ||
        column.dataType.includes('date'))
    ) {
      suggestions.push({
        indexName: toCamelCase(`idx_${table.tableName}_${column.columnName}`),
        columns: [column.columnName],
        isUnique: false,
        priority: 'medium',
        reason: 'Timestamp column - commonly used for sorting and filtering',
      });
      processedColumns.add(column.columnName);
    }

    // Email columns (frequently used for lookups)
    if (column.columnName.match(/email/i) && column.dataType.includes('text')) {
      suggestions.push({
        indexName: toCamelCase(`idx_${table.tableName}_${column.columnName}`),
        columns: [column.columnName],
        isUnique: false,
        priority: 'high',
        reason: 'Email column - frequently used for user lookups',
      });
      processedColumns.add(column.columnName);
    }

    // Status/type enum columns (common filters)
    if (
      column.columnName.match(/status|type|state|category/i) &&
      column.dataType.toUpperCase() === 'USER-DEFINED'
    ) {
      suggestions.push({
        indexName: toCamelCase(`idx_${table.tableName}_${column.columnName}`),
        columns: [column.columnName],
        isUnique: false,
        priority: 'medium',
        reason: 'Status/type enum - commonly used for filtering',
      });
      processedColumns.add(column.columnName);
    }
  }

  return suggestions;
}

/**
 * Format index suggestions for display
 */
export function formatIndexSuggestions(
  suggestions: ConvexIndexSuggestion[]
): string {
  if (suggestions.length === 0) {
    return 'No index suggestions.';
  }

  const lines: string[] = ['Convex Index Suggestions:', ''];

  // Group by priority
  const high = suggestions.filter((s) => s.priority === 'high');
  const medium = suggestions.filter((s) => s.priority === 'medium');
  const low = suggestions.filter((s) => s.priority === 'low');

  if (high.length > 0) {
    lines.push('  HIGH PRIORITY:');
    for (const s of high) {
      const unique = s.isUnique ? ' (UNIQUE)' : '';
      const cols = s.columns.join(', ');
      lines.push(`    - ${s.indexName}${unique}: [${cols}]`);
      lines.push(`      Reason: ${s.reason}`);
      if (s.warning) {
        lines.push(`      Warning: ${s.warning}`);
      }
    }
    lines.push('');
  }

  if (medium.length > 0) {
    lines.push('  MEDIUM PRIORITY:');
    for (const s of medium) {
      const unique = s.isUnique ? ' (UNIQUE)' : '';
      const cols = s.columns.join(', ');
      lines.push(`    - ${s.indexName}${unique}: [${cols}]`);
      lines.push(`      Reason: ${s.reason}`);
      if (s.warning) {
        lines.push(`      Warning: ${s.warning}`);
      }
    }
    lines.push('');
  }

  if (low.length > 0) {
    lines.push('  LOW PRIORITY:');
    for (const s of low) {
      const unique = s.isUnique ? ' (UNIQUE)' : '';
      const cols = s.columns.join(', ') || '(none)';
      lines.push(`    - ${s.indexName}${unique}: [${cols}]`);
      lines.push(`      Reason: ${s.reason}`);
      if (s.warning) {
        lines.push(`      Warning: ${s.warning}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate Convex schema code for suggested indexes
 */
export function generateConvexIndexCode(
  suggestions: ConvexIndexSuggestion[],
  tableName: string
): string {
  const validSuggestions = suggestions.filter(
    (s) => s.columns.length > 0 && !s.warning?.includes('not supported')
  );

  if (validSuggestions.length === 0) {
    return '// No indexes to generate';
  }

  const lines: string[] = [
    `// Suggested indexes for ${tableName}`,
    `export default defineTable({`,
    `  // ... your fields here`,
    `})`,
  ];

  for (const suggestion of validSuggestions) {
    const columnsArray = suggestion.columns.map((c) => `"${c}"`).join(', ');
    lines.push(
      `  .index("${suggestion.indexName}", [${columnsArray}]) // ${suggestion.reason}`
    );
  }

  lines.push(';');

  return lines.join('\n');
}

