# Refactoring Progress

## Phase 1: Shared Utilities Consolidation — COMPLETE

### New canonical files created:
- `src/utils/naming.ts` — toCamelCase, toPascalCase, toKebabCase, toSnakeCase, escapeFieldName, isReservedWord, isValidIdentifier, toValidIdentifier, sanitizeTableName, sanitizeColumnName
- `src/utils/formatting.ts` — formatNumber, formatBytes, formatDuration, formatDurationCompact
- `src/utils/errors.ts` — toError, toErrorMessage

### Files modified (imports updated):
- 9 generator files: replaced private method copies with imports from utils/naming.ts
- 5 non-generator files (mapper/type-mapper, migration/data-transformer, cli/commands/seed-export, convex/convex-schema-generator, convex/index-suggestion-generator)
- 3 formatting files (tui/branding, cli/progress-bar, mcp/server)
- 8 files: replaced unsafe `(error as Error)` with `toError()` from utils/errors.ts
- shared/types.ts: now re-exports from utils/naming.ts
- utils/index.ts: updated to export all new modules

### Files deleted (truly dead):
- src/config/config-manager.ts (obsolete, replaced by config-loader.ts)
- src/utils/db-utils.ts (utilities consolidated into utils/naming.ts)

### Validation:
- TypeScript: 0 new errors introduced
- Tests: 386/386 passing, 16/16 suites

## Remaining Phases (not yet started):
- Phase 2: Unify Type Mapper (merge multi-DB from database-type-mapper into convex-type-mapper)
- Phase 3: Kill Dual Database Abstraction (IDatabaseConnection → DatabaseAdapter)
- Phase 4: Wire In Disconnected Features (hooks, summary report, check constraints, circuit breaker, verification, rollback fix, progress bar)
- Phase 5: Wire In Error System (typed error classes replace throw new Error)
- Phase 6: Fix Broken Flows (HTTP actions, React hooks, SQLite cursor, rate limits, etc.)
- Phase 7: Generator Base Class
- Phase 8: Merge Wizard Features
- Phase 9: Extract index.ts Commands + Adopt Logger
