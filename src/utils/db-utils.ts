/**
 * Valid SQL value types that can be safely used in queries
 */
export type SqlValue = string | number | boolean | Date | null | undefined;

export function sanitizeTableName(tableName: string): string {
  return tableName.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function sanitizeColumnName(columnName: string): string {
  return columnName.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function toPascalCase(str: string): string {
  const camelCase = toCamelCase(str);
  return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
}

export function toKebabCase(str: string): string {
  return str.replace(/_/g, '-').toLowerCase();
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/^_/, '');
}

export function pluralize(word: string): string {
  if (word.endsWith('y')) {
    return word.slice(0, -1) + 'ies';
  }
  if (
    word.endsWith('s') ||
    word.endsWith('sh') ||
    word.endsWith('ch') ||
    word.endsWith('x') ||
    word.endsWith('z')
  ) {
    return word + 'es';
  }
  return word + 's';
}

export function singularize(word: string): string {
  if (word.endsWith('ies')) {
    return word.slice(0, -3) + 'y';
  }
  if (word.endsWith('es')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

export function generateTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1);
}

export function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

export function escapeIdentifier(name: string): string {
  if (isValidIdentifier(name)) {
    return name;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export function formatSqlValue(value: SqlValue): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  return String(value);
}

export function buildWhereClause(criteria: Record<string, SqlValue>): {
  clause: string;
  values: SqlValue[];
} {
  const entries = Object.entries(criteria).filter(
    ([_, value]) => value !== undefined
  );

  if (entries.length === 0) {
    return { clause: '', values: [] };
  }

  const conditions = entries.map(
    ([key], index) => `${escapeIdentifier(key)} = $${index + 1}`
  );
  const clause = `WHERE ${conditions.join(' AND ')}`;
  const values = entries.map(([_, value]) => value);

  return { clause, values };
}

export function buildInsertQuery(
  tableName: string,
  data: Record<string, SqlValue>
): { query: string; values: SqlValue[] } {
  const columns = Object.keys(data);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const values = Object.values(data);

  const query = `
    INSERT INTO ${escapeIdentifier(tableName)} (${columns.map(escapeIdentifier).join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `;

  return { query, values };
}

export function buildUpdateQuery(
  tableName: string,
  data: Record<string, SqlValue>,
  whereClause: string,
  whereValues: SqlValue[]
): { query: string; values: SqlValue[] } {
  const entries = Object.entries(data).filter(
    ([_, value]) => value !== undefined
  );
  const setClause = entries.map(
    ([key], index) =>
      `${escapeIdentifier(key)} = $${index + whereValues.length + 1}`
  );
  const values = [...whereValues, ...entries.map(([_, value]) => value)];

  const query = `
    UPDATE ${escapeIdentifier(tableName)}
    SET ${setClause.join(', ')}
    ${whereClause}
    RETURNING *
  `;

  return { query, values };
}

export function buildSelectQuery(
  tableName: string,
  columns: string[] = ['*'],
  whereClause: string = '',
  orderBy: string = '',
  limit?: number,
  offset?: number
): string {
  const selectColumns = columns
    .map((col) => (col === '*' ? '*' : escapeIdentifier(col)))
    .join(', ');

  let query = `SELECT ${selectColumns} FROM ${escapeIdentifier(tableName)}`;

  if (whereClause) {
    query += ` ${whereClause}`;
  }

  if (orderBy) {
    query += ` ORDER BY ${orderBy}`;
  }

  if (limit !== undefined) {
    query += ` LIMIT ${limit}`;
  }

  if (offset !== undefined) {
    query += ` OFFSET ${offset}`;
  }

  return query;
}
