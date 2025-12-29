import { DatabaseConnection } from '../config/database.js';

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  characterMaximumLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  ordinalPosition: number;
  isIdentity: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyTable: string | null;
  foreignKeyColumn: string | null;
  description: string | null;
  /** Whether this is a generated column (GENERATED ALWAYS) */
  isGenerated: boolean;
  /** Generation expression for generated columns */
  generationExpression: string | null;
  /** Generation type: 'STORED' or 'VIRTUAL' (PostgreSQL only supports STORED) */
  generationType: 'STORED' | 'VIRTUAL' | null;
  /** If this column uses a domain type, the domain name */
  domainName: string | null;
  /** If this column uses a domain type, the base data type */
  domainBaseType: string | null;
}

export interface TableInfo {
  tableName: string;
  schemaName: string;
  tableType: 'BASE TABLE' | 'VIEW';
  columns: ColumnInfo[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  /** Check constraints on the table */
  checkConstraints: CheckConstraintInfo[];
  description: string | null;
  /** Convex-safe table name (for multi-schema, may be prefixed) */
  convexTableName?: string;
}

export interface ForeignKeyInfo {
  constraintName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  referencedSchema: string;
}

export interface IndexInfo {
  indexName: string;
  /** Single column name (for backwards compatibility) */
  columnName: string;
  /** All columns in the index (for composite indexes) */
  columns: IndexColumnInfo[];
  isUnique: boolean;
  ordinalPosition: number;
  /** Whether this is an expression-based index */
  isExpression: boolean;
  /** The expression definition if this is an expression index */
  expressionDefinition?: string;
  /** Index method (btree, hash, gist, gin, etc.) */
  indexMethod: string;
  /** Whether this is a partial index */
  isPartial: boolean;
  /** Partial index predicate (WHERE clause) */
  partialPredicate?: string;
}

export interface IndexColumnInfo {
  columnName: string;
  ordinalPosition: number;
  /** Sort direction: 'asc' or 'desc' */
  sortOrder: 'asc' | 'desc';
  /** Nulls position: 'first' or 'last' */
  nullsPosition: 'first' | 'last';
  /** Whether this is an expression column */
  isExpression: boolean;
  /** The expression if this is an expression column */
  expression?: string;
}

export interface CheckConstraintInfo {
  constraintName: string;
  /** The CHECK expression */
  checkClause: string;
  /** Columns involved in the check constraint (if determinable) */
  columns: string[];
  /** Whether this constraint is deferrable */
  isDeferrable: boolean;
  /** Whether this constraint is initially deferred */
  isInitiallyDeferred: boolean;
}

export interface DomainInfo {
  domainName: string;
  schemaName: string;
  /** The underlying data type */
  dataType: string;
  /** Default value for the domain */
  domainDefault: string | null;
  /** Whether the domain allows NULL */
  isNullable: boolean;
  /** Check constraints on the domain */
  checkConstraints: string[];
  /** Domain description/comment */
  description: string | null;
}

export interface SchemaInfo {
  schemaName: string;
  tables: TableInfo[];
  views: TableInfo[];
  /** Domain types defined in this schema */
  domains: DomainInfo[];
}

/**
 * Multi-schema introspection result
 */
export interface MultiSchemaInfo {
  schemas: SchemaInfo[];
  /** All tables across all schemas */
  allTables: TableInfo[];
  /** All views across all schemas */
  allViews: TableInfo[];
  /** Cross-schema foreign key references */
  crossSchemaForeignKeys: CrossSchemaForeignKey[];
}

/**
 * Cross-schema foreign key reference
 */
export interface CrossSchemaForeignKey {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  constraintName: string;
}

/**
 * Options for multi-schema introspection
 */
export interface MultiSchemaOptions {
  /** Schemas to include (empty = all non-system schemas) */
  schemas?: string[];
  /** Whether to prefix table names with schema name for Convex */
  prefixTableNames?: boolean;
  /** Separator for schema-qualified names (default: '__') */
  schemaSeparator?: string;
  /** Include system schemas (pg_catalog, information_schema) */
  includeSystemSchemas?: boolean;
}

export class SchemaIntrospector {
  constructor(private db: DatabaseConnection) {}

