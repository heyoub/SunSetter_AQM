/**
 * Convex Function Generator
 *
 * Main orchestrator that coordinates all Convex code generators.
 * Produces a complete Convex project structure from PostgreSQL schema.
 *
 * Generators included:
 * - SchemaGenerator: Generates schema.ts with table definitions, indexes, search indexes, vector indexes
 * - QueryGenerator: Generates query functions (get, list, getBy*, search, count)
 * - MutationGenerator: Generates mutation functions (create, update, remove, batch*)
 * - ValidatorGenerator: Generates reusable validator objects
 * - TypeGenerator: Generates TypeScript type definitions
 * - ActionGenerator: Generates action functions for external API calls
 * - HttpActionGenerator: Generates HTTP action functions for REST endpoints
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { TableInfo } from '../../introspector/schema-introspector.js';
import { normalizeTables } from '../../introspector/normalize-schema.js';
import type {
  ConvexFunctionGeneratorOptions,
  ConvexGeneratedOutput,
  GeneratedTableFiles,
} from '../../convex/types.js';
import { SchemaGenerator } from './schema-generator.js';
import { QueryGenerator } from './query-generator.js';
import { MutationGenerator } from './mutation-generator.js';
import { ValidatorGenerator } from './validator-generator.js';
import { TypeGenerator } from './type-generator.js';
import { ActionGenerator } from './action-generator.js';
import { HttpActionGenerator } from './http-action-generator.js';
import { generateCrons } from './cron-generator.js';
import { generateComponentConfig } from './component-config-generator.js';
import { generateScheduledHelpers } from './scheduled-function-generator.js';
import { generateAuth } from './auth-generator.js';
import { toCamelCase, toPascalCase } from '../../utils/naming.js';

// Re-export base class and individual generators
export { BaseConvexGenerator } from './base-convex-generator.js';
export type { BaseGeneratorOptions } from './base-convex-generator.js';
export { SchemaGenerator } from './schema-generator.js';
export { QueryGenerator } from './query-generator.js';
export { MutationGenerator } from './mutation-generator.js';
export { ValidatorGenerator } from './validator-generator.js';
export { TypeGenerator } from './type-generator.js';
export { ActionGenerator } from './action-generator.js';
export { HttpActionGenerator } from './http-action-generator.js';
export { generateCrons } from './cron-generator.js';
export { generateComponentConfig } from './component-config-generator.js';
export { generateScheduledHelpers } from './scheduled-function-generator.js';
export { generateAuth, detectAuthTable } from './auth-generator.js';

// Re-export types from schema-generator
export type {
  SearchIndexConfig,
  VectorIndexConfig,
  SchemaGeneratorOptions,
} from './schema-generator.js';
export type { ActionGeneratorOptions } from './action-generator.js';
export type { HttpActionGeneratorOptions } from './http-action-generator.js';

/**
 * Default generator options
 */
const DEFAULT_OPTIONS: ConvexFunctionGeneratorOptions = {
  outputDir: './convex',
  generateQueries: true,
  generateMutations: true,
  generateValidators: true,
  generateTypes: true,
  generateActions: false,
  generateHttpActions: false,
  generateSearchIndexes: false,
  generateVectorIndexes: false,
  separateFiles: true,
  includeComments: true,
  convexApiVersion: '1.30',
  defaultVectorDimensions: 1536,
  useStagedIndexes: false,
  generateCrons: true,
  generateComponentConfig: true,
  generateScheduledHelpers: true,
  generateAuth: true,
};

/**
 * Main Convex function generator orchestrator
 */
export class ConvexFunctionGenerator {
  private options: ConvexFunctionGeneratorOptions;
  private schemaGenerator: SchemaGenerator;
  private queryGenerator: QueryGenerator;
  private mutationGenerator: MutationGenerator;
  private validatorGenerator: ValidatorGenerator;
  private typeGenerator: TypeGenerator;
  private actionGenerator: ActionGenerator;
  private httpActionGenerator: HttpActionGenerator;

