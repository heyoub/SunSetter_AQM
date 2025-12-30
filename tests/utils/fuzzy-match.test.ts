/**
 * Tests for Fuzzy Match Utility
 *
 * Updated for new combined API: fuzzyMatch returns { exact, fuzzy }
 */

import {
  levenshteinDistance,
  similarityScore,
  calculateSimilarity,
  fuzzyMatch,
  fuzzyMatchLegacy,
  findBestMatch,
  findExactMatch,
  suggestTableNames,
  formatSuggestionMessage,
  type FuzzyMatchResult,
} from '../../src/utils/fuzzy-match';

describe('Fuzzy Match Utility', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0);
    });

    it('should return string length for empty comparison', () => {
      expect(levenshteinDistance('hello', '')).toBe(5);
      expect(levenshteinDistance('', 'world')).toBe(5);
    });

    it('should calculate correct distance for single character difference', () => {
      expect(levenshteinDistance('cat', 'car')).toBe(1);
      expect(levenshteinDistance('cat', 'bat')).toBe(1);
    });

    it('should calculate correct distance for insertions', () => {
      expect(levenshteinDistance('cat', 'cats')).toBe(1);
      expect(levenshteinDistance('user', 'users')).toBe(1);
    });

    it('should calculate correct distance for deletions', () => {
      expect(levenshteinDistance('cats', 'cat')).toBe(1);
      expect(levenshteinDistance('users', 'user')).toBe(1);
    });

    it('should calculate correct distance for complex cases', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
      expect(levenshteinDistance('saturday', 'sunday')).toBe(3);
    });
  });

  describe('similarityScore', () => {
    it('should return 1 for identical strings', () => {
      expect(similarityScore('hello', 'hello')).toBe(1);
    });

    it('should return 1 for empty strings', () => {
      expect(similarityScore('', '')).toBe(1);
    });

    it('should return 0 for completely different strings', () => {
      expect(similarityScore('abc', 'xyz')).toBe(0);
    });

    it('should return high score for similar strings', () => {
      const score = similarityScore('users', 'user');
      expect(score).toBeGreaterThanOrEqual(0.8);
    });

    it('should be case insensitive', () => {
      expect(similarityScore('Users', 'users')).toBe(1);
      expect(similarityScore('ORDERS', 'orders')).toBe(1);
    });
  });

  describe('calculateSimilarity', () => {
    it('should return score and distance in single calculation', () => {
      const result = calculateSimilarity('hello', 'hello');
      expect(result.score).toBe(1);
      expect(result.distance).toBe(0);
    });

    it('should calculate correct values for similar strings', () => {
      const result = calculateSimilarity('users', 'usres');
      expect(result.distance).toBe(2); // Two character swaps
      expect(result.score).toBeGreaterThan(0.5);
      expect(result.score).toBeLessThan(1);
    });

    it('should be case insensitive', () => {
      const result = calculateSimilarity('HELLO', 'hello');
      expect(result.score).toBe(1);
      expect(result.distance).toBe(0);
    });
  });

  describe('fuzzyMatch (new combined API)', () => {
    const candidates = [
      'users',
      'orders',
      'products',
      'categories',
      'user_roles',
    ];

    it('should return exact match with early termination', () => {
      const result: FuzzyMatchResult = fuzzyMatch('users', candidates);
      expect(result.exact).not.toBeNull();
      expect(result.exact?.value).toBe('users');
      expect(result.exact?.score).toBe(1);
      expect(result.exact?.distance).toBe(0);
      expect(result.fuzzy).toHaveLength(0); // Early termination
    });

    it('should find close matches for typos (no exact match)', () => {
      const result = fuzzyMatch('usres', candidates);
      expect(result.exact).toBeNull();
      expect(result.fuzzy.length).toBeGreaterThan(0);
      expect(result.fuzzy[0].value).toBe('users');
    });

    it('should find partial matches in fuzzy array', () => {
      const result = fuzzyMatch('user', candidates, 0.5); // Lower threshold
      expect(result.exact).toBeNull();
      expect(result.fuzzy.some((m) => m.value === 'users')).toBe(true);
    });

    it('should respect threshold for fuzzy matches', () => {
      const result = fuzzyMatch('xyz', candidates, 0.9);
      expect(result.exact).toBeNull();
      expect(result.fuzzy).toHaveLength(0);
    });

    it('should respect maxResults for fuzzy matches', () => {
      const result = fuzzyMatch('u', candidates, 0.1, 2);
      expect(result.fuzzy.length).toBeLessThanOrEqual(2);
    });

    it('should sort fuzzy matches by score descending', () => {
      const result = fuzzyMatch('order', candidates, 0.3);
      for (let i = 1; i < result.fuzzy.length; i++) {
        expect(result.fuzzy[i - 1].score).toBeGreaterThanOrEqual(
          result.fuzzy[i].score
        );
      }
    });

    it('should handle case-insensitive exact matches', () => {
      const result = fuzzyMatch('USERS', candidates);
      expect(result.exact).not.toBeNull();
      expect(result.exact?.value).toBe('users');
    });
  });

  describe('fuzzyMatchLegacy (backward compatibility)', () => {
    const candidates = ['users', 'orders', 'products'];

    it('should return flat array like old API', () => {
      const matches = fuzzyMatchLegacy('users', candidates);
      expect(Array.isArray(matches)).toBe(true);
      expect(matches[0].value).toBe('users');
      expect(matches[0].score).toBe(1);
    });

    it('should include exact match in array', () => {
      const matches = fuzzyMatchLegacy('orders', candidates);
      expect(matches[0].value).toBe('orders');
    });

    it('should return fuzzy matches when no exact', () => {
      const matches = fuzzyMatchLegacy('usres', candidates);
      expect(matches[0].value).toBe('users');
    });
  });

  describe('findBestMatch', () => {
    const candidates = ['users', 'orders', 'products'];

    it('should find the best match', () => {
      const match = findBestMatch('users', candidates);
      expect(match?.value).toBe('users');
    });

    it('should return null if no match meets threshold', () => {
      const match = findBestMatch('xyz', candidates, 0.9);
      expect(match).toBeNull();
    });

    it('should find best match for typos', () => {
      const match = findBestMatch('ordres', candidates);
      expect(match?.value).toBe('orders');
    });
  });

  describe('findExactMatch', () => {
    const candidates = ['users', 'Orders', 'PRODUCTS'];

    it('should find exact match (case insensitive)', () => {
      expect(findExactMatch('users', candidates)).toBe('users');
      expect(findExactMatch('USERS', candidates)).toBe('users');
      expect(findExactMatch('orders', candidates)).toBe('Orders');
      expect(findExactMatch('products', candidates)).toBe('PRODUCTS');
    });

    it('should return null if no exact match', () => {
      expect(findExactMatch('usres', candidates)).toBeNull();
      expect(findExactMatch('order', candidates)).toBeNull();
    });
  });

  describe('suggestTableNames', () => {
    const validTables = [
      'users',
      'orders',
      'products',
      'categories',
      'user_sessions',
    ];

    it('should return exists=true for exact match', () => {
      const result = suggestTableNames('users', validTables);
      expect(result.exists).toBe(true);
      expect(result.exactMatch).toBe('users');
      expect(result.suggestions).toHaveLength(0);
    });

    it('should return exists=true for case-insensitive match', () => {
      const result = suggestTableNames('USERS', validTables);
      expect(result.exists).toBe(true);
      expect(result.exactMatch).toBe('users');
    });

    it('should suggest alternatives for typos', () => {
      const result = suggestTableNames('usres', validTables);
      expect(result.exists).toBe(false);
      expect(result.exactMatch).toBeNull();
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0].value).toBe('users');
    });

    it('should respect maxSuggestions', () => {
      const result = suggestTableNames('u', validTables, 2);
      expect(result.suggestions.length).toBeLessThanOrEqual(2);
    });
  });

  describe('formatSuggestionMessage', () => {
    it('should format message with no suggestions', () => {
      const message = formatSuggestionMessage('xyz', []);
      expect(message).toContain("'xyz' not found");
    });

    it('should format message with suggestions', () => {
      const suggestions = [
        { value: 'users', score: 0.9, distance: 1 },
        { value: 'user_roles', score: 0.7, distance: 3 },
      ];
      const message = formatSuggestionMessage('usres', suggestions);
      expect(message).toContain("'usres' not found");
      expect(message).toContain('Did you mean');
      expect(message).toContain('users');
      expect(message).toContain('90%');
    });
  });
});
