/**
 * Dependency Resolver
 *
 * Resolves table dependencies using topological sorting (Kahn's algorithm).
 * Determines the correct order to migrate tables to respect foreign key constraints.
 * Detects and reports circular dependencies.
 */

import type { TableInfo } from '../introspector/schema-introspector.js';
import type {
  DependencyNode,
  DependencyResolutionResult,
  CircularDependency,
} from './types.js';

/**
 * Resolves dependencies between tables for migration ordering
 */
export class DependencyResolver {
  private tables: Map<string, TableInfo>;
  private graph: Map<string, DependencyNode>;

  constructor() {
    this.tables = new Map();
    this.graph = new Map();
  }

  /**
   * Build dependency graph from table information
   */
  buildGraph(tables: TableInfo[]): Map<string, DependencyNode> {
    this.tables.clear();
    this.graph.clear();

    // Index tables
    for (const table of tables) {
      this.tables.set(table.tableName, table);
    }

    // Build graph nodes
    for (const table of tables) {
      const node: DependencyNode = {
        tableName: table.tableName,
        dependencies: [],
        dependents: [],
      };

      // Find dependencies from foreign keys
      for (const fk of table.foreignKeys) {
        // Skip self-references
        if (fk.referencedTable !== table.tableName) {
          // Only add if the referenced table exists in our table set
          if (this.tables.has(fk.referencedTable)) {
            node.dependencies.push(fk.referencedTable);
          }
        }
      }

      this.graph.set(table.tableName, node);
    }

    // Build reverse references (dependents)
    for (const [tableName, node] of this.graph) {
      for (const dep of node.dependencies) {
        const depNode = this.graph.get(dep);
        if (depNode) {
          depNode.dependents.push(tableName);
        }
      }
    }

    return this.graph;
  }

  /**
   * Resolve dependencies and return migration order using Kahn's algorithm
   */
  resolve(tables: TableInfo[]): DependencyResolutionResult {
    this.buildGraph(tables);

    // Detect circular dependencies first
    const circularDeps = this.detectCycles();

    // Find roots (tables with no dependencies)
    const roots: string[] = [];
    for (const [tableName, node] of this.graph) {
      if (node.dependencies.length === 0) {
        roots.push(tableName);
      }
    }

    // Find leaves (tables with no dependents)
    const leaves: string[] = [];
    for (const [tableName, node] of this.graph) {
      if (node.dependents.length === 0) {
        leaves.push(tableName);
      }
    }

    // Perform topological sort using Kahn's algorithm
    const order = this.kahnSort();

    return {
      order,
      circularDeps,
      graph: this.graph,
      roots,
      leaves,
    };
  }

  /**
   * Kahn's algorithm for topological sorting
   */
  private kahnSort(): string[] {
    const result: string[] = [];
    const inDegree = new Map<string, number>();
    const queue: string[] = [];

    // Calculate in-degrees
    for (const [tableName, node] of this.graph) {
      inDegree.set(tableName, node.dependencies.length);
      if (node.dependencies.length === 0) {
        queue.push(tableName);
      }
    }

    // Process queue
    while (queue.length > 0) {
      // Sort queue for deterministic output
      queue.sort();
      const current = queue.shift()!;
      result.push(current);

      const node = this.graph.get(current);
      if (node) {
        for (const dependent of node.dependents) {
          const degree = inDegree.get(dependent)! - 1;
          inDegree.set(dependent, degree);
          if (degree === 0) {
            queue.push(dependent);
          }
        }
      }
    }

    // If not all nodes are in result, there's a cycle
    // Add remaining tables at the end (they're in cycles)
    if (result.length < this.graph.size) {
      for (const tableName of this.graph.keys()) {
        if (!result.includes(tableName)) {
          result.push(tableName);
        }
      }
    }

    return result;
  }

  /**
   * Detect circular dependencies using DFS with coloring
   */
  detectCycles(): CircularDependency[] {
    const cycles: CircularDependency[] = [];
    const WHITE = 0; // Unvisited
    const GRAY = 1; // In current path
    const BLACK = 2; // Fully processed

    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();

    // Initialize all nodes as white
    for (const tableName of this.graph.keys()) {
      color.set(tableName, WHITE);
      parent.set(tableName, null);
    }

    // DFS from each unvisited node
    for (const tableName of this.graph.keys()) {
      if (color.get(tableName) === WHITE) {
        this.dfsDetectCycle(tableName, color, parent, cycles);
      }
    }

    return cycles;
  }

  /**
   * DFS helper for cycle detection
   */
  private dfsDetectCycle(
    node: string,
    color: Map<string, number>,
    parent: Map<string, string | null>,
    cycles: CircularDependency[]
  ): void {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    color.set(node, GRAY);

    const graphNode = this.graph.get(node);
    if (graphNode) {
      for (const dep of graphNode.dependencies) {
        const depColor = color.get(dep);

        if (depColor === WHITE) {
          parent.set(dep, node);
          this.dfsDetectCycle(dep, color, parent, cycles);
        } else if (depColor === GRAY) {
          // Found a cycle! Reconstruct the path
          const path: string[] = [];
          let current: string | null = node;

          while (current && current !== dep) {
            path.unshift(current);
            current = parent.get(current) ?? null;
          }
          path.unshift(dep);
          path.push(dep); // Complete the cycle

          // Get unique tables in cycle
          const tables = [...new Set(path.slice(0, -1))];

          // Check if this cycle is already recorded
          const cycleKey = [...tables].sort().join(',');
          const existingCycle = cycles.find(
            (c) => [...c.tables].sort().join(',') === cycleKey
          );

          if (!existingCycle) {
            cycles.push({ tables, path });
          }
        }
      }
    }

    color.set(node, BLACK);
  }