  constructor(options: Partial<ConvexFunctionGeneratorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Initialize schema generator with search/vector index options
    this.schemaGenerator = new SchemaGenerator({
      generateSearchIndexes: this.options.generateSearchIndexes,
      generateVectorIndexes: this.options.generateVectorIndexes,
      defaultVectorDimensions: this.options.defaultVectorDimensions,
      useStagedIndexes: this.options.useStagedIndexes,
    });

    // Pass API version to query and mutation generators
    this.queryGenerator = new QueryGenerator({
      convexApiVersion: this.options.convexApiVersion,
      generateSearchQueries: this.options.generateSearchIndexes,
    });
    this.mutationGenerator = new MutationGenerator({
      convexApiVersion: this.options.convexApiVersion,
    });
    this.validatorGenerator = new ValidatorGenerator();
    this.typeGenerator = new TypeGenerator();

    // Initialize action generators
    this.actionGenerator = new ActionGenerator({
      convexApiVersion: this.options.convexApiVersion,
    });
    this.httpActionGenerator = new HttpActionGenerator({
      convexApiVersion: this.options.convexApiVersion,
    });
  }

  /**
   * Generate all Convex code for the given tables
   */
  generate(tables: TableInfo[]): ConvexGeneratedOutput {
    const normalizedTables = normalizeTables(tables);

    const output: ConvexGeneratedOutput = {
      schema: '',
      tables: new Map(),
      indexFile: '',
      httpFile: undefined,
      stats: {
        totalTables: normalizedTables.length,
        totalQueries: 0,
        totalMutations: 0,
        totalValidators: 0,
        totalTypes: 0,
        totalActions: 0,
        totalHttpActions: 0,
        totalSearchIndexes:
          this.schemaGenerator.getSearchIndexCount(normalizedTables),
        totalVectorIndexes:
          this.schemaGenerator.getVectorIndexCount(normalizedTables),
      },
    };

    // 1. Generate main schema.ts (includes search and vector indexes if enabled)
    output.schema = this.schemaGenerator.generate(normalizedTables);

    // 2. Generate per-table files
    for (const table of normalizedTables) {
      const tableFiles = this.generateTableFiles(table);
      output.tables.set(table.tableName, tableFiles);

      // Update stats
      output.stats.totalQueries += tableFiles.queryCount;
      output.stats.totalMutations += tableFiles.mutationCount;
      output.stats.totalValidators += tableFiles.validatorCount;
      output.stats.totalTypes += tableFiles.typeCount;
      output.stats.totalActions += tableFiles.actionCount;
      output.stats.totalHttpActions += tableFiles.httpActionCount;
    }

    // 3. Generate index file
    output.indexFile = this.generateIndexFile(normalizedTables);

    // 4. Generate HTTP routes file if HTTP actions are enabled
    if (this.options.generateHttpActions) {
      output.httpFile =
        this.httpActionGenerator.generateHttpFile(normalizedTables);
    }

    // 5. Generate crons.ts
    if (this.options.generateCrons !== false) {
      output.cronsFile = generateCrons(normalizedTables).content;
    }

    // 6. Generate convex.config.ts
    if (this.options.generateComponentConfig !== false) {
      output.componentConfigFile =
        generateComponentConfig(normalizedTables).content;
    }

    // 7. Generate auth files if users table detected
    if (this.options.generateAuth !== false) {
      const authResult = generateAuth(normalizedTables);
      if (authResult.detected) {
        output.authFile = authResult.authTs;
        output.authConfigFile = authResult.authConfigTs;
      }
    }

    // 8. Generate scheduled helpers per table
    if (this.options.generateScheduledHelpers !== false) {
      for (const table of normalizedTables) {
        const helpers = generateScheduledHelpers(table);
        if (helpers.content) {
          const tableFiles = output.tables.get(table.tableName);
          if (tableFiles) {
            tableFiles.scheduledHelpers = helpers.content;
          }
        }
      }
    }

    return output;
  }

