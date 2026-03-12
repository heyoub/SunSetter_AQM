/**
 * Canonical formatting utilities for human-readable display.
 *
 * This is the SINGLE SOURCE OF TRUTH for number/byte/duration formatting.
 * Every module must import from here — no private reimplementations.
 *
 * @module utils/formatting
 */

/**
 * Format a number with locale-appropriate thousand separators.
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format a byte count to human-readable units (B, KB, MB, GB, TB).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes < 1024 * 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
}

/**
 * Format a duration in seconds to a human-readable string.
 *
 * - Under 60s: `"42s"`
 * - Under 1h:  `"3m 42s"`
 * - 1h+:       `"2h 15m"`
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Format a duration in seconds to a compact clock-style string.
 * Useful for progress bars where space is tight.
 *
 * - Under 60s: `"42.1s"`
 * - Under 1h:  `"03:42"`
 * - 1h+:       `"02:15:42"`
 */
export function formatDurationCompact(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
