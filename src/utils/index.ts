/**
 * SunSetter AQM+ Utility Functions
 *
 * This module exports utility functions for programmatic use:
 * - Connection validation and parsing
 * - Fuzzy string matching for table names
 * - Circuit breaker for resilient API calls
 *
 * @module utils
 */

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
