/**
 * Canonical name-conversion and identifier utilities.
 *
 * This is the SINGLE SOURCE OF TRUTH for all case-conversion,
 * reserved-word escaping, and identifier validation in the codebase.
 * Every module must import from here — no private reimplementations.
 *
 * @module utils/naming
 */

// ============================================================================
// Case Conversion
// ============================================================================

/**
 * Convert snake_case to camelCase.
 * Preserves leading underscores (e.g. `__foo_bar` → `__fooBar`).
 * Handles consecutive underscores and numeric segments.
 */
export function toCamelCase(str: string): string {
  const leadingUnderscores = str.match(/^_+/)?.[0] || '';
  const rest = str.slice(leadingUnderscores.length);

  const camelCase = rest
    .toLowerCase()
    .replace(/_+([a-z0-9])/g, (_, char) => char.toUpperCase());

  return leadingUnderscores + camelCase;
}

/**
 * Convert snake_case to PascalCase.
 * Preserves leading underscores.
 */
export function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Convert snake_case to kebab-case.
 */
export function toKebabCase(str: string): string {
  return str.replace(/_/g, '-').toLowerCase();
}

/**
 * Convert camelCase or PascalCase to snake_case.
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/^_/, '');
}

// ============================================================================
// Reserved Words & Identifier Validation
// ============================================================================

/**
 * JavaScript/TypeScript reserved words that need escaping in generated code.
 */
export const JS_RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'finally',
  'for',
  'function',
  'if',
  'in',
  'instanceof',
  'new',
  'return',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'class',
  'const',
  'enum',
  'export',
  'extends',
  'import',
  'super',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'yield',
  'await',
  'async',
]);

/**
 * Convex reserved field names that must not be used as column names.
 */
export const CONVEX_RESERVED_FIELDS = new Set(['_id', '_creationTime']);

/**
 * Check if a name is a JS reserved word or Convex reserved field.
 */
export function isReservedWord(name: string): boolean {
  return JS_RESERVED_WORDS.has(name) || CONVEX_RESERVED_FIELDS.has(name);
}

/**
 * Append `_` suffix to reserved words so they become valid field names.
 */
export function escapeFieldName(name: string): string {
  if (isReservedWord(name)) {
    return `${name}_`;
  }
  return name;
}

/**
 * Escape a string for safe embedding in generated code literals.
 */
export function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Check if a string is a valid JavaScript identifier.
 */
export function isValidIdentifier(str: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(str);
}

/**
 * Coerce an arbitrary string into a valid JavaScript identifier.
 */
export function toValidIdentifier(str: string): string {
  let result = str.replace(/[^a-zA-Z0-9_$]/g, '_');

  if (/^[0-9]/.test(result)) {
    result = '_' + result;
  }

  return escapeFieldName(result);
}

// ============================================================================
// Table / Column Name Sanitization
// ============================================================================

/**
 * Strip non-alphanumeric characters (except underscore) from a table name.
 */
export function sanitizeTableName(tableName: string): string {
  return tableName.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Strip non-alphanumeric characters (except underscore) from a column name.
 */
export function sanitizeColumnName(columnName: string): string {
  return columnName.replace(/[^a-zA-Z0-9_]/g, '_');
}
