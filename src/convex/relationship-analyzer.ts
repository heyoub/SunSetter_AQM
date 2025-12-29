/**
 * Relationship Analyzer
 *
 * Analyzes foreign key relationships to determine cardinality (1:1, 1:N, M:N).
 * Detects junction tables and builds a dependency graph for topological sorting.
 */

import type {
  TableInfo,
  ForeignKeyInfo,
  SchemaInfo,
  DetectedRelationship,
  RelationshipCardinality,
  RelationshipAnalyzerOptions,
  DependencyNode,
  DependencyGraph,
  ResolutionResult,
} from './types.js';

/**
 * Default options for the relationship analyzer
 */
const DEFAULT_OPTIONS: RelationshipAnalyzerOptions = {
  junctionTablePatterns: ['_to_', '_has_', '_rel_', '_x_', '_link_', '_map_'],
  minFKsForJunction: 2,
  maxNonFKColumnsForJunction: 3,
};

/**
 * Analyzes foreign key relationships and builds dependency graphs
 */
export class RelationshipAnalyzer {
  private options: RelationshipAnalyzerOptions;
  private tableMap: Map<string, TableInfo>;
  private fkGraph: Map<string, ForeignKeyInfo[]>;
  private reverseFkGraph: Map<
    string,
    { fromTable: string; fk: ForeignKeyInfo }[]
  >;
  private graph: DependencyGraph | null = null;

  constructor(options: Partial<RelationshipAnalyzerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.tableMap = new Map();
    this.fkGraph = new Map();
    this.reverseFkGraph = new Map();
  }

  /**
   * Analyzes an entire schema and returns all detected relationships
   */
  analyzeSchema(schema: SchemaInfo): DetectedRelationship[] {
    // Build lookup structures
    this.buildGraphs(schema);

    const relationships: DetectedRelationship[] = [];
    const junctionTables = this.identifyJunctionTables(schema);

    for (const table of schema.tables) {
      // Skip junction tables - they define M:N relationships
      if (junctionTables.has(table.tableName)) {
        continue;
      }

      for (const fk of table.foreignKeys) {
        const cardinality = this.determineCardinality(
          table,
          fk,
          junctionTables
        );

        relationships.push({
          sourceTable: table.tableName,
          sourceColumn: fk.columnName,
          targetTable: fk.referencedTable,
          targetColumn: fk.referencedColumn,
          cardinality,
          constraintName: fk.constraintName,
        });
      }
    }

    // Add M:N relationships from junction tables
    for (const junctionName of junctionTables) {
      const manyToManyRels = this.extractManyToMany(junctionName);
      relationships.push(...manyToManyRels);
    }

    return relationships;
  }

  /**
   * Builds the foreign key graph structures
   */
  private buildGraphs(schema: SchemaInfo): void {
    this.tableMap.clear();
    this.fkGraph.clear();
    this.reverseFkGraph.clear();

    for (const table of schema.tables) {
      this.tableMap.set(table.tableName, table);
      this.fkGraph.set(table.tableName, table.foreignKeys);

      // Build reverse graph (who references this table)
      for (const fk of table.foreignKeys) {
        const existing = this.reverseFkGraph.get(fk.referencedTable) || [];
        existing.push({ fromTable: table.tableName, fk });
        this.reverseFkGraph.set(fk.referencedTable, existing);
      }
    }
  }

  /**
   * Builds and returns the dependency graph
   */
  buildDependencyGraph(schema: SchemaInfo): DependencyGraph {
    // Use Sets internally for deduplication
    const depSets = new Map<
      string,
      { deps: Set<string>; dependents: Set<string> }
    >();

    // Initialize all table nodes
    for (const table of schema.tables) {
      depSets.set(table.tableName, {
        deps: new Set(),
        dependents: new Set(),
      });
    }

    // Add edges for foreign key relationships
    for (const table of schema.tables) {
      const nodeData = depSets.get(table.tableName)!;

      for (const fk of table.foreignKeys) {
        // This table depends on the referenced table
        // (referenced table must be inserted first)
        const referencedTable = fk.referencedTable;

        // Only add if the referenced table is in our schema
        if (depSets.has(referencedTable)) {
          nodeData.deps.add(referencedTable);

          // The referenced table has this table as a dependent
          const refNodeData = depSets.get(referencedTable)!;
          refNodeData.dependents.add(table.tableName);
        }
      }
    }

    // Convert Sets to arrays for DependencyNode
    const nodes = new Map<string, DependencyNode>();
    for (const [tableName, data] of depSets) {
      nodes.set(tableName, {
        tableName,
        dependencies: [...data.deps],
        dependents: [...data.dependents],
      });
    }

    // Check for cycles
    const cycleResult = this.detectCycles(nodes);

    this.graph = {
      nodes,
      hasCycle: cycleResult.hasCycle,
      cycleDetails: cycleResult.cycle,
    };

    return this.graph;
  }

