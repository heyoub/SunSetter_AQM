/**
 * Unified Type Mapper
 *
 * Canonical type mapper that merges all type mapping capabilities:
 * - Multi-DB support (PostgreSQL, MySQL, SQLite, MSSQL)
 * - Rich PostgreSQL Convex validator output (PostGIS/GeoJSON, FK->v.id(), enums, v.nullable(), custom mappings)
 * - Transform metadata (needsTransform, transformFn)
 * - TypeScript interface/type generation
 *
 * Replaces:
 *   - src/mapper/type-mapper.ts (original PG-only TS interface generator)
 *   - src/mapper/database-type-mapper.ts (multi-DB Convex validator + transform metadata)
 *   - src/convex/convex-type-mapper.ts (richest PG Convex validator with PostGIS/GeoJSON/FK/enums)
 */

import type { ColumnInfo } from '../introspector/schema-introspector.js';
import { toCamelCase, toPascalCase, escapeFieldName } from '../utils/naming.js';
import type {
  ConvexFieldMapping,
  ConvexTypeMapperOptions,
} from '../convex/types.js';

// ============================================================================
// Exported Types (from original type-mapper.ts + database-type-mapper.ts)
// ============================================================================

export type DatabaseType = 'postgresql' | 'mysql' | 'sqlite' | 'mssql';

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
// Unified constructor options
// ============================================================================

export interface TypeMapperOptions {
  dbType?: DatabaseType;
  typeMapping?: Partial<TypeMappingOptions>;
  convex?: Partial<ConvexTypeMapperOptions>;
}

// ============================================================================
// PostgreSQL → Convex validator map (richest, from ConvexTypeMapper)
// ============================================================================

