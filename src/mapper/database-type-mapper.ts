/**
 * Database Type Mapper
 *
 * Maps database-specific types to Convex types for multiple database engines:
 * - PostgreSQL
 * - MySQL
 * - SQLite
 * - SQL Server (MSSQL)
 */

import type { ColumnInfo } from '../introspector/schema-introspector.js';

// ============================================================================
// Types
// ============================================================================

export type DatabaseType = 'postgresql' | 'mysql' | 'sqlite' | 'mssql';

export interface ConvexTypeMapping {
  /** Convex validator type (e.g., 'v.string()', 'v.number()') */
  validator: string;
  /** TypeScript type (e.g., 'string', 'number') */
  typescript: string;
  /** Whether type needs special transformation */
  needsTransform: boolean;
  /** Transform function name if needed */
  transformFn?: string;
}

// ============================================================================
// Type Mapping Tables
// ============================================================================

/**
 * PostgreSQL type mappings
 */
const POSTGRESQL_TYPES: Record<string, ConvexTypeMapping> = {
  // String types
  'character varying': {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  varchar: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  character: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  char: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  text: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  citext: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  uuid: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  name: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },

  // Integer types
  smallint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  integer: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  int: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  int4: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  serial: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  smallserial: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  bigint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'BigInt',
  },
  int8: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'BigInt',
  },
  bigserial: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'BigInt',
  },

  // Floating point types
  decimal: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'parseFloat',
  },
  numeric: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'parseFloat',
  },
  real: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  float4: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  'double precision': {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  float8: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  money: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'parseMoney',
  },

  // Boolean
  boolean: {
    validator: 'v.boolean()',
    typescript: 'boolean',
    needsTransform: false,
  },
  bool: {
    validator: 'v.boolean()',
    typescript: 'boolean',
    needsTransform: false,
  },

  // Date/Time (stored as numbers in Convex - Unix timestamps)
  timestamp: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  'timestamp without time zone': {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  'timestamp with time zone': {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  timestamptz: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  date: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  time: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  'time without time zone': {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  'time with time zone': {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  timetz: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  interval: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'intervalToString',
  },

  // JSON types
  json: { validator: 'v.any()', typescript: 'any', needsTransform: false },
  jsonb: { validator: 'v.any()', typescript: 'any', needsTransform: false },

  // Binary
  bytea: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },

  // Network types
  inet: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  cidr: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  macaddr: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  macaddr8: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },

  // Geometric types (store as JSON strings)
  point: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
  line: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
  lseg: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
  box: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
  path: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
  polygon: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
  circle: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },

  // Bit string types
  bit: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  'bit varying': {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  varbit: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },

  // Text search
  tsvector: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'String',
  },
  tsquery: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'String',
  },

  // Range types (store as strings)
  int4range: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'rangeToString',
  },
  int8range: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'rangeToString',
  },
  numrange: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'rangeToString',
  },
  tsrange: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'rangeToString',
  },
  tstzrange: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'rangeToString',
  },
  daterange: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'rangeToString',
  },

  // Arrays (handled separately but default to any)
  array: {
    validator: 'v.array(v.any())',
    typescript: 'any[]',
    needsTransform: false,
  },

  // XML
  xml: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'String',
  },

  // OID types
  oid: { validator: 'v.number()', typescript: 'number', needsTransform: false },

  // ═══════════════════════════════════════════════════════════════
  // POSTGRESQL EXTENSION TYPES
  // ═══════════════════════════════════════════════════════════════
  // ltree extension - hierarchical tree-like structures
  ltree: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  lquery: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  ltxtquery: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },

  // hstore extension - key-value pairs
  hstore: {
    validator: 'v.any()',
    typescript: 'Record<string, string | null>',
    needsTransform: true,
    transformFn: 'parseHstore',
  },

  // cube extension - multidimensional cubes
  cube: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'cubeToString',
  },

  // isbn extension types
  isbn: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  isbn13: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  issn: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  issn13: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },

  // Additional network types from cidr extension
  'cidr[]': {
    validator: 'v.array(v.string())',
    typescript: 'string[]',
    needsTransform: false,
  },
  'inet[]': {
    validator: 'v.array(v.string())',
    typescript: 'string[]',
    needsTransform: false,
  },
};

