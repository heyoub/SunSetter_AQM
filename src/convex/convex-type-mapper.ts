/**
 * Convex Type Mapper
 *
 * Maps PostgreSQL data types to Convex validators.
 * Handles all PostgreSQL types including arrays, JSON, geometric, network, etc.
 */

import type {
  ColumnInfo,
  ConvexFieldMapping,
  ConvexTypeMapperOptions,
} from './types.js';
import { toCamelCase, escapeFieldName } from '../shared/types.js';

/**
 * Complete PostgreSQL to Convex type mapping table
 */
const POSTGRES_TO_CONVEX_MAP: Record<string, string> = {
  // ═══════════════════════════════════════════════════════════════
  // STRING TYPES
  // ═══════════════════════════════════════════════════════════════
  'character varying': 'v.string()',
  varchar: 'v.string()',
  character: 'v.string()',
  char: 'v.string()',
  text: 'v.string()',
  citext: 'v.string()',
  name: 'v.string()',

  // ═══════════════════════════════════════════════════════════════
  // NUMERIC TYPES - Integer
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // NUMERIC TYPES - Floating Point
  // ═══════════════════════════════════════════════════════════════
  real: 'v.number()',
  float4: 'v.number()',
  'double precision': 'v.number()',
  float8: 'v.number()',
  float: 'v.number()',

  // Arbitrary precision
  numeric: 'v.number()',
  decimal: 'v.number()',
  money: 'v.number()',

  // ═══════════════════════════════════════════════════════════════
  // BOOLEAN TYPE
  // ═══════════════════════════════════════════════════════════════
  boolean: 'v.boolean()',
  bool: 'v.boolean()',

  // ═══════════════════════════════════════════════════════════════
  // DATE/TIME TYPES -> Store as numbers (Unix timestamps in ms)
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // UUID TYPE
  // ═══════════════════════════════════════════════════════════════
  uuid: 'v.string()',

  // ═══════════════════════════════════════════════════════════════
  // JSON TYPES
  // ═══════════════════════════════════════════════════════════════
  json: 'v.any()',
  jsonb: 'v.any()',

  // ═══════════════════════════════════════════════════════════════
  // BINARY DATA
  // ═══════════════════════════════════════════════════════════════
  bytea: 'v.bytes()',

  // ═══════════════════════════════════════════════════════════════
  // NETWORK ADDRESS TYPES
  // ═══════════════════════════════════════════════════════════════
  inet: 'v.string()',
  cidr: 'v.string()',
  macaddr: 'v.string()',
  macaddr8: 'v.string()',

  // ═══════════════════════════════════════════════════════════════
  // GEOMETRIC TYPES
  // ═══════════════════════════════════════════════════════════════
  point: 'v.object({ x: v.number(), y: v.number() })',
  line: 'v.string()',
  lseg: 'v.object({ start: v.object({ x: v.number(), y: v.number() }), end: v.object({ x: v.number(), y: v.number() }) })',
  box: 'v.object({ topRight: v.object({ x: v.number(), y: v.number() }), bottomLeft: v.object({ x: v.number(), y: v.number() }) })',
  path: 'v.array(v.object({ x: v.number(), y: v.number() }))',
  polygon: 'v.array(v.object({ x: v.number(), y: v.number() }))',
  circle:
    'v.object({ center: v.object({ x: v.number(), y: v.number() }), radius: v.number() })',

  // ═══════════════════════════════════════════════════════════════
  // BIT STRING TYPES
  // ═══════════════════════════════════════════════════════════════
  bit: 'v.string()',
  'bit varying': 'v.string()',
  varbit: 'v.string()',

  // ═══════════════════════════════════════════════════════════════
  // TEXT SEARCH TYPES
  // ═══════════════════════════════════════════════════════════════
  tsvector: 'v.string()',
  tsquery: 'v.string()',

  // ═══════════════════════════════════════════════════════════════
  // RANGE TYPES
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // OBJECT IDENTIFIER TYPES (PostgreSQL internals)
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // XML TYPE
  // ═══════════════════════════════════════════════════════════════
  xml: 'v.string()',

  // ═══════════════════════════════════════════════════════════════
  // SPECIAL TYPES
  // ═══════════════════════════════════════════════════════════════
  pg_lsn: 'v.string()',
  pg_snapshot: 'v.string()',
  txid_snapshot: 'v.string()',

  // ═══════════════════════════════════════════════════════════════
  // POSTGIS TYPES - Stored as GeoJSON format
  // ═══════════════════════════════════════════════════════════════
  // Core geometry types
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

  // USER-DEFINED (handled separately)
  'user-defined': 'v.any()',
};

/**
 * Default options for the type mapper
 */