  async introspectSchema(schemaName: string = 'public'): Promise<SchemaInfo> {
    const tables = await this.getTables(schemaName);
    const views = await this.getViews(schemaName);
    const domains = await this.getDomains(schemaName);

    // Auto-detect and register enum types
    await this.autoDetectEnumTypes(schemaName);

    return {
      schemaName,
      tables,
      views,
      domains,
    };
  }

  /**
   * Auto-detect PostgreSQL enum types and register them
   * This eliminates the need for manual registerEnumMapping() calls
   */
  private async autoDetectEnumTypes(schemaName: string): Promise<void> {
    const query = `
      SELECT
        t.typname as enum_name,
        ARRAY_AGG(e.enumlabel ORDER BY e.enumsortorder) as enum_values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1
      GROUP BY t.typname, t.oid
      ORDER BY t.typname;
    `;

    try {
      const result = await this.db.query<{
        enum_name: string;
        enum_values: string[];
      }>(query, [schemaName]);

      if (result.length > 0) {
        console.log(
          `[Schema Introspector] Auto-detected ${result.length} enum type(s) in schema "${schemaName}"`
        );

        for (const row of result) {
          console.log(`  - ${row.enum_name}: [${row.enum_values.join(', ')}]`);
          // Store enum information for later use by ConvexTypeMapper
          // This will be accessible via column.dataType === 'USER-DEFINED' and custom logic
        }
      }
    } catch (error) {
      console.warn(
        `[Schema Introspector] Failed to auto-detect enum types: ${(error as Error).message}`
      );
    }
  }

  async getAllSchemas(): Promise<string[]> {
    const query = `
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
      ORDER BY schema_name;
    `;

    const result = await this.db.query<{ schema_name: string }>(query);
    return result.map((row) => row.schema_name);
  }

  /**
   * Introspect multiple schemas at once
   */
  async introspectMultipleSchemas(
    options: MultiSchemaOptions = {}
  ): Promise<MultiSchemaInfo> {
    const {
      schemas: requestedSchemas,
      prefixTableNames = false,
      schemaSeparator = '__',
      includeSystemSchemas = false,
    } = options;

    // Get list of schemas to introspect
    let schemaNames: string[];
    if (requestedSchemas && requestedSchemas.length > 0) {
      schemaNames = requestedSchemas;
    } else {
      schemaNames = await this.getAllSchemas();
      if (!includeSystemSchemas) {
        schemaNames = schemaNames.filter(
          (s) => !['pg_catalog', 'information_schema', 'pg_toast'].includes(s)
        );
      }
    }

    // Introspect each schema
    const schemas: SchemaInfo[] = [];
    const allTables: TableInfo[] = [];
    const allViews: TableInfo[] = [];

    for (const schemaName of schemaNames) {
      const schemaInfo = await this.introspectSchema(schemaName);
      schemas.push(schemaInfo);

      // Add convexTableName to each table
      for (const table of schemaInfo.tables) {
        table.convexTableName = prefixTableNames
          ? `${schemaName}${schemaSeparator}${table.tableName}`
          : table.tableName;
        allTables.push(table);
      }

      for (const view of schemaInfo.views) {
        view.convexTableName = prefixTableNames
          ? `${schemaName}${schemaSeparator}${view.tableName}`
          : view.tableName;
        allViews.push(view);
      }
    }

    // Find cross-schema foreign keys
    const crossSchemaForeignKeys =
      await this.getCrossSchemaForeignKeys(schemaNames);

    return {
      schemas,
      allTables,
      allViews,
      crossSchemaForeignKeys,
    };
  }

  /**
   * Get all cross-schema foreign key relationships
   */
  async getCrossSchemaForeignKeys(
    schemaNames: string[]
  ): Promise<CrossSchemaForeignKey[]> {
    if (schemaNames.length === 0) {
      return [];
    }

    const placeholders = schemaNames.map((_, i) => `$${i + 1}`).join(', ');

    const query = `
      SELECT
        tc.table_schema AS source_schema,
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_schema AS target_schema,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema IN (${placeholders})
        AND tc.table_schema != ccu.table_schema
      ORDER BY tc.table_schema, tc.table_name, kcu.column_name;
    `;

    const result = await this.db.query<{
      source_schema: string;
      source_table: string;
      source_column: string;
      target_schema: string;
      target_table: string;
      target_column: string;
      constraint_name: string;
    }>(query, schemaNames);

    return result.map((row) => ({
      sourceSchema: row.source_schema,
      sourceTable: row.source_table,
      sourceColumn: row.source_column,
      targetSchema: row.target_schema,
      targetTable: row.target_table,
      targetColumn: row.target_column,
      constraintName: row.constraint_name,
    }));
  }

