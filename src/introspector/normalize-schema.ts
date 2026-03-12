import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexColumnInfo,
  IndexInfo,
  TableInfo,
} from './schema-introspector.js';

function mergeColumns(existing: ColumnInfo, incoming: ColumnInfo): ColumnInfo {
  return {
    ...existing,
    dataType:
      existing.dataType === 'USER-DEFINED'
        ? incoming.dataType
        : existing.dataType,
    columnDefault: existing.columnDefault ?? incoming.columnDefault,
    characterMaximumLength:
      existing.characterMaximumLength ?? incoming.characterMaximumLength,
    numericPrecision: existing.numericPrecision ?? incoming.numericPrecision,
    numericScale: existing.numericScale ?? incoming.numericScale,
    ordinalPosition: Math.min(
      existing.ordinalPosition,
      incoming.ordinalPosition
    ),
    isIdentity: existing.isIdentity || incoming.isIdentity,
    isPrimaryKey: existing.isPrimaryKey || incoming.isPrimaryKey,
    isForeignKey: existing.isForeignKey || incoming.isForeignKey,
    foreignKeyTable: existing.foreignKeyTable ?? incoming.foreignKeyTable,
    foreignKeyColumn: existing.foreignKeyColumn ?? incoming.foreignKeyColumn,
    description: existing.description ?? incoming.description,
    isGenerated: existing.isGenerated || incoming.isGenerated,
    generationExpression:
      existing.generationExpression ?? incoming.generationExpression,
    generationType: existing.generationType ?? incoming.generationType,
    domainName: existing.domainName ?? incoming.domainName,
    domainBaseType: existing.domainBaseType ?? incoming.domainBaseType,
  };
}

function dedupeColumns(columns: ColumnInfo[]): ColumnInfo[] {
  const deduped = new Map<string, ColumnInfo>();

  for (const column of columns) {
    const existing = deduped.get(column.columnName);
    deduped.set(
      column.columnName,
      existing ? mergeColumns(existing, column) : { ...column }
    );
  }

  return Array.from(deduped.values()).sort(
    (left, right) => left.ordinalPosition - right.ordinalPosition
  );
}

function dedupeForeignKeys(foreignKeys: ForeignKeyInfo[]): ForeignKeyInfo[] {
  const deduped = new Map<string, ForeignKeyInfo>();

  for (const foreignKey of foreignKeys) {
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

function dedupeIndexColumns(columns: IndexColumnInfo[]): IndexColumnInfo[] {
  const deduped = new Map<string, IndexColumnInfo>();

  for (const column of columns) {
    const key = `${column.ordinalPosition}|${column.columnName}|${column.expression ?? ''}`;
    if (!deduped.has(key)) {
      deduped.set(key, { ...column });
    }
  }

  return Array.from(deduped.values()).sort(
    (left, right) => left.ordinalPosition - right.ordinalPosition
  );
}

function dedupeIndexes(indexes: IndexInfo[]): IndexInfo[] {
  const deduped = new Map<string, IndexInfo>();

  for (const index of indexes) {
    const columns = dedupeIndexColumns(index.columns);
    const key = [
      index.indexName,
      index.columnName,
      index.isUnique ? 'unique' : 'nonunique',
      index.isExpression ? 'expression' : 'simple',
      index.indexMethod,
      index.partialPredicate ?? '',
      columns.map((column) => column.columnName).join(','),
    ].join('|');

    if (!deduped.has(key)) {
      deduped.set(key, {
        ...index,
        columns,
        columnName: columns[0]?.columnName ?? index.columnName,
      });
    }
  }

  return Array.from(deduped.values());
}

export function normalizeTableInfo(table: TableInfo): TableInfo {
  return {
    ...table,
    columns: dedupeColumns(table.columns),
    foreignKeys: dedupeForeignKeys(table.foreignKeys),
    indexes: dedupeIndexes(table.indexes),
  };
}

export function normalizeTables(tables: TableInfo[]): TableInfo[] {
  return tables.map((table) => normalizeTableInfo(table));
}
