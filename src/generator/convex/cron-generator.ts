/**
 * Convex Cron Job Generator
 *
 * Analyzes table schema to produce a starter convex/crons.ts file.
 * Detects common patterns (timestamp columns, status enums, expiry columns)
 * and generates appropriate cron jobs using internalMutation.
 *
 * Based on the Convex cron jobs API:
 * https://docs.convex.dev/scheduling/cron-jobs
 */

import type { TableInfo, ColumnInfo } from '../../introspector/schema-introspector.js';

// Column name patterns that indicate timestamp-based cleanup opportunities
const CREATED_AT_PATTERNS = ['created_at', 'createdat', 'created_on', 'createdon'];
const EXPIRY_PATTERNS = [
  'expires_at', 'expiresat', 'expiry_at', 'expiry', 'expired_at',
  'expiration_at', 'valid_until', 'valid_to',
];
const SOFT_DELETE_PATTERNS = ['deleted_at', 'deletedat', 'soft_deleted_at'];
const STATUS_PATTERNS = ['status', 'state'];
const PENDING_STATUS_VALUES = ['pending', 'processing', 'queued', 'waiting', 'in_progress'];

interface TableCronAnalysis {
  tableName: string;
  hasCreatedAt: boolean;
  hasExpiry: boolean;
  hasSoftDelete: boolean;
  hasStatusColumn: boolean;
  createdAtField: string | null;
  expiryField: string | null;
  softDeleteField: string | null;
  statusField: string | null;
}

function analyzeTable(table: TableInfo): TableCronAnalysis {
  const analysis: TableCronAnalysis = {
    tableName: table.tableName,
    hasCreatedAt: false,
    hasExpiry: false,
    hasSoftDelete: false,
    hasStatusColumn: false,
    createdAtField: null,
    expiryField: null,
    softDeleteField: null,
    statusField: null,
  };

  for (const col of table.columns) {
    const name = col.columnName.toLowerCase();

    if (!analysis.createdAtField && CREATED_AT_PATTERNS.some(p => name === p)) {
      analysis.hasCreatedAt = true;
      analysis.createdAtField = col.columnName;
    }
    if (!analysis.expiryField && EXPIRY_PATTERNS.some(p => name === p)) {
      analysis.hasExpiry = true;
      analysis.expiryField = col.columnName;
    }
    if (!analysis.softDeleteField && SOFT_DELETE_PATTERNS.some(p => name === p)) {
      analysis.hasSoftDelete = true;
      analysis.softDeleteField = col.columnName;
    }
    if (!analysis.statusField && STATUS_PATTERNS.some(p => name === p)) {
      analysis.hasStatusColumn = true;
      analysis.statusField = col.columnName;
    }
  }

  return analysis;
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
}

