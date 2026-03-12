/**
 * Convex Module - Schema Translation Layer
 *
 * This module handles the translation of PostgreSQL schemas to Convex,
 * including type mapping, relationship analysis, and code generation.
 */

// Type definitions
export * from './types.js';

// Core components - TypeMapper is the canonical unified mapper
// Re-export as ConvexTypeMapper for backward compatibility
export { TypeMapper as ConvexTypeMapper } from '../mapper/type-mapper.js';
export { RelationshipAnalyzer } from './relationship-analyzer.js';
export { ConvexSchemaGenerator } from './convex-schema-generator.js';
export { EdgeCaseHandler } from './edge-case-handler.js';
export {
  convertColumnCheckConstraints,
  applyCheckConstraintValidators,
  type CheckConstraintConversion,
} from './check-constraint-converter.js';