const POSTGRES_TO_CONVEX_MAP: Record<string, string> = {
  // STRING TYPES
  'character varying': 'v.string()',
  varchar: 'v.string()',
  character: 'v.string()',
  char: 'v.string()',
  text: 'v.string()',
  citext: 'v.string()',
  name: 'v.string()',

  // NUMERIC TYPES - Integer
  smallint: 'v.number()',
  int2: 'v.number()',
  integer: 'v.number()',
  int: 'v.number()',
  int4: 'v.number()',
  serial: 'v.number()',
  smallserial: 'v.number()',
  serial2: 'v.number()',
  serial4: 'v.number()',

  // Big integers (configurable)
  bigint: 'v.number()',
  int8: 'v.number()',
  bigserial: 'v.number()',
  serial8: 'v.number()',

  // NUMERIC TYPES - Floating Point
  real: 'v.number()',
  float4: 'v.number()',
  'double precision': 'v.number()',
  float8: 'v.number()',
  float: 'v.number()',
  numeric: 'v.number()',
  decimal: 'v.number()',
  money: 'v.number()',

  // BOOLEAN TYPE
  boolean: 'v.boolean()',
  bool: 'v.boolean()',

  // DATE/TIME TYPES -> Store as numbers (Unix timestamps in ms)
  timestamp: 'v.number()',
  'timestamp without time zone': 'v.number()',
  'timestamp with time zone': 'v.number()',
  timestamptz: 'v.number()',
  date: 'v.number()',
  time: 'v.string()',
  'time without time zone': 'v.string()',
  'time with time zone': 'v.string()',
  timetz: 'v.string()',
  interval: 'v.string()',

  // UUID TYPE
  uuid: 'v.string()',

  // JSON TYPES
  json: 'v.any()',
  jsonb: 'v.any()',

  // VECTOR TYPES
  vector: 'v.array(v.float64())',

  // BINARY DATA -> Convex File Storage
  bytea: 'v.id("_storage")',
  blob: 'v.id("_storage")',
  tinyblob: 'v.id("_storage")',
  mediumblob: 'v.id("_storage")',
  longblob: 'v.id("_storage")',
  binary: 'v.id("_storage")',
  varbinary: 'v.id("_storage")',
  image: 'v.id("_storage")',

  // NETWORK ADDRESS TYPES
  inet: 'v.string()',
  cidr: 'v.string()',
  macaddr: 'v.string()',
  macaddr8: 'v.string()',

  // GEOMETRIC TYPES
  point: 'v.object({ x: v.number(), y: v.number() })',
  line: 'v.string()',
  lseg: 'v.object({ start: v.object({ x: v.number(), y: v.number() }), end: v.object({ x: v.number(), y: v.number() }) })',
  box: 'v.object({ topRight: v.object({ x: v.number(), y: v.number() }), bottomLeft: v.object({ x: v.number(), y: v.number() }) })',
  path: 'v.array(v.object({ x: v.number(), y: v.number() }))',
  polygon: 'v.array(v.object({ x: v.number(), y: v.number() }))',
  circle:
    'v.object({ center: v.object({ x: v.number(), y: v.number() }), radius: v.number() })',

  // BIT STRING TYPES
  bit: 'v.string()',
  'bit varying': 'v.string()',
  varbit: 'v.string()',

  // TEXT SEARCH TYPES
  tsvector: 'v.string()',
  tsquery: 'v.string()',

  // RANGE TYPES
  int4range:
    'v.object({ lower: v.optional(v.number()), upper: v.optional(v.number()), lowerInclusive: v.boolean(), upperInclusive: v.boolean() })',
  int8range:
    'v.object({ lower: v.optional(v.number()), upper: v.optional(v.number()), lowerInclusive: v.boolean(), upperInclusive: v.boolean() })',
  numrange:
    'v.object({ lower: v.optional(v.number()), upper: v.optional(v.number()), lowerInclusive: v.boolean(), upperInclusive: v.boolean() })',
  tsrange:
    'v.object({ lower: v.optional(v.number()), upper: v.optional(v.number()), lowerInclusive: v.boolean(), upperInclusive: v.boolean() })',
  tstzrange:
    'v.object({ lower: v.optional(v.number()), upper: v.optional(v.number()), lowerInclusive: v.boolean(), upperInclusive: v.boolean() })',
  daterange:
    'v.object({ lower: v.optional(v.number()), upper: v.optional(v.number()), lowerInclusive: v.boolean(), upperInclusive: v.boolean() })',

  // OBJECT IDENTIFIER TYPES (PostgreSQL internals)
  oid: 'v.number()',
  regproc: 'v.string()',
  regprocedure: 'v.string()',
  regoper: 'v.string()',
  regoperator: 'v.string()',
  regclass: 'v.string()',
  regtype: 'v.string()',
  regrole: 'v.string()',
  regnamespace: 'v.string()',
  regconfig: 'v.string()',
  regdictionary: 'v.string()',

  // XML TYPE
  xml: 'v.string()',

  // SPECIAL TYPES
  pg_lsn: 'v.string()',
  pg_snapshot: 'v.string()',
  txid_snapshot: 'v.string()',

  // POSTGIS TYPES - Stored as GeoJSON format
  geometry:
    'v.object({ type: v.string(), coordinates: v.any(), crs: v.optional(v.object({ type: v.string(), properties: v.any() })) })',
  geography:
    'v.object({ type: v.string(), coordinates: v.any(), crs: v.optional(v.object({ type: v.string(), properties: v.any() })) })',

  // Specific geometry subtypes (PostGIS)
  'geometry(point)':
    'v.object({ type: v.literal("Point"), coordinates: v.array(v.number()) })',
  'geometry(point,4326)':
    'v.object({ type: v.literal("Point"), coordinates: v.array(v.number()) })',
  'geometry(linestring)':
    'v.object({ type: v.literal("LineString"), coordinates: v.array(v.array(v.number())) })',
  'geometry(linestring,4326)':
    'v.object({ type: v.literal("LineString"), coordinates: v.array(v.array(v.number())) })',
  'geometry(polygon)':
    'v.object({ type: v.literal("Polygon"), coordinates: v.array(v.array(v.array(v.number()))) })',
  'geometry(polygon,4326)':
    'v.object({ type: v.literal("Polygon"), coordinates: v.array(v.array(v.array(v.number()))) })',
  'geometry(multipoint)':
    'v.object({ type: v.literal("MultiPoint"), coordinates: v.array(v.array(v.number())) })',
  'geometry(multipoint,4326)':
    'v.object({ type: v.literal("MultiPoint"), coordinates: v.array(v.array(v.number())) })',
  'geometry(multilinestring)':
    'v.object({ type: v.literal("MultiLineString"), coordinates: v.array(v.array(v.array(v.number()))) })',
  'geometry(multilinestring,4326)':
    'v.object({ type: v.literal("MultiLineString"), coordinates: v.array(v.array(v.array(v.number()))) })',
  'geometry(multipolygon)':
    'v.object({ type: v.literal("MultiPolygon"), coordinates: v.array(v.array(v.array(v.array(v.number())))) })',
  'geometry(multipolygon,4326)':
    'v.object({ type: v.literal("MultiPolygon"), coordinates: v.array(v.array(v.array(v.array(v.number())))) })',
  'geometry(geometrycollection)':
    'v.object({ type: v.literal("GeometryCollection"), geometries: v.array(v.object({ type: v.string(), coordinates: v.any() })) })',
  'geometry(geometrycollection,4326)':
    'v.object({ type: v.literal("GeometryCollection"), geometries: v.array(v.object({ type: v.string(), coordinates: v.any() })) })',

  // Geography subtypes (PostGIS - for geodetic calculations)
  'geography(point)':
    'v.object({ type: v.literal("Point"), coordinates: v.array(v.number()) })',
  'geography(point,4326)':
    'v.object({ type: v.literal("Point"), coordinates: v.array(v.number()) })',
  'geography(linestring)':
    'v.object({ type: v.literal("LineString"), coordinates: v.array(v.array(v.number())) })',
  'geography(linestring,4326)':
    'v.object({ type: v.literal("LineString"), coordinates: v.array(v.array(v.number())) })',
  'geography(polygon)':
    'v.object({ type: v.literal("Polygon"), coordinates: v.array(v.array(v.array(v.number()))) })',
  'geography(polygon,4326)':
    'v.object({ type: v.literal("Polygon"), coordinates: v.array(v.array(v.array(v.number()))) })',
  'geography(multipoint)':
    'v.object({ type: v.literal("MultiPoint"), coordinates: v.array(v.array(v.number())) })',
  'geography(multipoint,4326)':
    'v.object({ type: v.literal("MultiPoint"), coordinates: v.array(v.array(v.number())) })',
  'geography(multilinestring)':
    'v.object({ type: v.literal("MultiLineString"), coordinates: v.array(v.array(v.array(v.number()))) })',
  'geography(multilinestring,4326)':
    'v.object({ type: v.literal("MultiLineString"), coordinates: v.array(v.array(v.array(v.number()))) })',
  'geography(multipolygon)':
    'v.object({ type: v.literal("MultiPolygon"), coordinates: v.array(v.array(v.array(v.array(v.number())))) })',
  'geography(multipolygon,4326)':
    'v.object({ type: v.literal("MultiPolygon"), coordinates: v.array(v.array(v.array(v.array(v.number())))) })',
  'geography(geometrycollection)':
    'v.object({ type: v.literal("GeometryCollection"), geometries: v.array(v.object({ type: v.string(), coordinates: v.any() })) })',
  'geography(geometrycollection,4326)':
    'v.object({ type: v.literal("GeometryCollection"), geometries: v.array(v.object({ type: v.string(), coordinates: v.any() })) })',

  // Raster type (PostGIS Raster)
  raster:
    'v.object({ width: v.number(), height: v.number(), bands: v.array(v.any()), metadata: v.optional(v.any()) })',

  // Box types (PostGIS)
  box2d:
    'v.object({ xmin: v.number(), ymin: v.number(), xmax: v.number(), ymax: v.number() })',
  box3d:
    'v.object({ xmin: v.number(), ymin: v.number(), zmin: v.number(), xmax: v.number(), ymax: v.number(), zmax: v.number() })',

  // POSTGRESQL EXTENSION TYPES
  ltree: 'v.string()',
  lquery: 'v.string()',
  ltxtquery: 'v.string()',
  hstore: 'v.any()',
  cube: 'v.string()',
  isbn: 'v.string()',
  isbn13: 'v.string()',
  issn: 'v.string()',
  issn13: 'v.string()',
  earth: 'v.string()',
  seg: 'v.string()',
  _int4: 'v.array(v.number())',

  // USER-DEFINED (handled separately)
  'user-defined': 'v.any()',
};

