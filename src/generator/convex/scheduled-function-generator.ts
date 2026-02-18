/**
 * Convex Scheduled Function Helpers Generator
 *
 * Generates per-table scheduled helper functions that use ctx.scheduler
 * to defer work after mutations. Common patterns:
 *
 * - Tables with expires_at: schedule self-deletion after creation
 * - Tables with status columns: schedule processing/retry after state changes
 * - Tables with created_at + no expiry: schedule follow-up notifications
 *
 * Docs: https://docs.convex.dev/scheduling/scheduled-functions
 */

import type { TableInfo } from '../../introspector/schema-introspector.js';
import { toCamelCase, toPascalCase } from '../../shared/types.js';

const EXPIRY_COLUMN_PATTERNS = [
  'expires_at',
  'expiry_at',
  'expiration_at',
  'valid_until',
];
const STATUS_COLUMN_PATTERNS = ['status', 'state'];

interface ScheduledHelperAnalysis {
  hasExpiry: boolean;
  expiryField: string | null;
  hasStatus: boolean;
  statusField: string | null;
}

function analyzeTable(table: TableInfo): ScheduledHelperAnalysis {
  const analysis: ScheduledHelperAnalysis = {
    hasExpiry: false,
    expiryField: null,
    hasStatus: false,
    statusField: null,
  };

  for (const col of table.columns) {
    const name = col.columnName.toLowerCase();
    if (
      !analysis.expiryField &&
      EXPIRY_COLUMN_PATTERNS.some((p) => name === p)
    ) {
      analysis.hasExpiry = true;
      analysis.expiryField = col.columnName;
    }
    if (
      !analysis.statusField &&
      STATUS_COLUMN_PATTERNS.some((p) => name === p)
    ) {
      analysis.hasStatus = true;
      analysis.statusField = col.columnName;
    }
  }

  return analysis;
}

function generateExpiryHelper(tableName: string, expiryField: string): string {
  const pascal = toPascalCase(tableName);
  const expiryFieldCamel = toCamelCase(expiryField);

  return `
/**
 * Schedules a ${tableName} document to be deleted when it expires.
 * Call this from your create mutation after inserting the document.
 *
 * @example
 *   const id = await ctx.db.insert("${tableName}", data);
 *   await scheduleExpiry${pascal}(ctx, id, data.${expiryFieldCamel});
 */
export const scheduleExpiry${pascal} = internalMutation({
  args: {
    id: v.id("${tableName}"),
    expiresAt: v.number(), // Unix ms timestamp
  },
  handler: async (ctx, args) => {
    const delay = args.expiresAt - Date.now();
    if (delay <= 0) {
      // Already expired — delete immediately
      await ctx.db.delete(args.id);
      return;
    }
    await ctx.scheduler.runAfter(delay, internal.${tableName}.scheduled.deleteExpired${pascal}, {
      id: args.id,
    });
  },
});

/**
 * Deletes a single expired ${tableName} document.
 * Called by scheduleExpiry${pascal} via the Convex scheduler.
 */
export const deleteExpired${pascal} = internalMutation({
  args: { id: v.id("${tableName}") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) return; // Already deleted
    await ctx.db.delete(args.id);
  },
});`;
}

function generateStatusHelper(tableName: string, statusField: string): string {
  const pascal = toPascalCase(tableName);
  const statusFieldCamel = toCamelCase(statusField);

  return `
/**
 * Schedules a retry for a ${tableName} document that is stuck in "pending" state.
 * Call this from your processing mutation to implement retry logic.
 *
 * @example
 *   await ctx.db.patch(id, { ${statusFieldCamel}: "processing" });
 *   await scheduleRetry${pascal}(ctx, id, { maxAttempts: 3, backoffMs: 5000 });
 */
export const scheduleRetry${pascal} = internalMutation({
  args: {
    id: v.id("${tableName}"),
    attempt: v.optional(v.number()),   // current attempt number (default: 1)
    maxAttempts: v.optional(v.number()), // max retries (default: 3)
    backoffMs: v.optional(v.number()),   // delay per attempt in ms (default: 5000)
  },
  handler: async (ctx, args) => {
    const attempt = args.attempt ?? 1;
    const maxAttempts = args.maxAttempts ?? 3;
    const backoffMs = args.backoffMs ?? 5000;

    if (attempt > maxAttempts) {
      await ctx.db.patch(args.id, { ${statusFieldCamel}: "failed" });
      return;
    }

    const delay = backoffMs * attempt; // linear backoff; swap for exponential if needed
    await ctx.scheduler.runAfter(delay, internal.${tableName}.scheduled.process${pascal}, {
      id: args.id,
      attempt,
      maxAttempts,
      backoffMs,
    });
  },
});

/**
 * Processes a single ${tableName} document.
 * Replace the placeholder logic below with your actual processing code.
 */
export const process${pascal} = internalMutation({
  args: {
    id: v.id("${tableName}"),
    attempt: v.number(),
    maxAttempts: v.number(),
    backoffMs: v.number(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.${statusFieldCamel} === "done") return;

    try {
      // TODO: add your processing logic here
      // await someExternalApi(doc);

      await ctx.db.patch(args.id, { ${statusFieldCamel}: "done" });
    } catch (err) {
      // Processing failed — schedule retry
      await ctx.db.patch(args.id, { ${statusFieldCamel}: "pending" });
      await ctx.scheduler.runAfter(0, internal.${tableName}.scheduled.scheduleRetry${pascal}, {
        id: args.id,
        attempt: args.attempt + 1,
        maxAttempts: args.maxAttempts,
        backoffMs: args.backoffMs,
      });
    }
  },
});`;
}

export interface ScheduledHelperResult {
  content: string;
  helperCount: number;
}

/**
 * Generates scheduled function helpers for a single table.
 * Returns empty content if no scheduling patterns are detected.
 */
export function generateScheduledHelpers(
  table: TableInfo
): ScheduledHelperResult {
  const analysis = analyzeTable(table);

  if (!analysis.hasExpiry && !analysis.hasStatus) {
    return { content: '', helperCount: 0 };
  }

  const helpers: string[] = [];
  let helperCount = 0;

  if (analysis.hasExpiry && analysis.expiryField) {
    helpers.push(generateExpiryHelper(table.tableName, analysis.expiryField));
    helperCount += 2; // scheduleExpiry + deleteExpired
  }

  if (analysis.hasStatus && analysis.statusField) {
    helpers.push(generateStatusHelper(table.tableName, analysis.statusField));
    helperCount += 3; // scheduleRetry + process + (implicit fail handler)
  }

  const content = `/**
 * Scheduled function helpers for ${table.tableName}
 *
 * Auto-generated by SunSetter AQM+.
 * These are internalMutations — they cannot be called from the client directly.
 *
 * Docs: https://docs.convex.dev/scheduling/scheduled-functions
 */

import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
${helpers.join('\n')}
`;

  return { content, helperCount };
}