  /**
   * Detect cycles using DFS with coloring
   */
  private detectCycles(nodes: Map<string, DependencyNode>): {
    hasCycle: boolean;
    cycle: string[] | null;
  } {
    const color = new Map<string, number>();
    const parent = new Map<string, string>();

    for (const tableName of nodes.keys()) {
      color.set(tableName, 0); // White = unvisited
    }

    for (const tableName of nodes.keys()) {
      if (color.get(tableName) === 0) {
        const cycle = this.dfsDetectCycle(tableName, nodes, color, parent);
        if (cycle) {
          return { hasCycle: true, cycle };
        }
      }
    }

    return { hasCycle: false, cycle: null };
  }

  private dfsDetectCycle(
    current: string,
    nodes: Map<string, DependencyNode>,
    color: Map<string, number>,
    parent: Map<string, string>
  ): string[] | null {
    color.set(current, 1); // Gray - in current path

    const node = nodes.get(current)!;
    for (const dependency of node.dependencies) {
      if (color.get(dependency) === 1) {
        // Found a back edge - reconstruct cycle
        const cycle = [dependency];
        let curr = current;
        while (curr !== dependency) {
          cycle.unshift(curr);
          curr = parent.get(curr)!;
        }
        cycle.unshift(dependency);
        return cycle;
      }

      if (color.get(dependency) === 0) {
        parent.set(dependency, current);
        const cycle = this.dfsDetectCycle(dependency, nodes, color, parent);
        if (cycle) return cycle;
      }
    }

    color.set(current, 2); // Black - completed
    return null;
  }

