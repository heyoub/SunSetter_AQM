/**
 * Fuzzy Matching Utility
 *
 * Provides fuzzy string matching for table name suggestions
 * when users make typos in table names.
 *
 * Performance optimizations:
 * - Single distance calculation per comparison (no redundant calls)
 * - Early termination for exact matches
 * - Combined exact + fuzzy matching in single pass
 */

/**
 * Calculate Levenshtein distance between two strings
 * (minimum number of single-character edits needed to transform one string into another)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Early exits for trivial cases
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;
  if (str1 === str2) return 0;

  // Create a 2D array for dynamic programming
  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Combined calculation returning both score and distance in single pass
 * Avoids duplicate Levenshtein calculations
 */
export function calculateSimilarity(
  str1: string,
  str2: string
): { score: number; distance: number } {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  const distance = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  const score = maxLen === 0 ? 1.0 : 1 - distance / maxLen;
  return { score, distance };
}

/**
 * Calculate similarity score (0-1) between two strings
 * Higher score means more similar
 */
export function similarityScore(str1: string, str2: string): number {
  return calculateSimilarity(str1, str2).score;
}

/**
 * Match result with similarity score
 */
export interface FuzzyMatch {
  value: string;
  score: number;
  distance: number;
}

/**
 * Combined result with optional exact match and fuzzy suggestions
 */
export interface FuzzyMatchResult {
  /** Exact match if found (case-insensitive) */
  exact: FuzzyMatch | null;
  /** Fuzzy matches sorted by score (highest first), excludes exact match */
  fuzzy: FuzzyMatch[];
}

/**
 * Find fuzzy matches for a given string in a list of candidates
 *
 * Performance optimizations:
 * - Single distance calculation per candidate (uses calculateSimilarity)
 * - Early termination when exact match found
 * - Combined exact + fuzzy detection in single pass
 *
 * @param input - The input string to match
 * @param candidates - Array of candidate strings to match against
 * @param threshold - Minimum similarity score (0-1) to include in results (default: 0.6)
 * @param maxResults - Maximum number of results to return (default: 5)
 * @returns Object with exact match (if any) and sorted fuzzy matches
 */
export function fuzzyMatch(
  input: string,
  candidates: string[],
  threshold: number = 0.6,
  maxResults: number = 5
): FuzzyMatchResult {
  const inputLower = input.toLowerCase();
  const matches: FuzzyMatch[] = [];
  let exactMatch: FuzzyMatch | null = null;

  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();

    // Check for exact match (distance 0)
    if (candidateLower === inputLower) {
      exactMatch = {
        value: candidate,
        score: 1.0,
        distance: 0,
      };
      // Early termination - return immediately with exact match
      return { exact: exactMatch, fuzzy: [] };
    }

    // Single calculation for both score and distance
    const { score, distance } = calculateSimilarity(input, candidate);

    if (score >= threshold) {
      matches.push({
        value: candidate,
        score,
        distance,
      });
    }
  }

  // Sort by score (descending), then by distance (ascending)
  matches.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return a.distance - b.distance;
  });

  return {
    exact: null,
    fuzzy: matches.slice(0, maxResults),
  };
}

/**
 * Legacy API: Returns flat array of matches (deprecated, use fuzzyMatch instead)
 * Maintained for backward compatibility
 */
export function fuzzyMatchLegacy(
  input: string,
  candidates: string[],
  threshold: number = 0.6,
  maxResults: number = 5
): FuzzyMatch[] {
  const result = fuzzyMatch(input, candidates, threshold, maxResults);
  if (result.exact) {
    return [result.exact, ...result.fuzzy].slice(0, maxResults);
  }
  return result.fuzzy;
}

/**
 * Find the best fuzzy match for a given string
 *
 * @param input - The input string to match
 * @param candidates - Array of candidate strings to match against
 * @param threshold - Minimum similarity score (0-1) to return a match (default: 0.6)
 * @returns The best match or null if no match meets the threshold
 */
export function findBestMatch(
  input: string,
  candidates: string[],
  threshold: number = 0.6
): FuzzyMatch | null {
  const result = fuzzyMatch(input, candidates, threshold, 1);
  // Return exact match first, or best fuzzy match
  return result.exact || result.fuzzy[0] || null;
}

/**
 * Check if an exact match exists (case-insensitive)
 * Uses fuzzyMatch with early termination for efficiency
 *
 * @param input - The input string to match
 * @param candidates - Array of candidate strings to match against
 * @returns The exact match or null
 */
export function findExactMatch(
  input: string,
  candidates: string[]
): string | null {
  // Use fuzzyMatch which has early termination for exact matches
  const result = fuzzyMatch(input, candidates, 1.0, 1);
  return result.exact?.value || null;
}

/**
 * Suggest corrections for a misspelled table name
 * Uses single-pass fuzzyMatch for efficiency (no separate exact match check)
 *
 * @param tableName - The potentially misspelled table name
 * @param validTables - Array of valid table names
 * @param maxSuggestions - Maximum number of suggestions (default: 3)
 * @returns Object with exists flag and suggestions
 */
export function suggestTableNames(
  tableName: string,
  validTables: string[],
  maxSuggestions: number = 3
): {
  exists: boolean;
  exactMatch: string | null;
  suggestions: FuzzyMatch[];
} {
  // Single-pass: fuzzyMatch handles both exact and fuzzy in one go
  const result = fuzzyMatch(tableName, validTables, 0.5, maxSuggestions);

  if (result.exact) {
    return {
      exists: true,
      exactMatch: result.exact.value,
      suggestions: [],
    };
  }

  return {
    exists: false,
    exactMatch: null,
    suggestions: result.fuzzy,
  };
}

/**
 * Format suggestion message for CLI display
 *
 * @param tableName - The input table name
 * @param suggestions - Array of fuzzy matches
 * @returns Formatted suggestion message
 */
export function formatSuggestionMessage(
  tableName: string,
  suggestions: FuzzyMatch[]
): string {
  if (suggestions.length === 0) {
    return `Table '${tableName}' not found.`;
  }

  const suggestionList = suggestions
    .map(
      (match, index) =>
        `  ${index + 1}. ${match.value} (${Math.round(match.score * 100)}% match)`
    )
    .join('\n');

  return `Table '${tableName}' not found. Did you mean:\n${suggestionList}`;
}