/**
 * MySQL type mappings
 */
const MYSQL_TYPES: Record<string, ConvexTypeMapping> = {
  // String types
  varchar: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  char: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  text: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  tinytext: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  mediumtext: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  longtext: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  enum: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  set: { validator: 'v.string()', typescript: 'string', needsTransform: false },

  // Integer types
  tinyint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  smallint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  mediumint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  int: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  integer: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  bigint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'Number',
  },

  // Floating point
  float: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  double: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  decimal: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'parseFloat',
  },
  numeric: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'parseFloat',
  },

  // Boolean (TINYINT(1) is commonly used as boolean in MySQL)
  bit: {
    validator: 'v.boolean()',
    typescript: 'boolean',
    needsTransform: true,
    transformFn: 'Boolean',
  },

  // Date/Time
  date: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  datetime: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  timestamp: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  time: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  year: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },

  // JSON
  json: { validator: 'v.any()', typescript: 'any', needsTransform: false },

  // Binary
  binary: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },
  varbinary: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },
  blob: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },
  tinyblob: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },
  mediumblob: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },
  longblob: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },

  // Spatial (store as GeoJSON strings)
  geometry: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
  point: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
  linestring: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
  polygon: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
};

/**
 * SQLite type mappings
 * Note: SQLite has dynamic typing with 5 storage classes: NULL, INTEGER, REAL, TEXT, BLOB
 */
const SQLITE_TYPES: Record<string, ConvexTypeMapping> = {
  // Integer types
  integer: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  int: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  tinyint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  smallint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  mediumint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  bigint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  int2: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  int8: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },

  // Real/Float types
  real: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  double: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  'double precision': {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  float: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  numeric: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  decimal: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },

  // Text types
  text: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  character: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  varchar: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  'varying character': {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  nchar: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  'native character': {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  nvarchar: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  clob: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },

  // Blob types
  blob: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },

  // Boolean (SQLite uses INTEGER 0/1)
  boolean: {
    validator: 'v.boolean()',
    typescript: 'boolean',
    needsTransform: true,
    transformFn: 'Boolean',
  },
  bool: {
    validator: 'v.boolean()',
    typescript: 'boolean',
    needsTransform: true,
    transformFn: 'Boolean',
  },

  // Date/Time (SQLite stores as TEXT, REAL, or INTEGER)
  date: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  datetime: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  timestamp: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },

  // JSON (stored as TEXT in SQLite)
  json: {
    validator: 'v.any()',
    typescript: 'any',
    needsTransform: true,
    transformFn: 'JSON.parse',
  },
};

/**
 * SQL Server (MSSQL) type mappings
 */
const MSSQL_TYPES: Record<string, ConvexTypeMapping> = {
  // String types
  char: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  varchar: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  text: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  nchar: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  nvarchar: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  ntext: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  xml: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'String',
  },

  // Integer types
  tinyint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  smallint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  int: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  bigint: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'Number',
  },

  // Floating point
  float: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  real: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: false,
  },
  decimal: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'parseFloat',
  },
  numeric: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'parseFloat',
  },
  money: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'parseFloat',
  },
  smallmoney: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'parseFloat',
  },

  // Boolean
  bit: {
    validator: 'v.boolean()',
    typescript: 'boolean',
    needsTransform: true,
    transformFn: 'Boolean',
  },

  // Date/Time
  date: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  time: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },
  datetime: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  datetime2: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  smalldatetime: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },
  datetimeoffset: {
    validator: 'v.number()',
    typescript: 'number',
    needsTransform: true,
    transformFn: 'toTimestamp',
  },

  // Unique identifier
  uniqueidentifier: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: false,
  },

  // Binary
  binary: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },
  varbinary: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },
  image: {
    validator: 'v.bytes()',
    typescript: 'ArrayBuffer',
    needsTransform: true,
    transformFn: 'toBytes',
  },

  // Spatial
  geometry: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },
  geography: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'JSON.stringify',
  },

  // Variant/SQL_variant
  sql_variant: {
    validator: 'v.any()',
    typescript: 'any',
    needsTransform: false,
  },

  // Hierarchyid
  hierarchyid: {
    validator: 'v.string()',
    typescript: 'string',
    needsTransform: true,
    transformFn: 'String',
  },
};

