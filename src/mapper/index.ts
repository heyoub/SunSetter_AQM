/**
 * Mapper Module - Barrel Exports
 *
 * Canonical unified TypeMapper + backward-compatible aliases.
 */

export {
  TypeMapper,
  DatabaseTypeMapper,
  createTypeMapper,
} from './type-mapper.js';

export type {
  DatabaseType,
  TypeMappingOptions,
  TypeScriptType,
  ConvexTypeMapping,
  TypeMapperOptions,
} from './type-mapper.js';