  /**
   * Generate all files for a single table
   */
  private generateTableFiles(table: TableInfo): GeneratedTableFiles {
    const files: GeneratedTableFiles = {
      queries: '',
      mutations: '',
      validators: '',
      types: '',
      actions: '',
      httpActions: '',
      queryCount: 0,
      mutationCount: 0,
      validatorCount: 0,
      typeCount: 0,
      actionCount: 0,
      httpActionCount: 0,
    };

    if (this.options.generateQueries) {
      const result = this.queryGenerator.generate(table);
      files.queries = result.content;
      files.queryCount = result.count;
    }

    if (this.options.generateMutations) {
      const result = this.mutationGenerator.generate(table);
      files.mutations = result.content;
      files.mutationCount = result.count;
    }

    if (this.options.generateValidators) {
      const result = this.validatorGenerator.generate(table);
      files.validators = result.content;
      files.validatorCount = result.count;
    }

    if (this.options.generateTypes) {
      const result = this.typeGenerator.generate(table);
      files.types = result.content;
      files.typeCount = result.count;
    }

    if (this.options.generateActions) {
      const result = this.actionGenerator.generate(table);
      files.actions = result.content;
      files.actionCount = result.count;
    }

    if (this.options.generateHttpActions) {
      const result = this.httpActionGenerator.generate(table);
      files.httpActions = result.content;
      files.httpActionCount = result.count;
    }

    return files;
  }