// ============================================================================
// Database Type Mapper Class
// ============================================================================

/**
 * Maps database column types to Convex types
 */
export class DatabaseTypeMapper {
  private dbType: DatabaseType;
  private typeMap: Record<string, ConvexTypeMapping>;

  constructor(dbType: DatabaseType) {
    this.dbType = dbType;
    this.typeMap = this.getTypeMap(dbType);
  }

  /**
   * Get the type mapping table for a database type
   */
  private getTypeMap(dbType: DatabaseType): Record<string, ConvexTypeMapping> {
    switch (dbType) {
      case 'postgresql':
        return POSTGRESQL_TYPES;
      case 'mysql':
        return MYSQL_TYPES;
      case 'sqlite':
        return SQLITE_TYPES;
      case 'mssql':
        return MSSQL_TYPES;
      default:
        return POSTGRESQL_TYPES;
    }
  }

  /**
   * Map a column to Convex type information
   */
  mapColumn(column: ColumnInfo): ConvexTypeMapping {
    // Clean the type name (remove size specifiers like VARCHAR(255))
    const cleanType = column.dataType.split('(')[0].toLowerCase().trim();

    // Handle MySQL TINYINT(1) as boolean
    if (this.dbType === 'mysql' && cleanType === 'tinyint') {
      const match = column.dataType.match(/tinyint\(1\)/i);
      if (match) {
        return {
          validator: 'v.boolean()',
          typescript: 'boolean',
          needsTransform: true,
          transformFn: 'Boolean',
        };
      }
    }

    // Handle array types (PostgreSQL)
    if (
      column.dataType.includes('[]') ||
      column.dataType.toLowerCase().startsWith('array')
    ) {
      const baseType = cleanType.replace('[]', '').replace('array', '').trim();
      const baseMapping = this.typeMap[baseType] || {
        validator: 'v.any()',
        typescript: 'any',
        needsTransform: false,
      };
      return {
        validator: `v.array(${baseMapping.validator})`,
        typescript: `${baseMapping.typescript}[]`,
        needsTransform: baseMapping.needsTransform,
        transformFn: baseMapping.transformFn,
      };
    }

    // Look up the type
    const mapping = this.typeMap[cleanType];
    if (mapping) {
      return { ...mapping };
    }

    // Check for partial matches (e.g., "character varying" matches "varchar")
    for (const [key, value] of Object.entries(this.typeMap)) {
      if (cleanType.includes(key) || key.includes(cleanType)) {
        return { ...value };
      }
    }

    // Default fallback
    return {
      validator: 'v.string()',
      typescript: 'string',
      needsTransform: true,
      transformFn: 'String',
    };
  }

  /**
   * Get Convex validator string for a column
   */
  getValidator(column: ColumnInfo): string {
    const mapping = this.mapColumn(column);
    let validator = mapping.validator;

    // Handle nullable columns
    if (column.isNullable) {
      validator = `v.optional(${validator})`;
    }

    return validator;
  }

  /**
   * Get TypeScript type for a column
   */
  getTypeScriptType(column: ColumnInfo): string {
    const mapping = this.mapColumn(column);
    let tsType = mapping.typescript;

    if (column.isNullable) {
      tsType = `${tsType} | null`;
    }

    return tsType;
  }

  /**
   * Check if a column value needs transformation before insertion
   */
  needsTransform(column: ColumnInfo): boolean {
    return this.mapColumn(column).needsTransform;
  }

  /**
   * Get transform function name for a column
   */
  getTransformFn(column: ColumnInfo): string | undefined {
    return this.mapColumn(column).transformFn;
  }

  /**
   * Get the database type this mapper is configured for
   */
  getDatabaseType(): DatabaseType {
    return this.dbType;
  }
}

/**
 * Create a type mapper for the specified database type
 */
export function createTypeMapper(dbType: DatabaseType): DatabaseTypeMapper {
  return new DatabaseTypeMapper(dbType);
}

export default DatabaseTypeMapper;
