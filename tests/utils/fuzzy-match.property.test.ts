/**
 * Fuzzy Match Property-Based Tests
 *
 * Tests mathematical properties and invariants of the fuzzy matching algorithm.
 * These complement the example-based tests with exhaustive random testing.
 *
 * Updated for new combined API: fuzzyMatch returns { exact, fuzzy }
 */

import * as fc from 'fast-check';
import {
  levenshteinDistance,
  similarityScore,
  calculateSimilarity,
  fuzzyMatch,
  fuzzyMatchLegacy,
  findBestMatch,
  type FuzzyMatch,
} from '../../src/utils/fuzzy-match';

/**
 * Helper: Get all matches from fuzzyMatch result as flat array
 * Combines exact (if present) with fuzzy matches for easier property testing
 */
function getAllMatches(
  query: string,
  candidates: string[],
  threshold: number,
  maxResults?: number
): FuzzyMatch[] {
  const result = fuzzyMatch(query, candidates, threshold, maxResults);
  const all: FuzzyMatch[] = [];
  if (result.exact) all.push(result.exact);
  all.push(...result.fuzzy);
  return maxResults !== undefined ? all.slice(0, maxResults) : all;
}

describe('Fuzzy Match - Property Tests', () => {
  describe('levenshteinDistance properties', () => {
    /**
     * PROPERTY: Identity
     * The distance from a string to itself is always 0
     */
    it('should return 0 for identical strings (identity)', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 100 }), (str) => {
          expect(levenshteinDistance(str, str)).toBe(0);
        })
      );
    });

    /**
     * PROPERTY: Symmetry
     * dist(a, b) = dist(b, a)
     */
    it('should be symmetric', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 50 }),
          fc.string({ maxLength: 50 }),
          (a, b) => {
            expect(levenshteinDistance(a, b)).toBe(levenshteinDistance(b, a));
          }
        )
      );
    });

    /**
     * PROPERTY: Non-negativity
     * Distance is always >= 0
     */
    it('should always return non-negative', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 50 }),
          fc.string({ maxLength: 50 }),
          (a, b) => {
            expect(levenshteinDistance(a, b)).toBeGreaterThanOrEqual(0);
          }
        )
      );
    });

    /**
     * PROPERTY: Triangle inequality
     * dist(a, c) <= dist(a, b) + dist(b, c)
     */
    it('should satisfy triangle inequality', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 20 }),
          fc.string({ maxLength: 20 }),
          fc.string({ maxLength: 20 }),
          (a, b, c) => {
            const ab = levenshteinDistance(a, b);
            const bc = levenshteinDistance(b, c);
            const ac = levenshteinDistance(a, c);
            expect(ac).toBeLessThanOrEqual(ab + bc);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * PROPERTY: Empty string distance
     * dist(s, "") = len(s)
     */
    it('should equal string length when compared to empty', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 100 }), (str) => {
          expect(levenshteinDistance(str, '')).toBe(str.length);
          expect(levenshteinDistance('', str)).toBe(str.length);
        })
      );
    });

    /**
     * PROPERTY: Upper bound
     * dist(a, b) <= max(len(a), len(b))
     */
    it('should be bounded by max string length', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 50 }),
          fc.string({ maxLength: 50 }),
          (a, b) => {
            const dist = levenshteinDistance(a, b);
            expect(dist).toBeLessThanOrEqual(Math.max(a.length, b.length));
          }
        )
      );
    });

    /**
     * PROPERTY: Single edit difference
     * Strings differing by one character have distance 1
     */
    it('should return 1 for single character insertion', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 50 }),
          fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
          (str, pos, char) => {
            const insertPos = Math.min(pos, str.length);
            const modified =
              str.slice(0, insertPos) + char + str.slice(insertPos);
            expect(levenshteinDistance(str, modified)).toBe(1);
          }
        )
      );
    });
  });

  describe('similarityScore properties', () => {
    /**
     * PROPERTY: Range
     * Similarity is always between 0 and 1
     */
    it('should return value between 0 and 1', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 50 }),
          fc.string({ maxLength: 50 }),
          (a, b) => {
            const score = similarityScore(a, b);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1);
          }
        )
      );
    });

    /**
     * PROPERTY: Identity
     * Identical strings have similarity 1
     */
    it('should return 1 for identical strings', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 100 }), (str) => {
          expect(similarityScore(str, str)).toBe(1);
        })
      );
    });

    /**
     * PROPERTY: Symmetry
     * similarity(a, b) = similarity(b, a)
     */
    it('should be symmetric', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 50 }),
          fc.string({ maxLength: 50 }),
          (a, b) => {
            expect(similarityScore(a, b)).toBe(similarityScore(b, a));
          }
        )
      );
    });

    /**
     * PROPERTY: Case insensitivity
     * similarity ignores case
     */
    it('should be case insensitive', () => {
      fc.assert(
        fc.property(fc.stringMatching(/^[a-zA-Z]{1,30}$/), (str) => {
          expect(similarityScore(str.toLowerCase(), str.toUpperCase())).toBe(1);
        })
      );
    });

    /**
     * PROPERTY: Similarity and distance relationship
     * For same-length strings, higher similarity correlates with lower distance
     */
    it('should correlate similarity with distance for same-length strings', () => {
      fc.assert(
        fc.property(fc.stringMatching(/^[a-z]{5,10}$/), (str) => {
          // Compare string with itself (max similarity, min distance)
          const simSame = similarityScore(str, str);
          const distSame = levenshteinDistance(str, str);

          expect(simSame).toBe(1);
          expect(distSame).toBe(0);

          // Compare with completely different string of same length
          const different = 'x'.repeat(str.length);
          const simDiff = similarityScore(str, different);
          const distDiff = levenshteinDistance(str, different);

          // Different should have lower similarity and higher distance
          expect(simDiff).toBeLessThan(simSame);
          expect(distDiff).toBeGreaterThan(distSame);
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('fuzzyMatch properties (new combined API)', () => {
    /**
     * PROPERTY: Sorted by score descending
     * Fuzzy results are always sorted with highest score first
     */
    it('should return fuzzy results sorted by score descending', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            minLength: 1,
            maxLength: 10,
          }),
          (query, candidates) => {
            const result = fuzzyMatch(query, candidates, 0);
            // Check fuzzy array is sorted
            for (let i = 1; i < result.fuzzy.length; i++) {
              expect(result.fuzzy[i - 1].score).toBeGreaterThanOrEqual(
                result.fuzzy[i].score
              );
            }
          }
        )
      );
    });

    /**
     * PROPERTY: Threshold filtering
     * All fuzzy results have score >= threshold
     */
    it('should filter by threshold', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            minLength: 1,
            maxLength: 10,
          }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (query, candidates, threshold) => {
            const result = fuzzyMatch(query, candidates, threshold);
            for (const match of result.fuzzy) {
              expect(match.score).toBeGreaterThanOrEqual(threshold);
            }
            // Exact match always has score 1, which is >= any threshold
            if (result.exact) {
              expect(result.exact.score).toBe(1);
            }
          }
        )
      );
    });

    /**
     * PROPERTY: maxResults limiting
     * Never returns more than maxResults items in fuzzy array
     */
    it('should respect maxResults limit', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 15 }),
          fc.array(fc.string({ minLength: 1, maxLength: 15 }), {
            minLength: 5,
            maxLength: 20,
          }),
          fc.integer({ min: 1, max: 10 }),
          (query, candidates, maxResults) => {
            const result = fuzzyMatch(query, candidates, 0, maxResults);
            expect(result.fuzzy.length).toBeLessThanOrEqual(maxResults);
          }
        )
      );
    });

    /**
     * PROPERTY: Exact match returns in exact field with score 1
     */
    it('should give exact matches score 1 in exact field', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            maxLength: 10,
          }),
          (query, otherCandidates) => {
            // Include the query in candidates
            const candidates = [query, ...otherCandidates];
            const result = fuzzyMatch(query, candidates, 0);

            // Exact match should be in exact field
            expect(result.exact).not.toBeNull();
            expect(result.exact!.score).toBe(1);
            expect(result.exact!.value.toLowerCase()).toBe(query.toLowerCase());
            // Early termination means fuzzy is empty
            expect(result.fuzzy).toHaveLength(0);
          }
        )
      );
    });

    /**
     * PROPERTY: Empty candidates returns null exact and empty fuzzy
     */
    it('should return null exact and empty fuzzy for empty candidates', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 20 }), (query) => {
          const result = fuzzyMatch(query, [], 0);
          expect(result.exact).toBeNull();
          expect(result.fuzzy).toHaveLength(0);
        })
      );
    });

    /**
     * PROPERTY: Early termination for exact matches
     * When exact match found, fuzzy array is empty (no extra work done)
     */
    it('should early terminate when exact match found', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            minLength: 3,
            maxLength: 10,
          }),
          (query, otherCandidates) => {
            // Put exact match anywhere in list
            const insertPos = Math.floor(
              Math.random() * otherCandidates.length
            );
            const candidates = [...otherCandidates];
            candidates.splice(insertPos, 0, query);

            const result = fuzzyMatch(query, candidates, 0);

            // Should find exact match
            expect(result.exact).not.toBeNull();
            // Fuzzy should be empty due to early termination
            expect(result.fuzzy).toHaveLength(0);
          }
        )
      );
    });
  });

  describe('calculateSimilarity properties', () => {
    /**
     * PROPERTY: Returns both score and distance
     */
    it('should return consistent score and distance', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 50 }),
          fc.string({ maxLength: 50 }),
          (a, b) => {
            const { score, distance } = calculateSimilarity(a, b);
            // Score and distance should be consistent with individual functions
            expect(score).toBe(similarityScore(a, b));
            expect(distance).toBe(
              levenshteinDistance(a.toLowerCase(), b.toLowerCase())
            );
          }
        )
      );
    });
  });

  describe('fuzzyMatchLegacy backward compatibility', () => {
    /**
     * PROPERTY: Legacy API returns flat array
     */
    it('should return flat array like old API', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            minLength: 1,
            maxLength: 10,
          }),
          (query, candidates) => {
            const results = fuzzyMatchLegacy(query, candidates, 0);
            expect(Array.isArray(results)).toBe(true);
          }
        )
      );
    });
  });

  describe('findBestMatch properties', () => {
    /**
     * PROPERTY: Best match returns exact or top fuzzy
     * findBestMatch returns exact match if present, otherwise first fuzzy
     */
    it('should return exact match or first fuzzy result', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            minLength: 1,
            maxLength: 10,
          }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (query, candidates, threshold) => {
            const best = findBestMatch(query, candidates, threshold);
            const result = fuzzyMatch(query, candidates, threshold, 1);

            if (!result.exact && result.fuzzy.length === 0) {
              expect(best).toBeNull();
            } else if (result.exact) {
              expect(best).not.toBeNull();
              expect(best!.value).toBe(result.exact.value);
              expect(best!.score).toBe(result.exact.score);
            } else {
              expect(best).not.toBeNull();
              expect(best!.value).toBe(result.fuzzy[0].value);
              expect(best!.score).toBe(result.fuzzy[0].score);
            }
          }
        )
      );
    });

    /**
     * PROPERTY: Returns null when no match above threshold
     */
    it('should return null when nothing meets threshold', () => {
      // Use completely different strings and high threshold
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-z]{5,10}$/),
          fc.stringMatching(/^[0-9]{5,10}$/),
          (query, candidate) => {
            // Letters vs numbers should have very low similarity
            const best = findBestMatch(query, [candidate], 0.99);
            expect(best).toBeNull();
          }
        )
      );
    });
  });
});