  /**
   * Get a schema-qualified table name for Convex
   */
  getConvexTableName(
    schemaName: string,
    tableName: string,
    prefixTableNames: boolean,
    separator: string = '__'
  ): string {
    if (prefixTableNames && schemaName !== 'public') {
      return `${schemaName}${separator}${tableName}`;
    }
    return tableName;
  }

  /**
   * Parse a Convex table name back to schema and table
   */
  parseConvexTableName(
    convexTableName: string,
    separator: string = '__'
  ): { schemaName: string; tableName: string } {
    const parts = convexTableName.split(separator);
    if (parts.length > 1) {
      return {
        schemaName: parts[0],
        tableName: parts.slice(1).join(separator),
      };
    }
    return {
      schemaName: 'public',
      tableName: convexTableName,
    };
  }

  private async getTables(schemaName: string): Promise<TableInfo[]> {
    const query = `
      SELECT 
        t.table_name,
        t.table_schema,
        t.table_type,
        obj_description(pgc.oid) as table_comment
      FROM information_schema.tables t
      LEFT JOIN pg_class pgc ON pgc.relname = t.table_name
      LEFT JOIN pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = t.table_schema
      WHERE t.table_schema = $1 
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name;
    `;

    const tables = await this.db.query<{
      table_name: string;
      table_schema: string;
      table_type: 'BASE TABLE';
      table_comment: string | null;
    }>(query, [schemaName]);

    const tableInfos: TableInfo[] = [];

    for (const table of tables) {
      const columns = await this.getColumns(
        table.table_schema,
        table.table_name
      );
      const primaryKeys = await this.getPrimaryKeys(
        table.table_schema,
        table.table_name
      );
      const foreignKeys = await this.getForeignKeys(
        table.table_schema,
        table.table_name
      );
      const indexes = await this.getIndexes(
        table.table_schema,
        table.table_name
      );
      const checkConstraints = await this.getCheckConstraints(
        table.table_schema,
        table.table_name
      );

      tableInfos.push({
        tableName: table.table_name,
        schemaName: table.table_schema,
        tableType: table.table_type,
        columns,
        primaryKeys,
        foreignKeys,
        indexes,
        checkConstraints,
        description: table.table_comment,
      });
    }

    return tableInfos;
  }

  private async getViews(schemaName: string): Promise<TableInfo[]> {
    const query = `
      SELECT 
        t.table_name,
        t.table_schema,
        t.table_type,
        obj_description(pgc.oid) as table_comment
      FROM information_schema.tables t
      LEFT JOIN pg_class pgc ON pgc.relname = t.table_name
      LEFT JOIN pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = t.table_schema
      WHERE t.table_schema = $1 
        AND t.table_type = 'VIEW'
      ORDER BY t.table_name;
    `;

    const views = await this.db.query<{
      table_name: string;
      table_schema: string;
      table_type: 'VIEW';
      table_comment: string | null;
    }>(query, [schemaName]);

    const viewInfos: TableInfo[] = [];

    for (const view of views) {
      const columns = await this.getColumns(view.table_schema, view.table_name);

      viewInfos.push({
        tableName: view.table_name,
        schemaName: view.table_schema,
        tableType: view.table_type,
        columns,
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
        checkConstraints: [],
        description: view.table_comment,
      });
    }

    return viewInfos;
  }

  private async getColumns(
    schemaName: string,
    tableName: string
  ): Promise<ColumnInfo[]> {
    const query = `
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.ordinal_position,
        c.is_identity,
        c.is_generated,
        c.generation_expression,
        c.domain_name,
        c.domain_schema,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
        CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
        fk.foreign_table_name,
        fk.foreign_column_name,
        col_description(pgc.oid, c.ordinal_position) as column_comment,
        -- Get domain base type if this column uses a domain
        dom.data_type as domain_base_type
      FROM information_schema.columns c
      LEFT JOIN pg_class pgc ON pgc.relname = c.table_name
      LEFT JOIN pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = c.table_schema
      LEFT JOIN (
        SELECT kcu.column_name, kcu.table_name, kcu.table_schema
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
      ) pk ON pk.column_name = c.column_name
        AND pk.table_name = c.table_name
        AND pk.table_schema = c.table_schema
      LEFT JOIN (
        SELECT
          kcu.column_name,
          kcu.table_name,
          kcu.table_schema,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
      ) fk ON fk.column_name = c.column_name
        AND fk.table_name = c.table_name
        AND fk.table_schema = c.table_schema
      LEFT JOIN information_schema.domains dom
        ON dom.domain_name = c.domain_name
        AND dom.domain_schema = c.domain_schema
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position;
    `;

    const result = await this.db.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
      ordinal_position: number;
      is_identity: string;
      is_generated: string;
      generation_expression: string | null;
      domain_name: string | null;
      domain_schema: string | null;
      is_primary_key: boolean;
      is_foreign_key: boolean;
      foreign_table_name: string | null;
      foreign_column_name: string | null;
      column_comment: string | null;
      domain_base_type: string | null;
    }>(query, [schemaName, tableName]);