  /**
   * Get all tables that depend on the given table (direct and indirect)
   */
  getAllDependents(tableName: string): string[] {
    const result = new Set<string>();
    const queue = [tableName];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.graph.get(current);

      if (node) {
        for (const dependent of node.dependents) {
          if (!result.has(dependent)) {
            result.add(dependent);
            queue.push(dependent);
          }
        }
      }
    }

    return [...result];
  }

  /**
   * Get all tables that the given table depends on (direct and indirect)
   */
  getAllDependencies(tableName: string): string[] {
    const result = new Set<string>();
    const queue = [tableName];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.graph.get(current);

      if (node) {
        for (const dep of node.dependencies) {
          if (!result.has(dep)) {
            result.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    return [...result];
  }

  /**
   * Get dependency depth (distance from root)
   * Uses visited set to prevent infinite recursion on circular dependencies
   */
  getDependencyDepth(
    tableName: string,
    visited: Set<string> = new Set()
  ): number {
    // Prevent infinite recursion on circular dependencies
    if (visited.has(tableName)) {
      return 0; // Break the cycle
    }

    const node = this.graph.get(tableName);
    if (!node || node.dependencies.length === 0) {
      return 0;
    }

    visited.add(tableName);

    let maxDepth = 0;
    for (const dep of node.dependencies) {
      const depDepth = this.getDependencyDepth(dep, visited);
      maxDepth = Math.max(maxDepth, depDepth + 1);
    }

    visited.delete(tableName); // Allow revisiting from different paths

    return maxDepth;
  }

  /**
   * Group tables by dependency level
   */
  groupByLevel(): Map<number, string[]> {
    const levels = new Map<number, string[]>();

    for (const tableName of this.graph.keys()) {
      const depth = this.getDependencyDepth(tableName);
      const level = levels.get(depth) || [];
      level.push(tableName);
      levels.set(depth, level);
    }

    return levels;
  }

  /**
   * Check if table A depends on table B (directly or indirectly)
   */
  dependsOn(tableA: string, tableB: string): boolean {
    const allDeps = this.getAllDependencies(tableA);
    return allDeps.includes(tableB);
  }

  /**
   * Get migration order with optional table filtering
   */
  getMigrationOrder(
    tables: TableInfo[],
    options: {
      include?: string[];
      exclude?: string[];
    } = {}
  ): string[] {
    const result = this.resolve(tables);

    let order = result.order;

    // Apply include filter
    if (options.include && options.include.length > 0) {
      const includeSet = new Set(options.include);
      // Also include dependencies of included tables
      const withDeps = new Set<string>();
      for (const tableName of includeSet) {
        withDeps.add(tableName);
        const deps = this.getAllDependencies(tableName);
        for (const dep of deps) {
          withDeps.add(dep);
        }
      }
      order = order.filter((t) => withDeps.has(t));
    }

    // Apply exclude filter
    if (options.exclude && options.exclude.length > 0) {
      const excludeSet = new Set(options.exclude);
      order = order.filter((t) => !excludeSet.has(t));
    }

    return order;
  }

  /**
   * Format dependency graph for display
   */
  formatGraph(): string {
    const lines: string[] = ['Dependency Graph:', ''];

    const levels = this.groupByLevel();
    const sortedLevels = [...levels.keys()].sort((a, b) => a - b);

    for (const level of sortedLevels) {
      const tables = levels.get(level) || [];
      lines.push(`Level ${level}:`);

      for (const tableName of tables.sort()) {
        const node = this.graph.get(tableName);
        if (node) {
          const deps =
            node.dependencies.length > 0
              ? ` -> [${node.dependencies.join(', ')}]`
              : '';
          lines.push(`  ${tableName}${deps}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Suggest how to break circular dependencies
   */
  suggestCycleBreaks(cycles: CircularDependency[]): string[] {
    const suggestions: string[] = [];

    for (const cycle of cycles) {
      suggestions.push(
        `Circular dependency detected: ${cycle.path.join(' -> ')}`
      );
      suggestions.push('  Suggestions to resolve:');

      // Find the weakest link (nullable FK or least important relationship)
      for (const tableName of cycle.tables) {
        const table = this.tables.get(tableName);
        if (table) {
          for (const fk of table.foreignKeys) {
            if (cycle.tables.includes(fk.referencedTable)) {
              const column = table.columns.find(
                (c) => c.columnName === fk.columnName
              );
              if (column?.isNullable) {
                suggestions.push(
                  `  - Consider deferring ${tableName}.${fk.columnName} (nullable FK to ${fk.referencedTable})`
                );
                suggestions.push(
                  `    Migrate ${tableName} first with NULL values, then update after ${fk.referencedTable} is migrated`
                );
              }
            }
          }
        }
      }

      suggestions.push('');
    }

    return suggestions;
  }
}