// ============================================================================
// Multi-DB Convex type mapping tables (from DatabaseTypeMapper)
// Used only for transform metadata (needsTransform / transformFn)
// ============================================================================

const POSTGRESQL_TRANSFORM: Record<string, ConvexTypeMapping> = {
  'character varying': { validator: 'v.string()', typescript: 'string', needsTransform: false },
  varchar: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  character: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  char: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  text: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  citext: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  uuid: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  name: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  smallint: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  integer: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  int: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  int4: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  serial: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  smallserial: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  bigint: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'BigInt' },
  int8: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'BigInt' },
  bigserial: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'BigInt' },
  decimal: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'parseFloat' },
  numeric: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'parseFloat' },
  real: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  float4: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  'double precision': { validator: 'v.number()', typescript: 'number', needsTransform: false },
  float8: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  money: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'parseMoney' },
  boolean: { validator: 'v.boolean()', typescript: 'boolean', needsTransform: false },
  bool: { validator: 'v.boolean()', typescript: 'boolean', needsTransform: false },
  timestamp: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  'timestamp without time zone': { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  'timestamp with time zone': { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  timestamptz: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  date: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  time: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  'time without time zone': { validator: 'v.string()', typescript: 'string', needsTransform: false },
  'time with time zone': { validator: 'v.string()', typescript: 'string', needsTransform: false },
  timetz: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  interval: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'intervalToString' },
  json: { validator: 'v.any()', typescript: 'any', needsTransform: false },
  jsonb: { validator: 'v.any()', typescript: 'any', needsTransform: false },
  vector: { validator: 'v.array(v.float64())', typescript: 'number[]', needsTransform: true, transformFn: 'parseVector' },
  bytea: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  inet: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  cidr: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  macaddr: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  macaddr8: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  point: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  line: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  lseg: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  box: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  path: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  polygon: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  circle: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  bit: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  'bit varying': { validator: 'v.string()', typescript: 'string', needsTransform: false },
  varbit: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  tsvector: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'String' },
  tsquery: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'String' },
  int4range: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'rangeToString' },
  int8range: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'rangeToString' },
  numrange: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'rangeToString' },
  tsrange: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'rangeToString' },
  tstzrange: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'rangeToString' },
  daterange: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'rangeToString' },
  array: { validator: 'v.array(v.any())', typescript: 'any[]', needsTransform: false },
  xml: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'String' },
  oid: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  ltree: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  lquery: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  ltxtquery: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  hstore: { validator: 'v.any()', typescript: 'Record<string, string | null>', needsTransform: true, transformFn: 'parseHstore' },
  cube: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'cubeToString' },
  isbn: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  isbn13: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  issn: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  issn13: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  'cidr[]': { validator: 'v.array(v.string())', typescript: 'string[]', needsTransform: false },
  'inet[]': { validator: 'v.array(v.string())', typescript: 'string[]', needsTransform: false },
};

const MYSQL_TYPES: Record<string, ConvexTypeMapping> = {
  varchar: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  char: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  text: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  tinytext: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  mediumtext: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  longtext: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  enum: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  set: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  tinyint: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  smallint: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  mediumint: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  int: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  integer: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  bigint: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'Number' },
  float: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  double: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  decimal: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'parseFloat' },
  numeric: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'parseFloat' },
  bit: { validator: 'v.boolean()', typescript: 'boolean', needsTransform: true, transformFn: 'Boolean' },
  date: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  datetime: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  timestamp: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  time: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  year: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  json: { validator: 'v.any()', typescript: 'any', needsTransform: false },
  binary: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  varbinary: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  blob: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  tinyblob: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  mediumblob: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  longblob: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  geometry: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  point: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  linestring: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  polygon: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
};

const SQLITE_TYPES: Record<string, ConvexTypeMapping> = {
  integer: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  int: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  tinyint: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  smallint: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  mediumint: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  bigint: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  int2: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  int8: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  real: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  double: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  'double precision': { validator: 'v.number()', typescript: 'number', needsTransform: false },
  float: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  numeric: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  decimal: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  text: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  character: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  varchar: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  'varying character': { validator: 'v.string()', typescript: 'string', needsTransform: false },
  nchar: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  'native character': { validator: 'v.string()', typescript: 'string', needsTransform: false },
  nvarchar: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  clob: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  blob: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  boolean: { validator: 'v.boolean()', typescript: 'boolean', needsTransform: true, transformFn: 'Boolean' },
  bool: { validator: 'v.boolean()', typescript: 'boolean', needsTransform: true, transformFn: 'Boolean' },
  date: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  datetime: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  timestamp: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  json: { validator: 'v.any()', typescript: 'any', needsTransform: true, transformFn: 'JSON.parse' },
};