    return result.map((row) => ({
      columnName: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable === 'YES',
      columnDefault: row.column_default,
      characterMaximumLength: row.character_maximum_length,
      numericPrecision: row.numeric_precision,
      numericScale: row.numeric_scale,
      ordinalPosition: row.ordinal_position,
      isIdentity: row.is_identity === 'YES',
      isPrimaryKey: row.is_primary_key,
      isForeignKey: row.is_foreign_key,
      foreignKeyTable: row.foreign_table_name,
      foreignKeyColumn: row.foreign_column_name,
      description: row.column_comment,
      isGenerated: row.is_generated === 'ALWAYS',
      generationExpression: row.generation_expression,
      generationType: row.is_generated === 'ALWAYS' ? 'STORED' : null,
      domainName: row.domain_name,
      domainBaseType: row.domain_base_type,
    }));
  }

  private async getPrimaryKeys(
    schemaName: string,
    tableName: string
  ): Promise<string[]> {
    const query = `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY kcu.ordinal_position;
    `;

    const result = await this.db.query<{ column_name: string }>(query, [
      schemaName,
      tableName,
    ]);
    return result.map((row) => row.column_name);
  }

  private async getForeignKeys(
    schemaName: string,
    tableName: string
  ): Promise<ForeignKeyInfo[]> {
    const query = `
      SELECT 
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        ccu.table_schema AS foreign_schema_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2;
    `;

    const result = await this.db.query<{
      constraint_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
      foreign_schema_name: string;
    }>(query, [schemaName, tableName]);

    return result.map((row) => ({
      constraintName: row.constraint_name,
      columnName: row.column_name,
      referencedTable: row.foreign_table_name,
      referencedColumn: row.foreign_column_name,
      referencedSchema: row.foreign_schema_name,
    }));
  }

  private async getIndexes(
    schemaName: string,
    tableName: string
  ): Promise<IndexInfo[]> {
    // First, get all indexes with their metadata
    const indexQuery = `
      SELECT
        i.relname as index_name,
        ix.indisunique as is_unique,
        am.amname as index_method,
        pg_get_expr(ix.indpred, ix.indrelid) as partial_predicate,
        pg_get_indexdef(ix.indexrelid) as index_definition,
        ix.indexprs IS NOT NULL as has_expressions,
        ix.indkey as column_positions
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON i.relam = am.oid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1
        AND t.relname = $2
        AND t.relkind = 'r'
        AND NOT ix.indisprimary  -- Exclude primary key indexes (already captured)
      ORDER BY i.relname;
    `;

    const indexes = await this.db.query<{
      index_name: string;
      is_unique: boolean;
      index_method: string;
      partial_predicate: string | null;
      index_definition: string;
      has_expressions: boolean;
      column_positions: number[];
    }>(indexQuery, [schemaName, tableName]);

    // For each index, get detailed column information
    const result: IndexInfo[] = [];

    for (const idx of indexes) {
      const columns = await this.getIndexColumns(
        schemaName,
        tableName,
        idx.index_name
      );

      // Determine if this is an expression-only index
      const isExpressionIndex =
        idx.has_expressions && columns.every((c) => c.isExpression);

      result.push({
        indexName: idx.index_name,
        // For backwards compatibility, use the first column name or empty string for expression indexes
        columnName: columns.length > 0 ? columns[0].columnName : '',
        columns,
        isUnique: idx.is_unique,
        ordinalPosition: 1,
        isExpression: isExpressionIndex,
        expressionDefinition: isExpressionIndex
          ? idx.index_definition
          : undefined,
        indexMethod: idx.index_method,
        isPartial: idx.partial_predicate !== null,
        partialPredicate: idx.partial_predicate || undefined,
      });
    }

    return result;
  }