  /**
   * Perform topological sort using Kahn's algorithm
   */
  resolve(schema: SchemaInfo): ResolutionResult {
    const graph = this.buildDependencyGraph(schema);
    const warnings: string[] = [];

    if (graph.hasCycle) {
      return {
        success: false,
        orderedTables: [],
        circularDependencies: [graph.cycleDetails!],
        warnings: [
          `Circular dependency detected: ${graph.cycleDetails!.join(' -> ')}`,
        ],
      };
    }

    // Kahn's algorithm
    const inDegree = new Map<string, number>();
    const orderedTables: string[] = [];
    const queue: string[] = [];

    // Initialize in-degrees
    for (const [tableName, node] of graph.nodes) {
      inDegree.set(tableName, node.dependencies.length);
      if (node.dependencies.length === 0) {
        queue.push(tableName);
      }
    }

    // Process queue
    while (queue.length > 0) {
      // Sort for deterministic ordering (alphabetical among same-level tables)
      queue.sort();
      const current = queue.shift()!;
      orderedTables.push(current);

      const node = graph.nodes.get(current)!;
      for (const dependent of node.dependents) {
        const newDegree = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // Verify all tables were processed
    if (orderedTables.length !== graph.nodes.size) {
      warnings.push(
        'Some tables could not be ordered - possible isolated cycle'
      );
    }

    return {
      success: true,
      orderedTables,
      circularDependencies: [],
      warnings,
    };
  }

  /**
   * Identifies tables that are junction/pivot tables for M:N relationships
   */
  private identifyJunctionTables(schema: SchemaInfo): Set<string> {
    const junctions = new Set<string>();

    for (const table of schema.tables) {
      if (this.isJunctionTable(table)) {
        junctions.add(table.tableName);
      }
    }

    return junctions;
  }

  /**
   * Determines if a table is a junction table
   */
  private isJunctionTable(table: TableInfo): boolean {
    // Check 1: Name pattern matching
    const nameMatchesPattern = this.options.junctionTablePatterns.some(
      (pattern) => table.tableName.includes(pattern)
    );

    // Check 2: Has at least minFKsForJunction foreign keys
    const hasEnoughFKs =
      table.foreignKeys.length >= this.options.minFKsForJunction;

    // Check 3: Count of non-FK columns
    const fkColumnNames = new Set(table.foreignKeys.map((fk) => fk.columnName));
    const nonFkColumns = table.columns.filter(
      (col) =>
        !fkColumnNames.has(col.columnName) &&
        !col.isPrimaryKey &&
        !col.columnName.includes('created') &&
        !col.columnName.includes('updated')
    );
    const hasLimitedNonFkColumns =
      nonFkColumns.length <= this.options.maxNonFKColumnsForJunction;

    // Check 4: Primary key is compound of FKs
    const pkIsCompoundFks =
      table.primaryKeys.length >= 2 &&
      table.primaryKeys.every((pk) => fkColumnNames.has(pk));

    // Heuristic: (name matches OR compound PK) AND enough FKs AND limited other columns
    return (
      (nameMatchesPattern || pkIsCompoundFks) &&
      hasEnoughFKs &&
      hasLimitedNonFkColumns
    );
  }

  /**
   * Determines cardinality for a single FK relationship
   */
  private determineCardinality(
    sourceTable: TableInfo,
    fk: ForeignKeyInfo,
    junctionTables: Set<string>
  ): RelationshipCardinality {
    // Check if source column is the primary key or has unique constraint
    const isSourceUnique =
      sourceTable.primaryKeys.includes(fk.columnName) ||
      sourceTable.indexes.some(
        (idx) => idx.isUnique && idx.columnName === fk.columnName
      );

    // Check if there's a reverse FK (bidirectional relationship)
    const reverseRefs = this.reverseFkGraph.get(sourceTable.tableName) || [];
    const hasReverseFromTarget = reverseRefs.some(
      (ref) => ref.fromTable === fk.referencedTable
    );

    // One-to-one: unique constraint on FK column AND reverse FK exists
    if (isSourceUnique && hasReverseFromTarget) {
      return 'one-to-one';
    }

    // One-to-one: unique constraint on FK column (single direction)
    if (isSourceUnique) {
      return 'one-to-one';
    }

    // Default: many-to-one (many source rows reference one target row)
    return 'many-to-one';
  }

  /**
   * Extracts M:N relationships from a junction table
   */
  private extractManyToMany(junctionTableName: string): DetectedRelationship[] {
    const table = this.tableMap.get(junctionTableName);
    if (!table || table.foreignKeys.length < 2) {
      return [];
    }

    const relationships: DetectedRelationship[] = [];

    // Create relationships between all pairs of referenced tables
    for (let i = 0; i < table.foreignKeys.length; i++) {
      for (let j = i + 1; j < table.foreignKeys.length; j++) {
        const fk1 = table.foreignKeys[i];
        const fk2 = table.foreignKeys[j];

        // Create bidirectional M:N
        relationships.push({
          sourceTable: fk1.referencedTable,
          sourceColumn: fk1.referencedColumn,
          targetTable: fk2.referencedTable,
          targetColumn: fk2.referencedColumn,
          cardinality: 'many-to-many',
          constraintName: `${fk1.constraintName}_${fk2.constraintName}`,
          junctionTable: junctionTableName,
        });
      }
    }

    return relationships;
  }

  /**
   * Gets the junction tables identified in the schema
   */
  getJunctionTables(schema: SchemaInfo): string[] {
    return Array.from(this.identifyJunctionTables(schema));
  }

  /**
   * Gets all tables that reference a given table (reverse lookup)
   */
  getReferencingTables(tableName: string): { table: string; column: string }[] {
    const refs = this.reverseFkGraph.get(tableName) || [];
    return refs.map((ref) => ({
      table: ref.fromTable,
      column: ref.fk.columnName,
    }));
  }

  /**
   * Gets all tables referenced by a given table
   */
  getReferencedTables(tableName: string): { table: string; column: string }[] {
    const fks = this.fkGraph.get(tableName) || [];
    return fks.map((fk) => ({
      table: fk.referencedTable,
      column: fk.columnName,
    }));
  }

  /**
   * Gets the dependency chain for a specific table
   */
  getDependencyChain(tableName: string): string[] {
    if (!this.graph) return [tableName];

    const chain: string[] = [];
    const visited = new Set<string>();

    const visit = (table: string) => {
      if (visited.has(table)) return;
      visited.add(table);

      const node = this.graph!.nodes.get(table);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
        chain.push(table);
      }
    };

    visit(tableName);
    return chain;
  }

  /**
   * Gets tables that have no foreign key dependencies (roots)
   */
  getRootTables(): string[] {
    if (!this.graph) return [];

    const roots: string[] = [];
    for (const [tableName, node] of this.graph.nodes) {
      if (node.dependencies.length === 0) {
        roots.push(tableName);
      }
    }
    return roots.sort();
  }

  /**
   * Gets tables that have no dependents (leaves)
   */
  getLeafTables(): string[] {
    if (!this.graph) return [];

    const leaves: string[] = [];
    for (const [tableName, node] of this.graph.nodes) {
      if (node.dependents.length === 0) {
        leaves.push(tableName);
      }
    }
    return leaves.sort();
  }

  /**
   * For tables with circular dependencies, suggest a break point
   */
  suggestCycleBreak(schema: SchemaInfo, cycle: string[]): string | null {
    let bestTable: string | null = null;
    let maxNullableFks = -1;

    for (const tableName of cycle) {
      const table = schema.tables.find((t) => t.tableName === tableName);
      if (!table) continue;

      // Count nullable foreign keys pointing to other cycle members
      let nullableFks = 0;
      for (const fk of table.foreignKeys) {
        if (cycle.includes(fk.referencedTable)) {
          const column = table.columns.find(
            (c) => c.columnName === fk.columnName
          );
          if (column?.isNullable) {
            nullableFks++;
          }
        }
      }

      if (nullableFks > maxNullableFks) {
        maxNullableFks = nullableFks;
        bestTable = tableName;
      }
    }

    return bestTable;
  }

  /**
   * Validates relationship integrity
   */
  validateRelationships(relationships: DetectedRelationship[]): string[] {
    const warnings: string[] = [];

    // Check for self-references
    for (const rel of relationships) {
      if (rel.sourceTable === rel.targetTable) {
        warnings.push(
          `Self-referential relationship in ${rel.sourceTable}.${rel.sourceColumn}`
        );
      }
    }

    return warnings;
  }
}
