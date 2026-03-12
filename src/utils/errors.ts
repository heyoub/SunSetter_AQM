/**
 * Canonical error-handling utilities.
 *
 * This is the SINGLE SOURCE OF TRUTH for safely extracting errors
 * from `catch (unknown)` blocks. Every module must use `toError()`
 * instead of `(error as Error)` casts.
 *
 * @module utils/errors
 */

/**
 * Safely convert an unknown caught value to an `Error` instance.
 *
 * Replaces the unsafe `(error as Error)` pattern that crashes
 * if a non-Error value (string, null, number) is thrown.
 *
 * @example
 * ```ts
 * try { ... } catch (caught) {
 *   const error = toError(caught);
 *   console.error(error.message); // always safe
 * }
 * ```
 */
export function toError(caught: unknown): Error {
  if (caught instanceof Error) {
    return caught;
  }
  if (typeof caught === 'string') {
    return new Error(caught);
  }
  if (typeof caught === 'object' && caught !== null) {
    return new Error(JSON.stringify(caught));
  }
  return new Error(String(caught));
}

/**
 * Extract the error message from an unknown caught value.
 * Shorthand for `toError(caught).message`.
 */
export function toErrorMessage(caught: unknown): string {
  return toError(caught).message;
}