const MSSQL_TYPES: Record<string, ConvexTypeMapping> = {
  char: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  varchar: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  text: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  nchar: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  nvarchar: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  ntext: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  xml: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'String' },
  tinyint: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  smallint: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  int: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  bigint: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'Number' },
  float: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  real: { validator: 'v.number()', typescript: 'number', needsTransform: false },
  decimal: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'parseFloat' },
  numeric: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'parseFloat' },
  money: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'parseFloat' },
  smallmoney: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'parseFloat' },
  bit: { validator: 'v.boolean()', typescript: 'boolean', needsTransform: true, transformFn: 'Boolean' },
  date: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  time: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  datetime: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  datetime2: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  smalldatetime: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  datetimeoffset: { validator: 'v.number()', typescript: 'number', needsTransform: true, transformFn: 'toTimestamp' },
  uniqueidentifier: { validator: 'v.string()', typescript: 'string', needsTransform: false },
  binary: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  varbinary: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  image: { validator: 'v.bytes()', typescript: 'ArrayBuffer', needsTransform: true, transformFn: 'toBytes' },
  geometry: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  geography: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'JSON.stringify' },
  sql_variant: { validator: 'v.any()', typescript: 'any', needsTransform: false },
  hierarchyid: { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'String' },
};

// ============================================================================
// Default options for the Convex type mapper
// ============================================================================

const DEFAULT_CONVEX_OPTIONS: ConvexTypeMapperOptions = {
  useBigInt64: false,
  useFloat64: false,
  jsonAsAny: true,
  arrayHandling: 'typed',
  unknownTypeHandling: 'string',
  customTypeMappings: {},
  preserveComments: true,
  enumMappings: {},
  useNullable: false,
};

const DEFAULT_TYPE_MAPPING_OPTIONS: TypeMappingOptions = {
  useStrict: true,
  useBigInt: true,
  useDate: true,
  useDecimal: false,
  enumAsUnion: true,
  nullableAsOptional: true,
};

// ============================================================================
// Unified TypeMapper Class
// ============================================================================

/**
 * Unified type mapper that handles:
 * 1. Multi-DB Convex validator generation (PG, MySQL, SQLite, MSSQL)
 * 2. Rich PostgreSQL Convex validators (PostGIS, GeoJSON, FK->v.id(), enums, etc.)
 * 3. Transform metadata (needsTransform, transformFn) for data migration
 * 4. TypeScript interface/type generation
 */
export class TypeMapper {
  private dbType: DatabaseType;
  private typeMappingOptions: TypeMappingOptions;
  private convexOptions: ConvexTypeMapperOptions;
  private transformMap: Record<string, ConvexTypeMapping>;

  /**
   * Constructor supports both old and new calling conventions:
   *
   * Old (backward compat): new TypeMapper({ useBigInt: false, ... })
   * New (unified):         new TypeMapper({ dbType: 'mysql', typeMapping: {...}, convex: {...} })
   */
  constructor(options?: Partial<TypeMappingOptions> | Partial<ConvexTypeMapperOptions> | TypeMapperOptions) {
    // Detect old-style constructor: if options has keys from TypeMappingOptions or ConvexTypeMapperOptions
    if (options && this.isLegacyOptions(options)) {
      this.dbType = 'postgresql';
      // Legacy options may contain TypeMappingOptions keys, ConvexTypeMapperOptions keys, or both
      this.typeMappingOptions = { ...DEFAULT_TYPE_MAPPING_OPTIONS, ...(options as Partial<TypeMappingOptions>) };
      this.convexOptions = { ...DEFAULT_CONVEX_OPTIONS, ...(options as Partial<ConvexTypeMapperOptions>) };
    } else {
      const opts = (options as TypeMapperOptions) || {};
      this.dbType = opts.dbType || 'postgresql';
      this.typeMappingOptions = { ...DEFAULT_TYPE_MAPPING_OPTIONS, ...(opts.typeMapping || {}) };
      this.convexOptions = { ...DEFAULT_CONVEX_OPTIONS, ...(opts.convex || {}) };
    }

    this.transformMap = this.getTransformMap(this.dbType);
  }