function toPascalCase(str: string): string {
  const c = toCamelCase(str);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function generateCleanupMutation(analysis: TableCronAnalysis): string {
  const pascal = toPascalCase(analysis.tableName);
  const camel = toCamelCase(analysis.tableName);

  if (analysis.hasExpiry && analysis.expiryField) {
    const field = toCamelCase(analysis.expiryField);
    return `
// Deletes ${analysis.tableName} documents whose ${analysis.expiryField} has passed.
export const deleteExpired${pascal} = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("${analysis.tableName}")
      .filter((q) => q.lt(q.field("${field}"), now))
      .collect();

    await Promise.all(expired.map((doc) => ctx.db.delete(doc._id)));
    console.log(\`[cron] Deleted \${expired.length} expired ${analysis.tableName} records\`);
  },
});`;
  }

  if (analysis.hasSoftDelete && analysis.softDeleteField) {
    const field = toCamelCase(analysis.softDeleteField);
    // Hard-delete records soft-deleted more than 30 days ago
    return `
// Permanently removes ${analysis.tableName} records that were soft-deleted over 30 days ago.
export const purgeDeleted${pascal} = internalMutation({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const stale = await ctx.db
      .query("${analysis.tableName}")
      .filter((q) =>
        q.and(
          q.neq(q.field("${field}"), null),
          q.lt(q.field("${field}"), thirtyDaysAgo)
        )
      )
      .collect();

    await Promise.all(stale.map((doc) => ctx.db.delete(doc._id)));
    console.log(\`[cron] Purged \${stale.length} soft-deleted ${analysis.tableName} records\`);
  },
});`;
  }

  if (analysis.hasCreatedAt && analysis.createdAtField) {
    const field = toCamelCase(analysis.createdAtField);
    // Stub: clean up old anonymous / ephemeral records (age > 90 days, no other FKs)
    return `
// Removes ${analysis.tableName} records older than 90 days.
// Adjust the retention window to match your data retention policy.
export const cleanupOld${pascal} = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const old = await ctx.db
      .query("${analysis.tableName}")
      .filter((q) => q.lt(q.field("${field}"), ninetyDaysAgo))
      .collect();

    await Promise.all(old.map((doc) => ctx.db.delete(doc._id)));
    console.log(\`[cron] Cleaned up \${old.length} old ${analysis.tableName} records\`);
  },
});`;
  }

  return '';
}

function generateStuckStatusMutation(analysis: TableCronAnalysis): string {
  if (!analysis.hasStatusColumn || !analysis.statusField) return '';

  const pascal = toPascalCase(analysis.tableName);
  const statusField = toCamelCase(analysis.statusField);

  return `
// Resets ${analysis.tableName} records stuck in "processing" state for over 10 minutes.
// Prevents jobs from being permanently stuck if a worker crashes mid-processing.
export const resetStuck${pascal} = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const stuck = await ctx.db
      .query("${analysis.tableName}")
      .filter((q) =>
        q.and(
          q.eq(q.field("${statusField}"), "processing"),
          q.lt(q.field("_creationTime"), tenMinutesAgo)
        )
      )
      .collect();

    await Promise.all(
      stuck.map((doc) =>
        ctx.db.patch(doc._id, { ${statusField}: "pending" })
      )
    );
    console.log(\`[cron] Reset \${stuck.length} stuck ${analysis.tableName} records\`);
  },
});`;
}

interface CronSchedule {
  method: string;
  args: string;
  description: string;
  mutationRef: string;
}

function buildCronSchedule(analysis: TableCronAnalysis): CronSchedule[] {
  const camel = toCamelCase(analysis.tableName);
  const pascal = toPascalCase(analysis.tableName);
  const schedules: CronSchedule[] = [];

  if (analysis.hasExpiry) {
    schedules.push({
      method: 'crons.hourly',
      args: '{ minuteUTC: 0 }',
      description: `Delete expired ${analysis.tableName}`,
      mutationRef: `internal.crons.deleteExpired${pascal}`,
    });
  } else if (analysis.hasSoftDelete) {
    schedules.push({
      method: 'crons.daily',
      args: '{ hourUTC: 3, minuteUTC: 0 }',
      description: `Purge soft-deleted ${analysis.tableName}`,
      mutationRef: `internal.crons.purgeDeleted${pascal}`,
    });
  } else if (analysis.hasCreatedAt) {
    schedules.push({
      method: 'crons.weekly',
      args: '{ dayOfWeek: "Sunday", hourUTC: 2, minuteUTC: 0 }',
      description: `Clean up old ${analysis.tableName}`,
      mutationRef: `internal.crons.cleanupOld${pascal}`,
    });
  }

  if (analysis.hasStatusColumn) {
    schedules.push({
      method: 'crons.interval',
      args: '{ minutes: 10 }',
      description: `Reset stuck ${analysis.tableName} jobs`,
      mutationRef: `internal.crons.resetStuck${pascal}`,
    });
  }

  return schedules;
}

export interface CronGeneratorResult {
  content: string;
  cronCount: number;
  mutationCount: number;
}

/**
 * Analyzes a set of tables and generates a complete convex/crons.ts file.
 */
export function generateCrons(tables: TableInfo[]): CronGeneratorResult {
  const analyses = tables.map(analyzeTable).filter(a =>
    a.hasExpiry || a.hasSoftDelete || a.hasCreatedAt || a.hasStatusColumn
  );

  if (analyses.length === 0) {
    return {
      content: generateEmptyCronsFile(),
      cronCount: 0,
      mutationCount: 0,
    };
  }

  const allMutations: string[] = [];
  const allSchedules: CronSchedule[] = [];

  for (const analysis of analyses) {
    const cleanupMutation = generateCleanupMutation(analysis);
    const stuckMutation = generateStuckStatusMutation(analysis);

    if (cleanupMutation) allMutations.push(cleanupMutation);
    if (stuckMutation) allMutations.push(stuckMutation);

    const schedules = buildCronSchedule(analysis);
    allSchedules.push(...schedules);
  }

  const cronLines = allSchedules.map(s =>
    `crons.${s.method.replace('crons.', '')}(\n  "${s.description}",\n  ${s.args},\n  ${s.mutationRef}\n);`
  );

  const content = `/**
 * Convex Cron Jobs
 *
 * Auto-generated by SunSetter AQM+ based on schema analysis.
 * Review each cron job before deploying to production.
 *
 * Docs: https://docs.convex.dev/scheduling/cron-jobs
 */

import { cronJobs } from "convex/server";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Cron Jobs
// ─────────────────────────────────────────────────────────────────────────────

${cronLines.join('\n\n')}

export default crons;

// ─────────────────────────────────────────────────────────────────────────────
// Internal Mutations (called by crons above)
// ─────────────────────────────────────────────────────────────────────────────

${allMutations.join('\n')}
`;

  return {
    content,
    cronCount: allSchedules.length,
    mutationCount: allMutations.length,
  };
}

function generateEmptyCronsFile(): string {
  return `/**
 * Convex Cron Jobs
 *
 * Auto-generated by SunSetter AQM+.
 * No cron-eligible patterns (expires_at, deleted_at, status) were detected
 * in the source schema. Add your own cron jobs below.
 *
 * Docs: https://docs.convex.dev/scheduling/cron-jobs
 *
 * Example:
 *   crons.daily("Send daily digest", { hourUTC: 8, minuteUTC: 0 }, internal.emails.sendDigest);
 */

import { cronJobs } from "convex/server";

const crons = cronJobs();

// Add cron jobs here...

export default crons;
`;
}
