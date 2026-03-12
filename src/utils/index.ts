/**
 * SunSetter AQM+ Utility Functions
 *
 * This module exports utility functions for programmatic use:
 * - Naming & case conversion (toCamelCase, toPascalCase, escapeFieldName, ...)
 * - Formatting (formatDuration, formatBytes, formatNumber)
 * - Error handling (toError — safe unknown→Error conversion)
 * - Connection validation and parsing
 * - Fuzzy string matching for table names
 * - Circuit breaker for resilient API calls
 *
 * @module utils
 */

// Naming & identifier utilities (canonical source of truth)
export {
  toCamelCase,
  toPascalCase,
  toKebabCase,
  toSnakeCase,
  JS_RESERVED_WORDS,
  CONVEX_RESERVED_FIELDS,
  isReservedWord,
  escapeFieldName,
  escapeString,
  isValidIdentifier,
  toValidIdentifier,
  sanitizeTableName,
  sanitizeColumnName,
} from './naming.js';

// Formatting utilities (canonical source of truth)
export {
  formatNumber,
  formatBytes,
  formatDuration,
  formatDurationCompact,
} from './formatting.js';

// Error handling utilities (canonical source of truth)
export { toError, toErrorMessage } from './errors.js';

// Connection validation and parsing
export {
  parseConnectionString,
  validateConnectionString,
  maskPassword,
  escapeHtml,
  buildConnectionString,
  detectCloudProvider,
  analyzeConnection,
  testConnection,
  getConnectionStringExamples,
  CLOUD_DB_EXAMPLES,
  type ParsedConnection,
  type ConnectionValidationResult,
} from './connection-validator.js';

// Fuzzy string matching
export {
  levenshteinDistance,
  similarityScore,
  calculateSimilarity,
  fuzzyMatch,
  fuzzyMatchLegacy,
  findBestMatch,
  findExactMatch,
  suggestTableNames,
  formatSuggestionMessage,
  type FuzzyMatch,
  type FuzzyMatchResult,
} from './fuzzy-match.js';

// Circuit breaker for API resilience
export {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError,
  createConvexCircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitState,
} from './circuit-breaker.js';