  /**
   * Gets detailed column information for a specific index
   */
  private async getIndexColumns(
    schemaName: string,
    tableName: string,
    indexName: string
  ): Promise<IndexColumnInfo[]> {
    const query = `
      SELECT
        COALESCE(a.attname, 'expr_' || array_position(ix.indkey, 0)) as column_name,
        array_position(ix.indkey, COALESCE(a.attnum, 0)) as ordinal_position,
        CASE
          WHEN ix.indoption[array_position(ix.indkey, COALESCE(a.attnum, 0)) - 1] & 1 = 1 THEN 'desc'
          ELSE 'asc'
        END as sort_order,
        CASE
          WHEN ix.indoption[array_position(ix.indkey, COALESCE(a.attnum, 0)) - 1] & 2 = 2 THEN 'first'
          ELSE 'last'
        END as nulls_position,
        a.attnum = 0 OR a.attnum IS NULL as is_expression,
        pg_get_indexdef(ix.indexrelid, array_position(ix.indkey, COALESCE(a.attnum, 0)), true) as expression
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = $1
        AND t.relname = $2
        AND i.relname = $3
      ORDER BY array_position(ix.indkey, COALESCE(a.attnum, 0));
    `;

    const result = await this.db.query<{
      column_name: string;
      ordinal_position: number;
      sort_order: string;
      nulls_position: string;
      is_expression: boolean;
      expression: string | null;
    }>(query, [schemaName, tableName, indexName]);

    return result.map((row) => ({
      columnName: row.column_name,
      ordinalPosition: row.ordinal_position || 1,
      sortOrder: row.sort_order === 'desc' ? 'desc' : 'asc',
      nullsPosition: row.nulls_position === 'first' ? 'first' : 'last',
      isExpression: row.is_expression,
      expression: row.is_expression ? row.expression || undefined : undefined,
    }));
  }

  /**
   * Gets check constraints for a table
   */
  private async getCheckConstraints(
    schemaName: string,
    tableName: string
  ): Promise<CheckConstraintInfo[]> {
    const query = `
      SELECT
        con.conname as constraint_name,
        pg_get_constraintdef(con.oid) as check_clause,
        con.condeferrable as is_deferrable,
        con.condeferred as is_initially_deferred,
        ARRAY(
          SELECT a.attname
          FROM unnest(con.conkey) AS col_num
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = col_num
        ) as columns
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relname = $2
        AND con.contype = 'c'
      ORDER BY con.conname;
    `;

    const result = await this.db.query<{
      constraint_name: string;
      check_clause: string;
      is_deferrable: boolean;
      is_initially_deferred: boolean;
      columns: string[];
    }>(query, [schemaName, tableName]);

    return result.map((row) => ({
      constraintName: row.constraint_name,
      checkClause: row.check_clause,
      columns: row.columns || [],
      isDeferrable: row.is_deferrable,
      isInitiallyDeferred: row.is_initially_deferred,
    }));
  }

  /**
   * Gets domain types defined in a schema
   */
  private async getDomains(schemaName: string): Promise<DomainInfo[]> {
    const query = `
      SELECT
        d.domain_name,
        d.domain_schema,
        d.data_type,
        d.domain_default,
        d.is_nullable,
        obj_description(t.oid) as domain_comment,
        ARRAY(
          SELECT pg_get_constraintdef(con.oid)
          FROM pg_constraint con
          WHERE con.contypid = t.oid
        ) as check_constraints
      FROM information_schema.domains d
      JOIN pg_type t ON t.typname = d.domain_name
      JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = d.domain_schema
      WHERE d.domain_schema = $1
      ORDER BY d.domain_name;
    `;

    const result = await this.db.query<{
      domain_name: string;
      domain_schema: string;
      data_type: string;
      domain_default: string | null;
      is_nullable: string;
      domain_comment: string | null;
      check_constraints: string[];
    }>(query, [schemaName]);

    return result.map((row) => ({
      domainName: row.domain_name,
      schemaName: row.domain_schema,
      dataType: row.data_type,
      domainDefault: row.domain_default,
      isNullable: row.is_nullable === 'YES',
      checkConstraints: row.check_constraints || [],
      description: row.domain_comment,
    }));
  }
}