  /**
   * Detect whether options are the legacy Partial<TypeMappingOptions> format
   */
  private isLegacyOptions(options: object): boolean {
    // Keys from the old TypeMappingOptions interface
    const legacyTypeMappingKeys = new Set([
      'useStrict', 'useBigInt', 'useDate', 'useDecimal', 'enumAsUnion', 'nullableAsOptional',
    ]);
    // Keys from the old ConvexTypeMapperOptions interface (passed directly, not nested under `convex`)
    const legacyConvexKeys = new Set([
      'useBigInt64', 'useFloat64', 'jsonAsAny', 'arrayHandling', 'unknownTypeHandling',
      'customTypeMappings', 'preserveComments', 'enumMappings', 'tableNameTransformer', 'useNullable',
    ]);
    // New-style options have `dbType`, `typeMapping`, or `convex` as top-level keys
    const newStyleKeys = new Set(['dbType', 'typeMapping', 'convex']);
    const keys = Object.keys(options);
    // If any key is a new-style key, it's not legacy
    if (keys.some((key) => newStyleKeys.has(key))) return false;
    // If any key matches old TypeMappingOptions or old ConvexTypeMapperOptions, treat as legacy
    return keys.some((key) => legacyTypeMappingKeys.has(key) || legacyConvexKeys.has(key));
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1: Convex Field Mapping (from ConvexTypeMapper)
  // Used by ConvexSchemaGenerator and Convex code generation
  // ═══════════════════════════════════════════════════════════════

  /**
   * Maps a column to a Convex field mapping with full metadata.
   * (Replaces ConvexTypeMapper.mapColumn)
   */
  mapColumn(column: ColumnInfo): ConvexFieldMapping {
    const validator = this.getConvexValidator(column);
    const isOptional = column.isNullable;
    const isId = column.isForeignKey;

    // Wrap with v.optional() or v.nullable() if nullable
    let finalValidator: string;
    if (isOptional) {
      if (this.convexOptions.useNullable) {
        finalValidator = `v.nullable(${validator})`;
      } else {
        finalValidator = `v.optional(${validator})`;
      }
    } else {
      finalValidator = validator;
    }

    // Apply table name transformer to FK references
    let referencedTable: string | undefined;
    if (column.foreignKeyTable) {
      referencedTable = this.convexOptions.tableNameTransformer
        ? this.convexOptions.tableNameTransformer(column.foreignKeyTable)
        : column.foreignKeyTable;
    }

    return {
      fieldName: escapeFieldName(toCamelCase(column.columnName)),
      originalColumnName: column.columnName,
      validator: finalValidator,
      isOptional,
      isId,
      referencedTable,
      comment: this.convexOptions.preserveComments
        ? column.description || undefined
        : undefined,
      originalPgType: column.dataType,
    };
  }

  /**
   * Maps multiple columns at once.
   * (Replaces ConvexTypeMapper.mapColumns)
   */
  mapColumns(columns: ColumnInfo[]): ConvexFieldMapping[] {
    return columns.map((col) => this.mapColumn(col));
  }

  /**
   * Gets the base Convex validator (without optional wrapper).
   * Handles FK->v.id(), custom mappings, arrays, enums, PostGIS, and standard types.
   * (Replaces ConvexTypeMapper.getValidator - private)
   */
  private getConvexValidator(column: ColumnInfo): string {
    if (this.dbType !== 'postgresql') {
      // Non-PG: use transform map for validator
      return this.getNonPgValidator(column);
    }

    // PostgreSQL: use rich ConvexTypeMapper logic

    // Priority 1: Foreign key -> v.id("tableName")
    if (column.isForeignKey && column.foreignKeyTable) {
      const tableName = this.convexOptions.tableNameTransformer
        ? this.convexOptions.tableNameTransformer(column.foreignKeyTable)
        : column.foreignKeyTable;
      return `v.id("${tableName}")`;
    }

    // Priority 2: Custom type mappings
    if (this.convexOptions.customTypeMappings[column.dataType]) {
      return this.convexOptions.customTypeMappings[column.dataType];
    }

    // Priority 3: Array types
    if (this.isArrayType(column.dataType)) {
      return this.handleArrayType(column.dataType);
    }

    // Priority 4: Enum types (user-defined)
    if (column.dataType.toUpperCase() === 'USER-DEFINED') {
      return this.handleEnumType(column);
    }

    // Priority 5: PostGIS types with dynamic SRID handling
    const postGISValidator = this.handlePostGISType(column.dataType);
    if (postGISValidator) {
      return postGISValidator;
    }

    // Priority 6: Standard type mapping
    const cleanType = this.cleanTypeName(column.dataType);

    // Handle bigint with option
    if (['bigint', 'int8', 'bigserial', 'serial8'].includes(cleanType)) {
      return this.convexOptions.useBigInt64 ? 'v.int64()' : 'v.number()';
    }

    // Handle double precision with option
    if (['double precision', 'float8'].includes(cleanType)) {
      return this.convexOptions.useFloat64 ? 'v.float64()' : 'v.number()';
    }

    // Handle JSON with option
    if (['json', 'jsonb'].includes(cleanType)) {
      return this.convexOptions.jsonAsAny ? 'v.any()' : 'v.object({})';
    }

    // Standard lookup
    const mapped = POSTGRES_TO_CONVEX_MAP[cleanType];
    if (mapped) {
      return mapped;
    }

    // Unknown type handling
    switch (this.convexOptions.unknownTypeHandling) {
      case 'any':
        return 'v.any()';
      case 'error':
        throw new Error(`Unknown PostgreSQL type: ${column.dataType}`);
      case 'string':
      default:
        return 'v.string()';
    }
  }

  /**
   * Gets a Convex validator for non-PostgreSQL databases using transform maps
   */
  private getNonPgValidator(column: ColumnInfo): string {
    const cleanType = column.dataType.split('(')[0].toLowerCase().trim();

    // Handle MySQL TINYINT(1) as boolean
    if (this.dbType === 'mysql' && cleanType === 'tinyint') {
      const match = column.dataType.match(/tinyint\(1\)/i);
      if (match) {
        return 'v.boolean()';
      }
    }

    // Handle array types (PostgreSQL-style in case of cross-db usage)
    if (
      column.dataType.includes('[]') ||
      column.dataType.toLowerCase().startsWith('array')
    ) {
      const baseType = cleanType.replace('[]', '').replace('array', '').trim();
      const baseMapping = this.transformMap[baseType];
      const baseValidator = baseMapping ? baseMapping.validator : 'v.any()';
      return `v.array(${baseValidator})`;
    }

    // Look up the type
    const mapping = this.transformMap[cleanType];
    if (mapping) {
      return mapping.validator;
    }

    // Check for partial matches
    for (const [key, value] of Object.entries(this.transformMap)) {
      if (cleanType.includes(key) || key.includes(cleanType)) {
        return value.validator;
      }
    }

    // Default fallback
    return 'v.string()';
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2: Multi-DB Transform Metadata (from DatabaseTypeMapper)
  // Used by migration engine for data transformation
  // ═══════════════════════════════════════════════════════════════

  /**
   * Map a column to Convex type information including transform metadata.
   * (Replaces DatabaseTypeMapper.mapColumn)
   */
  mapColumnToConvex(column: ColumnInfo): ConvexTypeMapping {
    const cleanType = column.dataType.split('(')[0].toLowerCase().trim();

    // Handle MySQL TINYINT(1) as boolean
    if (this.dbType === 'mysql' && cleanType === 'tinyint') {
      const match = column.dataType.match(/tinyint\(1\)/i);
      if (match) {
        return { validator: 'v.boolean()', typescript: 'boolean', needsTransform: true, transformFn: 'Boolean' };
      }
    }

    // Handle array types
    if (
      column.dataType.includes('[]') ||
      column.dataType.toLowerCase().startsWith('array')
    ) {
      const baseType = cleanType.replace('[]', '').replace('array', '').trim();
      const baseMapping = this.transformMap[baseType] || {
        validator: 'v.any()', typescript: 'any', needsTransform: false,
      };
      return {
        validator: `v.array(${baseMapping.validator})`,
        typescript: `${baseMapping.typescript}[]`,
        needsTransform: baseMapping.needsTransform,
        transformFn: baseMapping.transformFn,
      };
    }

    // Look up the type
    const mapping = this.transformMap[cleanType];
    if (mapping) {
      return { ...mapping };
    }

    // Check for partial matches
    for (const [key, value] of Object.entries(this.transformMap)) {
      if (cleanType.includes(key) || key.includes(cleanType)) {
        return { ...value };
      }
    }

    // Default fallback
    return { validator: 'v.string()', typescript: 'string', needsTransform: true, transformFn: 'String' };
  }

  /**
   * Get Convex validator string for a column (with optional wrapper).
   * (Replaces DatabaseTypeMapper.getValidator)
   */
  getValidator(column: ColumnInfo): string {
    const mapping = this.mapColumnToConvex(column);
    let validator = mapping.validator;

    if (column.isNullable) {
      validator = `v.optional(${validator})`;
    }

    return validator;
  }

  /**
   * Check if a column value needs transformation before insertion.
   * (Replaces DatabaseTypeMapper.needsTransform)
   */
  needsTransform(column: ColumnInfo): boolean {
    return this.mapColumnToConvex(column).needsTransform;
  }

  /**
   * Get transform function name for a column.
   * (Replaces DatabaseTypeMapper.getTransformFn)
   */
  getTransformFn(column: ColumnInfo): string | undefined {
    return this.mapColumnToConvex(column).transformFn;
  }

  /**
   * Get the database type this mapper is configured for.
   * (Replaces DatabaseTypeMapper.getDatabaseType)
   */
  getDatabaseType(): DatabaseType {
    return this.dbType;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 3: TypeScript Interface Generation (from original TypeMapper)
  // Used by CodeGenerator for TS interface output
  // ═══════════════════════════════════════════════════════════════

  /**
   * Map a column to TypeScript type info.
   * (Original TypeMapper.mapColumnToTypeScript)
   */
  mapColumnToTypeScript(column: ColumnInfo): TypeScriptType {
    const baseType = this.mapPostgreSQLTypeToTypeScript(column.dataType);
    const isOptional = this.typeMappingOptions.nullableAsOptional && column.isNullable;
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
      return { type: `${mapped.type}[]`, imports: mapped.imports };
    }

    // Remove type modifiers
    const cleanType = pgType.split('(')[0].toLowerCase();

    switch (cleanType) {
      case 'character varying':
      case 'varchar':
      case 'character':
      case 'char':
      case 'text':
      case 'citext':
      case 'uuid':
        return { type: 'string', imports };

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
          type: this.typeMappingOptions.useBigInt ? 'bigint' : 'number',
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
          type: this.typeMappingOptions.useDecimal ? 'Decimal' : 'number',
          imports: this.typeMappingOptions.useDecimal ? ['Decimal'] : [],
        };

      case 'boolean':
      case 'bool':
        return { type: 'boolean', imports };

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
          type: this.typeMappingOptions.useDate ? 'Date' : 'string',
          imports,
        };

      case 'json':
      case 'jsonb':
        return { type: 'Record<string, any>', imports };

      case 'vector':
        return { type: 'number[]', imports };

      case 'bytea':
        return { type: 'Buffer', imports };

      case 'inet':
      case 'cidr':
      case 'macaddr':
      case 'macaddr8':
        return { type: 'string', imports };

      case 'point':
      case 'line':
      case 'lseg':
      case 'box':
      case 'path':
      case 'polygon':
      case 'circle':
        return { type: 'string', imports };

      case 'bit':
      case 'bit varying':
      case 'varbit':
        return { type: 'string', imports };

      case 'tsvector':
      case 'tsquery':
        return { type: 'string', imports };

      case 'int4range':
      case 'int8range':
      case 'numrange':
      case 'tsrange':
      case 'tstzrange':
      case 'daterange':
        return { type: 'string', imports };

      default:
        if (this.typeMappingOptions.enumAsUnion) {
          return { type: 'string', imports };
        }
        return { type: 'any', imports };
    }
  }