const DEFAULT_OPTIONS: ConvexTypeMapperOptions = {
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

/**
 * Maps PostgreSQL types to Convex validators
 */
export class ConvexTypeMapper {
  private options: ConvexTypeMapperOptions;

  constructor(options: Partial<ConvexTypeMapperOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Maps a PostgreSQL column to a Convex field mapping
   */
  mapColumn(column: ColumnInfo): ConvexFieldMapping {
    const validator = this.getValidator(column);
    const isOptional = column.isNullable;
    const isId = column.isForeignKey;

    // Wrap with v.optional() or v.nullable() if nullable
    // v.nullable() allows explicit null values (Convex 1.29.0+)
    // v.optional() allows the field to be missing entirely
    let finalValidator: string;
    if (isOptional) {
      if (this.options.useNullable) {
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
      referencedTable = this.options.tableNameTransformer
        ? this.options.tableNameTransformer(column.foreignKeyTable)
        : column.foreignKeyTable;
    }

    return {
      fieldName: escapeFieldName(toCamelCase(column.columnName)),
      originalColumnName: column.columnName,
      validator: finalValidator,
      isOptional,
      isId,
      referencedTable,
      comment: this.options.preserveComments
        ? column.description || undefined
        : undefined,
      originalPgType: column.dataType,
    };
  }

  /**
   * Gets the base validator (without optional wrapper)
   */
  private getValidator(column: ColumnInfo): string {
    // Priority 1: Foreign key -> v.id("tableName")
    if (column.isForeignKey && column.foreignKeyTable) {
      // Apply table name transformer if configured (must match schema generator)
      const tableName = this.options.tableNameTransformer
        ? this.options.tableNameTransformer(column.foreignKeyTable)
        : column.foreignKeyTable;
      return `v.id("${tableName}")`;
    }

    // Priority 2: Custom type mappings
    if (this.options.customTypeMappings[column.dataType]) {
      return this.options.customTypeMappings[column.dataType];
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
      return this.options.useBigInt64 ? 'v.int64()' : 'v.number()';
    }

    // Handle double precision with option
    if (['double precision', 'float8'].includes(cleanType)) {
      return this.options.useFloat64 ? 'v.float64()' : 'v.number()';
    }

    // Handle JSON with option
    if (['json', 'jsonb'].includes(cleanType)) {
      return this.options.jsonAsAny ? 'v.any()' : 'v.object({})';
    }

    // Standard lookup
    const mapped = POSTGRES_TO_CONVEX_MAP[cleanType];
    if (mapped) {
      return mapped;
    }

    // Unknown type handling
    switch (this.options.unknownTypeHandling) {
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
   * Detects if a type is an array
   */
  private isArrayType(pgType: string): boolean {
    return pgType.endsWith('[]') || pgType.toUpperCase().startsWith('ARRAY');
  }

  /**
   * Handles array type mapping
   */
  private handleArrayType(pgType: string): string {
    // Extract base type from array
    let baseType = pgType;
    if (pgType.endsWith('[]')) {
      baseType = pgType.slice(0, -2);
    } else if (pgType.toUpperCase().startsWith('ARRAY')) {
      // Handle ARRAY[integer] syntax
      const match = pgType.match(/ARRAY\[(.+)\]/i);
      baseType = match ? match[1] : 'text';
    }

    if (this.options.arrayHandling === 'any') {
      return 'v.array(v.any())';
    }

    const cleanBase = this.cleanTypeName(baseType);
    const baseValidator = POSTGRES_TO_CONVEX_MAP[cleanBase] || 'v.string()';

    return `v.array(${baseValidator})`;
  }

  /**
   * Handles enum (user-defined) type mapping
   */
  private handleEnumType(column: ColumnInfo): string {
    // Check for custom enum mapping
    if (this.options.enumMappings[column.columnName]) {
      return this.options.enumMappings[column.columnName];
    }

    // Default: treat as string (enum values are strings in PostgreSQL)
    return 'v.string()';
  }

  /**
   * Handles PostGIS geometry/geography types with dynamic SRID values
   */
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

  /**
   * Returns the appropriate GeoJSON validator for a PostGIS geometry subtype
   */
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
      // 3D variants (with Z coordinate)
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
      // Measured variants (with M coordinate)
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
      // 3D + Measured variants (with ZM coordinates)
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

  /**
   * Cleans type name (removes modifiers, lowercases)
   */
  private cleanTypeName(pgType: string): string {
    return pgType
      .split('(')[0] // Remove length specifiers
      .split('[')[0] // Remove array brackets
      .toLowerCase()
      .trim();
  }

  // Using shared toCamelCase from ../shared/types.js

  /**
   * Maps multiple columns at once
   */
  mapColumns(columns: ColumnInfo[]): ConvexFieldMapping[] {
    return columns.map((col) => this.mapColumn(col));
  }

  /**
   * Gets the type mapping table for reference
   */
  getTypeMappingTable(): Record<string, string> {
    return { ...POSTGRES_TO_CONVEX_MAP };
  }

  /**
   * Registers a custom type mapping
   */
  registerCustomMapping(pgType: string, convexValidator: string): void {
    this.options.customTypeMappings[pgType] = convexValidator;
  }

  /**
   * Registers an enum mapping with specific values
   */
  registerEnumMapping(columnOrTypeName: string, values: string[]): void {
    const unionValidator = `v.union(${values.map((v) => `v.literal("${v}")`).join(', ')})`;
    this.options.enumMappings[columnOrTypeName] = unionValidator;
  }

  /**
   * Get PostgreSQL type to TypeScript type (for generated types)
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

  /**
   * Maps PostgreSQL type to TypeScript type
   */
  private pgToTsType(pgType: string): string {
    const mapping: Record<string, string> = {
      // String types
      'character varying': 'string',
      varchar: 'string',
      text: 'string',
      char: 'string',
      character: 'string',
      uuid: 'string',
      citext: 'string',

      // Number types
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

      // Boolean
      boolean: 'boolean',
      bool: 'boolean',

      // Date/time
      timestamp: 'number',
      'timestamp without time zone': 'number',
      'timestamp with time zone': 'number',
      timestamptz: 'number',
      date: 'number',
      time: 'string',
      interval: 'string',

      // JSON
      json: 'any',
      jsonb: 'any',

      // Binary
      bytea: 'ArrayBuffer',
    };

    return mapping[pgType] || 'any';
  }

  /**
   * Get options
   */
  getOptions(): ConvexTypeMapperOptions {
    return { ...this.options };
  }

  /**
   * Update options
   */
  updateOptions(options: Partial<ConvexTypeMapperOptions>): void {
    this.options = { ...this.options, ...options };
  }
}