  /**
   * Generate main index file that re-exports everything
   */
  private generateIndexFile(tables: TableInfo[]): string {
    const lines: string[] = [
      '// Generated Convex index file',
      '// Do not edit this file directly - it will be overwritten',
      '',
    ];

    // Export schema
    lines.push('// Schema');
    lines.push('export { default as schema } from "./schema";');
    lines.push('');

    // Per-table exports
    for (const table of tables) {
      const pascalName = toPascalCase(table.tableName);
      const camelName = toCamelCase(table.tableName);

      lines.push(`// ${pascalName}`);

      if (this.options.generateQueries) {
        lines.push(
          `export * as ${camelName}Queries from "./${table.tableName}/queries";`
        );
      }
      if (this.options.generateMutations) {
        lines.push(
          `export * as ${camelName}Mutations from "./${table.tableName}/mutations";`
        );
      }
      if (this.options.generateValidators) {
        lines.push(
          `export { ${camelName}Validators } from "./${table.tableName}/validators";`
        );
      }
      if (this.options.generateTypes) {
        lines.push(
          `export type { ${pascalName}, Create${pascalName}Input, Update${pascalName}Input, ${pascalName}ListResponse } from "./${table.tableName}/types";`
        );
      }
      if (this.options.generateActions) {
        lines.push(
          `export * as ${camelName}Actions from "./${table.tableName}/actions";`
        );
      }
      if (this.options.generateHttpActions) {
        lines.push(
          `export * as ${camelName}HttpActions from "./${table.tableName}/http-actions";`
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Write all generated files to disk
   */
  async writeToFileSystem(output: ConvexGeneratedOutput): Promise<void> {
    const baseDir = this.options.outputDir;

    // Ensure base directory exists
    await fs.mkdir(baseDir, { recursive: true });

    // Write schema.ts
    await fs.writeFile(path.join(baseDir, 'schema.ts'), output.schema, 'utf-8');

    // Write per-table files
    for (const [tableName, files] of output.tables) {
      const tableDir = path.join(baseDir, tableName);
      await fs.mkdir(tableDir, { recursive: true });

      if (files.queries) {
        await fs.writeFile(
          path.join(tableDir, 'queries.ts'),
          files.queries,
          'utf-8'
        );
      }
      if (files.mutations) {
        await fs.writeFile(
          path.join(tableDir, 'mutations.ts'),
          files.mutations,
          'utf-8'
        );
      }
      if (files.validators) {
        await fs.writeFile(
          path.join(tableDir, 'validators.ts'),
          files.validators,
          'utf-8'
        );
      }
      if (files.types) {
        await fs.writeFile(
          path.join(tableDir, 'types.ts'),
          files.types,
          'utf-8'
        );
      }
      if (files.actions) {
        await fs.writeFile(
          path.join(tableDir, 'actions.ts'),
          files.actions,
          'utf-8'
        );
      }
      if (files.httpActions) {
        await fs.writeFile(
          path.join(tableDir, 'http-actions.ts'),
          files.httpActions,
          'utf-8'
        );
      }

      // Generate per-table index
      const tableIndex = this.generateTableIndex(tableName, files);
      await fs.writeFile(path.join(tableDir, 'index.ts'), tableIndex, 'utf-8');
    }

    // Write main index file
    await fs.writeFile(
      path.join(baseDir, 'index.ts'),
      output.indexFile,
      'utf-8'
    );

    // Write HTTP routes file if generated
    if (output.httpFile) {
      await fs.writeFile(
        path.join(baseDir, 'http.ts'),
        output.httpFile,
        'utf-8'
      );
    }

    // Write crons.ts
    if (output.cronsFile) {
      await fs.writeFile(
        path.join(baseDir, 'crons.ts'),
        output.cronsFile,
        'utf-8'
      );
    }

    // Write convex.config.ts
    if (output.componentConfigFile) {
      await fs.writeFile(
        path.join(baseDir, 'convex.config.ts'),
        output.componentConfigFile,
        'utf-8'
      );
    }

    // Write auth files
    if (output.authFile) {
      await fs.writeFile(
        path.join(baseDir, 'auth.ts'),
        output.authFile,
        'utf-8'
      );
    }
    if (output.authConfigFile) {
      await fs.writeFile(
        path.join(baseDir, 'auth.config.ts'),
        output.authConfigFile,
        'utf-8'
      );
    }

    // Write per-table scheduled helpers
    for (const [tableName, files] of output.tables) {
      if (files.scheduledHelpers) {
        const tableDir = path.join(baseDir, tableName);
        await fs.writeFile(
          path.join(tableDir, 'scheduled.ts'),
          files.scheduledHelpers,
          'utf-8'
        );
      }
    }
  }

  /**
   * Generate index file for a single table directory
   */
  private generateTableIndex(
    tableName: string,
    files: GeneratedTableFiles
  ): string {
    const pascalName = toPascalCase(tableName);
    const camelName = toCamelCase(tableName);
    const lines: string[] = [
      `// Generated index for ${tableName}`,
      '// Do not edit this file directly - it will be overwritten',
      '',
    ];

    if (files.queries) {
      lines.push('export * from "./queries";');
    }
    if (files.mutations) {
      lines.push('export * from "./mutations";');
    }
    if (files.validators) {
      lines.push(`export { ${camelName}Validators } from "./validators";`);
    }
    if (files.types) {
      lines.push(
        `export type { ${pascalName}, Create${pascalName}Input, Update${pascalName}Input, ${pascalName}ListResponse } from "./types";`
      );
    }
    if (files.actions) {
      lines.push('export * from "./actions";');
    }
    if (files.httpActions) {
      lines.push('export * from "./http-actions";');
    }

    return lines.join('\n');
  }

  /**
   * Generate a summary report of what was generated
   */
  generateReport(output: ConvexGeneratedOutput): string {
    const lines: string[] = [
      '',
      '┌─────────────────────────────────────────┐',
      '│   Convex Code Generation Complete       │',
      '└─────────────────────────────────────────┘',
      '',
      `  Tables processed: ${output.stats.totalTables}`,
      `  Queries generated: ${output.stats.totalQueries}`,
      `  Mutations generated: ${output.stats.totalMutations}`,
      `  Validators generated: ${output.stats.totalValidators}`,
      `  Types generated: ${output.stats.totalTypes}`,
    ];

    // Add action stats if enabled
    if (this.options.generateActions) {
      lines.push(`  Actions generated: ${output.stats.totalActions}`);
    }
    if (this.options.generateHttpActions) {
      lines.push(`  HTTP Actions generated: ${output.stats.totalHttpActions}`);
    }

    // Add search/vector index stats if enabled
    if (this.options.generateSearchIndexes) {
      lines.push(
        `  Search indexes generated: ${output.stats.totalSearchIndexes}`
      );
    }
    if (this.options.generateVectorIndexes) {
      lines.push(
        `  Vector indexes generated: ${output.stats.totalVectorIndexes}`
      );
    }

    lines.push('');
    lines.push('  Output structure:');
    lines.push(`  ${this.options.outputDir}/`);
    lines.push('  ├── schema.ts');
    lines.push('  ├── index.ts');

    if (output.httpFile) {
      lines.push('  ├── http.ts');
    }
    if (output.cronsFile) {
      lines.push('  ├── crons.ts');
    }
    if (output.componentConfigFile) {
      lines.push('  ├── convex.config.ts');
    }
    if (output.authFile) {
      lines.push('  ├── auth.ts');
      lines.push('  ├── auth.config.ts');
    }

    for (const [tableName, files] of output.tables) {
      lines.push(`  ├── ${tableName}/`);
      if (this.options.generateQueries) lines.push(`  │   ├── queries.ts`);
      if (this.options.generateMutations) lines.push(`  │   ├── mutations.ts`);
      if (this.options.generateValidators)
        lines.push(`  │   ├── validators.ts`);
      if (this.options.generateTypes) lines.push(`  │   ├── types.ts`);
      if (this.options.generateActions) lines.push(`  │   ├── actions.ts`);
      if (this.options.generateHttpActions)
        lines.push(`  │   ├── http-actions.ts`);
      if (files.scheduledHelpers) lines.push(`  │   ├── scheduled.ts`);
      lines.push(`  │   └── index.ts`);
    }

    lines.push('');

    return lines.join('\n');
  }

  /**
   * Validate generated output for common issues
   */
  validate(output: ConvexGeneratedOutput): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check schema is not empty
    if (!output.schema || output.schema.length < 100) {
      errors.push('Schema file appears to be empty or too short');
    }

    // Check each table has expected files
    for (const [tableName, files] of output.tables) {
      if (this.options.generateQueries && !files.queries) {
        errors.push(`Missing queries for table: ${tableName}`);
      }
      if (this.options.generateMutations && !files.mutations) {
        errors.push(`Missing mutations for table: ${tableName}`);
      }
      if (this.options.generateValidators && !files.validators) {
        errors.push(`Missing validators for table: ${tableName}`);
      }
      if (this.options.generateTypes && !files.types) {
        errors.push(`Missing types for table: ${tableName}`);
      }
      if (this.options.generateActions && !files.actions) {
        errors.push(`Missing actions for table: ${tableName}`);
      }
      if (this.options.generateHttpActions && !files.httpActions) {
        errors.push(`Missing HTTP actions for table: ${tableName}`);
      }
    }

    // Check for syntax issues in generated code
    const syntaxChecks = [
      {
        pattern: /import.*from.*undefined/g,
        message: 'Undefined import path detected',
      },
      {
        pattern: /v\.\w+\(\)undefined/g,
        message: 'Malformed validator detected',
      },
      { pattern: /export const \s+=/g, message: 'Empty export name detected' },
    ];

    const allContent =
      output.schema +
      output.indexFile +
      (output.httpFile || '') +
      (output.cronsFile || '') +
      (output.componentConfigFile || '') +
      (output.authFile || '') +
      (output.authConfigFile || '') +
      Array.from(output.tables.values())
        .map(
          (f) =>
            f.queries +
            f.mutations +
            f.validators +
            f.types +
            f.actions +
            f.httpActions +
            (f.scheduledHelpers || '')
        )
        .join('');

    for (const check of syntaxChecks) {
      if (check.pattern.test(allContent)) {
        errors.push(check.message);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Convenience function to generate Convex code
 */
export async function generateConvexCode(
  tables: TableInfo[],
  options: Partial<ConvexFunctionGeneratorOptions> = {}
): Promise<ConvexGeneratedOutput> {
  const generator = new ConvexFunctionGenerator(options);
  const output = generator.generate(tables);

  // Validate output
  const validation = generator.validate(output);
  if (!validation.valid) {
    console.warn('Generation warnings:', validation.errors);
  }

  // Write to filesystem if outputDir is specified
  if (options.outputDir) {
    await generator.writeToFileSystem(output);
    console.log(generator.generateReport(output));
  }

  return output;
}