  generateInterfaceProperty(
    columnName: string,
    tsType: TypeScriptType
  ): string {
    const propName = toCamelCase(columnName);
    const optional = tsType.isOptional ? '?' : '';
    const nullableType = tsType.isOptional ? ` | null` : '';

    return `  ${propName}${optional}: ${tsType.type}${nullableType};`;
  }

  generateTableInterface(tableName: string, columns: ColumnInfo[]): string {
    const interfaceName = toPascalCase(tableName);
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
    const interfaceName = `Create${toPascalCase(tableName)}Input`;
    const imports = new Set<string>();

    const properties = columns
      .filter(
        (column) =>
          !column.isIdentity && !column.columnDefault?.includes('nextval')
      )
      .map((column) => {
        const tsType = this.mapColumnToTypeScript(column);
        tsType.imports.forEach((imp) => imports.add(imp));

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
    const interfaceName = `Update${toPascalCase(tableName)}Input`;
    const imports = new Set<string>();

    const properties = columns
      .filter((column) => !column.isPrimaryKey && !column.isIdentity)
      .map((column) => {
        const tsType = this.mapColumnToTypeScript(column);
        tsType.imports.forEach((imp) => imports.add(imp));
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

  // ═══════════════════════════════════════════════════════════════
  // SECTION 4: ConvexTypeMapper-compatible TypeScript type helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get PostgreSQL type to TypeScript type (for Convex generated types).
   * (Replaces ConvexTypeMapper.getTypeScriptType)
   */
  getTypeScriptType(column: ColumnInfo): string {
    const cleanType = this.cleanTypeName(column.dataType);

    // Handle foreign keys
    if (column.isForeignKey && column.foreignKeyTable) {
      return `Id<"${column.foreignKeyTable}">`;
    }

    // Handle arrays
    if (this.isArrayType(column.dataType)) {
      const baseType = column.dataType.replace('[]', '');
      const cleanBase = this.cleanTypeName(baseType);
      const tsType = this.pgToTsType(cleanBase);
      return `${tsType}[]`;
    }

    return this.pgToTsType(cleanType);
  }

  private pgToTsType(pgType: string): string {
    const mapping: Record<string, string> = {
      'character varying': 'string',
      varchar: 'string',
      text: 'string',
      char: 'string',
      character: 'string',
      uuid: 'string',
      citext: 'string',
      smallint: 'number',
      integer: 'number',
      int: 'number',
      bigint: 'number',
      serial: 'number',
      bigserial: 'number',
      real: 'number',
      'double precision': 'number',
      numeric: 'number',
      decimal: 'number',
      money: 'number',
      boolean: 'boolean',
      bool: 'boolean',
      timestamp: 'number',
      'timestamp without time zone': 'number',
      'timestamp with time zone': 'number',
      timestamptz: 'number',
      date: 'number',
      time: 'string',
      interval: 'string',
      json: 'any',
      jsonb: 'any',
      vector: 'number[]',
      bytea: 'Id<"_storage">',
      blob: 'Id<"_storage">',
      binary: 'Id<"_storage">',
      varbinary: 'Id<"_storage">',
      image: 'Id<"_storage">',
    };

    return mapping[pgType] || 'any';
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 5: Custom/Enum registration (from ConvexTypeMapper)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Registers a custom type mapping.
   * (Replaces ConvexTypeMapper.registerCustomMapping)
   */
  registerCustomMapping(pgType: string, convexValidator: string): void {
    this.convexOptions.customTypeMappings[pgType] = convexValidator;
  }

  /**
   * Registers an enum mapping with specific values.
   * (Replaces ConvexTypeMapper.registerEnumMapping)
   */
  registerEnumMapping(columnOrTypeName: string, values: string[]): void {
    const unionValidator = `v.union(${values.map((v) => `v.literal("${v}")`).join(', ')})`;
    this.convexOptions.enumMappings[columnOrTypeName] = unionValidator;
  }

  /**
   * Gets the type mapping table for reference.
   * (Replaces ConvexTypeMapper.getTypeMappingTable)
   */
  getTypeMappingTable(): Record<string, string> {
    return { ...POSTGRES_TO_CONVEX_MAP };
  }

  /**
   * Get Convex options.
   * (Replaces ConvexTypeMapper.getOptions)
   */
  getOptions(): ConvexTypeMapperOptions {
    return { ...this.convexOptions };
  }

  /**
   * Update Convex options.
   * (Replaces ConvexTypeMapper.updateOptions)
   */
  updateOptions(options: Partial<ConvexTypeMapperOptions>): void {
    this.convexOptions = { ...this.convexOptions, ...options };
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════

  private getTransformMap(dbType: DatabaseType): Record<string, ConvexTypeMapping> {
    switch (dbType) {
      case 'postgresql':
        return POSTGRESQL_TRANSFORM;
      case 'mysql':
        return MYSQL_TYPES;
      case 'sqlite':
        return SQLITE_TYPES;
      case 'mssql':
        return MSSQL_TYPES;
      default:
        return POSTGRESQL_TRANSFORM;
    }
  }

  private isArrayType(pgType: string): boolean {
    return pgType.endsWith('[]') || pgType.toUpperCase().startsWith('ARRAY');
  }

  private handleArrayType(pgType: string): string {
    let baseType = pgType;
    if (pgType.endsWith('[]')) {
      baseType = pgType.slice(0, -2);
    } else if (pgType.toUpperCase().startsWith('ARRAY')) {
      const match = pgType.match(/ARRAY\[(.+)\]/i);
      baseType = match ? match[1] : 'text';
    }

    if (this.convexOptions.arrayHandling === 'any') {
      return 'v.array(v.any())';
    }

    const cleanBase = this.cleanTypeName(baseType);
    const baseValidator = POSTGRES_TO_CONVEX_MAP[cleanBase] || 'v.string()';

    return `v.array(${baseValidator})`;
  }

  private handleEnumType(column: ColumnInfo): string {
    if (this.convexOptions.enumMappings[column.columnName]) {
      return this.convexOptions.enumMappings[column.columnName];
    }
    return 'v.string()';
  }

  private handlePostGISType(pgType: string): string | null {
    const lowerType = pgType.toLowerCase().trim();

    // Check for exact match first
    if (POSTGRES_TO_CONVEX_MAP[lowerType]) {
      return POSTGRES_TO_CONVEX_MAP[lowerType];
    }

    // Handle geometry types with any SRID
    const geometryMatch = lowerType.match(/^geometry\((\w+)(?:,\s*\d+)?\)$/);
    if (geometryMatch) {
      const subtype = geometryMatch[1].toLowerCase();
      return this.getGeoJSONValidator(subtype);
    }

    // Handle geography types with any SRID
    const geographyMatch = lowerType.match(/^geography\((\w+)(?:,\s*\d+)?\)$/);
    if (geographyMatch) {
      const subtype = geographyMatch[1].toLowerCase();
      return this.getGeoJSONValidator(subtype);
    }

    // Handle geometry/geography with Z/M/ZM modifiers
    const modifierMatch = lowerType.match(
      /^(geometry|geography)\((\w+)(z|m|zm)?(?:,\s*\d+)?\)$/
    );
    if (modifierMatch) {
      const subtype = modifierMatch[2].toLowerCase();
      return this.getGeoJSONValidator(subtype);
    }

    // Base geometry/geography without subtype
    if (lowerType === 'geometry' || lowerType === 'geography') {
      return 'v.object({ type: v.string(), coordinates: v.any(), crs: v.optional(v.object({ type: v.string(), properties: v.any() })) })';
    }

    return null;
  }

  private getGeoJSONValidator(subtype: string): string {
    const validators: Record<string, string> = {
      point:
        'v.object({ type: v.literal("Point"), coordinates: v.array(v.number()) })',
      linestring:
        'v.object({ type: v.literal("LineString"), coordinates: v.array(v.array(v.number())) })',
      polygon:
        'v.object({ type: v.literal("Polygon"), coordinates: v.array(v.array(v.array(v.number()))) })',
      multipoint:
        'v.object({ type: v.literal("MultiPoint"), coordinates: v.array(v.array(v.number())) })',
      multilinestring:
        'v.object({ type: v.literal("MultiLineString"), coordinates: v.array(v.array(v.array(v.number()))) })',
      multipolygon:
        'v.object({ type: v.literal("MultiPolygon"), coordinates: v.array(v.array(v.array(v.array(v.number())))) })',
      geometrycollection:
        'v.object({ type: v.literal("GeometryCollection"), geometries: v.array(v.object({ type: v.string(), coordinates: v.any() })) })',
      pointz:
        'v.object({ type: v.literal("Point"), coordinates: v.array(v.number()) })',
      linestringz:
        'v.object({ type: v.literal("LineString"), coordinates: v.array(v.array(v.number())) })',
      polygonz:
        'v.object({ type: v.literal("Polygon"), coordinates: v.array(v.array(v.array(v.number()))) })',
      multipointz:
        'v.object({ type: v.literal("MultiPoint"), coordinates: v.array(v.array(v.number())) })',
      multilinestringz:
        'v.object({ type: v.literal("MultiLineString"), coordinates: v.array(v.array(v.array(v.number()))) })',
      multipolygonz:
        'v.object({ type: v.literal("MultiPolygon"), coordinates: v.array(v.array(v.array(v.array(v.number())))) })',
      pointm:
        'v.object({ type: v.literal("Point"), coordinates: v.array(v.number()) })',
      linestringm:
        'v.object({ type: v.literal("LineString"), coordinates: v.array(v.array(v.number())) })',
      polygonm:
        'v.object({ type: v.literal("Polygon"), coordinates: v.array(v.array(v.array(v.number()))) })',
      multipointm:
        'v.object({ type: v.literal("MultiPoint"), coordinates: v.array(v.array(v.number())) })',
      multilinestringm:
        'v.object({ type: v.literal("MultiLineString"), coordinates: v.array(v.array(v.array(v.number()))) })',
      multipolygonm:
        'v.object({ type: v.literal("MultiPolygon"), coordinates: v.array(v.array(v.array(v.array(v.number())))) })',
      pointzm:
        'v.object({ type: v.literal("Point"), coordinates: v.array(v.number()) })',
      linestringzm:
        'v.object({ type: v.literal("LineString"), coordinates: v.array(v.array(v.number())) })',
      polygonzm:
        'v.object({ type: v.literal("Polygon"), coordinates: v.array(v.array(v.array(v.number()))) })',
      multipointzm:
        'v.object({ type: v.literal("MultiPoint"), coordinates: v.array(v.array(v.number())) })',
      multilinestringzm:
        'v.object({ type: v.literal("MultiLineString"), coordinates: v.array(v.array(v.array(v.number()))) })',
      multipolygonzm:
        'v.object({ type: v.literal("MultiPolygon"), coordinates: v.array(v.array(v.array(v.array(v.number())))) })',
    };

    return (
      validators[subtype] ||
      'v.object({ type: v.string(), coordinates: v.any() })'
    );
  }

  private cleanTypeName(pgType: string): string {
    return pgType
      .split('(')[0]
      .split('[')[0]
      .toLowerCase()
      .trim();
  }
}

// ============================================================================
// Backward-compatible aliases
// ============================================================================

/**
 * Backward-compatible alias for TypeMapper (was DatabaseTypeMapper).
 * Consumers that used `new DatabaseTypeMapper('postgresql')` should use
 * `new TypeMapper({ dbType: 'postgresql' })` instead.
 */
export class DatabaseTypeMapper {
  private mapper: TypeMapper;

  constructor(dbType: DatabaseType) {
    this.mapper = new TypeMapper({ dbType });
  }

  mapColumn(column: ColumnInfo): ConvexTypeMapping {
    return this.mapper.mapColumnToConvex(column);
  }

  getValidator(column: ColumnInfo): string {
    return this.mapper.getValidator(column);
  }

  getTypeScriptType(column: ColumnInfo): string {
    return this.mapper.getTypeScriptType(column);
  }

  needsTransform(column: ColumnInfo): boolean {
    return this.mapper.needsTransform(column);
  }

  getTransformFn(column: ColumnInfo): string | undefined {
    return this.mapper.getTransformFn(column);
  }

  getDatabaseType(): DatabaseType {
    return this.mapper.getDatabaseType();
  }
}

/**
 * Create a type mapper for the specified database type.
 * (Backward-compatible factory from database-type-mapper.ts)
 */
export function createTypeMapper(dbType: DatabaseType): TypeMapper {
  return new TypeMapper({ dbType });
}

export default TypeMapper;
