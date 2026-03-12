# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.1] - 2026-03-12

### Fixed

- Ensured npm pack/publish always builds `dist/` via `prepack`
- Corrected the published package contents for the next npm release

## [1.6.0] - 2026-03-12

### Changed

- Relicensed the project to `GPL-3.0-or-later`
- Updated package metadata and public docs to reflect the GPL license

### Fixed

- Added schema normalization to dedupe duplicate columns, foreign keys, and indexes before generation
- Fixed generated `schema.ts` output to include trailing commas after each table definition
- Prevented duplicate Convex `.index()` and duplicate `getBy...` query generation when introspection returns overlapping metadata
- Stopped emitting `withSearchIndex(...)` queries unless search indexes are actually enabled in the generated schema
- Mapped PostgreSQL `vector(...)` columns to Convex float arrays and added runtime pgvector transformation support for migration data

## [1.0.0] - 2025-06-25

### Added

- Initial release of TypeScript ESM Database Code Generator
- PostgreSQL database schema introspection
- TypeScript model generation
- Repository pattern class generation
- Service layer class generation
- Zod validation schema generation support
- Class-validator validation support
- Convex schema generation support
- CLI interface with multiple commands
- Configuration management system
- Comprehensive type mapping for PostgreSQL to TypeScript
- Support for primary keys, foreign keys, and indexes
- Nullable and optional field handling
- ESM module support
- Husky pre-commit hooks
- ESLint and Prettier configuration
- Jest testing framework setup

### Features

- `generate` command - Generate TypeScript code from database schema
- `introspect` command - Inspect database schema and display information
- `test-connection` command - Test database connectivity
- Configurable output directory
- SSL connection support
- Customizable type mappings
- Multiple validation library support
