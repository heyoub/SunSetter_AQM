/**
 * Fuzzy Matching Utility
 *
 * Provides fuzzy string matching for table name suggestions
 * when users make typos in table names.
 */

/**
 * Calculate Levenshtein distance between two strings
 * (minimum number of single-character edits needed to transform one string into another)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

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
 * Calculate similarity score (0-1) between two strings
 * Higher score means more similar
 */
export function similarityScore(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  return 1 - distance / maxLen;
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
 * Find fuzzy matches for a given string in a list of candidates
 *
 * @param input - The input string to match
 * @param candidates - Array of candidate strings to match against
 * @param threshold - Minimum similarity score (0-1) to include in results (default: 0.6)
 * @param maxResults - Maximum number of results to return (default: 5)
 * @returns Sorted array of matches (highest score first)
 */
export function fuzzyMatch(
  input: string,
  candidates: string[],
  threshold: number = 0.6,
  maxResults: number = 5
): FuzzyMatch[] {
  const matches: FuzzyMatch[] = [];

  for (const candidate of candidates) {
    const score = similarityScore(input, candidate);
    const distance = levenshteinDistance(
      input.toLowerCase(),
      candidate.toLowerCase()
    );

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

  return matches.slice(0, maxResults);
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
  const matches = fuzzyMatch(input, candidates, threshold, 1);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Check if an exact match exists (case-insensitive)
 *
 * @param input - The input string to match
 * @param candidates - Array of candidate strings to match against
 * @returns The exact match or null
 */
export function findExactMatch(
  input: string,
  candidates: string[]
): string | null {
  const lowerInput = input.toLowerCase();
  const match = candidates.find((c) => c.toLowerCase() === lowerInput);
  return match || null;
}

/**
 * Suggest corrections for a misspelled table name
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
  // Check for exact match first
  const exactMatch = findExactMatch(tableName, validTables);
  if (exactMatch) {
    return {
      exists: true,
      exactMatch,
      suggestions: [],
    };
  }

  // Find fuzzy matches
  const suggestions = fuzzyMatch(tableName, validTables, 0.5, maxSuggestions);

  return {
    exists: false,
    exactMatch: null,
    suggestions,
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