// ============================================================================
// DETERMINISTIC REPRODUCIBILITY TESTS
// ============================================================================

describe('Fuzzy Match - Deterministic Tests', () => {
  /**
   * Tests with fixed seed for reproducibility
   */
  it('should produce consistent results with same seed', () => {
    const seed = 12345;

    // Run property test with fixed seed
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
          minLength: 1,
          maxLength: 5,
        }),
        (query, candidates) => {
          const result1 = fuzzyMatch(query, candidates, 0.5);
          const result2 = fuzzyMatch(query, candidates, 0.5);

          // Same input should always give same output
          // Check exact match
          if (result1.exact) {
            expect(result2.exact).not.toBeNull();
            expect(result1.exact.value).toBe(result2.exact!.value);
            expect(result1.exact.score).toBe(result2.exact!.score);
          } else {
            expect(result2.exact).toBeNull();
          }

          // Check fuzzy matches
          expect(result1.fuzzy.length).toBe(result2.fuzzy.length);
          for (let i = 0; i < result1.fuzzy.length; i++) {
            expect(result1.fuzzy[i].value).toBe(result2.fuzzy[i].value);
            expect(result1.fuzzy[i].score).toBe(result2.fuzzy[i].score);
          }
        }
      ),
      { seed, numRuns: 100 }
    );
  });
});
