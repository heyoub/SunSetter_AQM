/**
 * TypeScript Type Checker Utility
 *
 * Auto-detects tsconfig.json and validates generated code.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Result of a typecheck operation
 */
export interface TypecheckResult {
  success: boolean;
  errorCount: number;
  warningCount: number;
  errors: TypecheckError[];
  tsconfigPath: string | null;
  duration: number;
}

/**
 * Individual typecheck error
 */
export interface TypecheckError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Find tsconfig.json by searching up from the given directory
 */
export async function findTsConfig(startDir: string): Promise<string | null> {
  // First check the start directory itself
  const directPath = path.join(startDir, 'tsconfig.json');
  try {
    await fs.access(directPath);
    return directPath;
  } catch {
    // Not found in start dir
  }

  // Walk up the directory tree
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const tsconfigPath = path.join(currentDir, 'tsconfig.json');
    try {
      await fs.access(tsconfigPath);
      return tsconfigPath;
    } catch {
      // Not found, go up one level
      currentDir = path.dirname(currentDir);
    }
  }

  return null;
}

/**
 * Parse TypeScript compiler output into structured errors
 */
function parseTscOutput(output: string): TypecheckError[] {
  const errors: TypecheckError[] = [];

  // TypeScript error format: file(line,col): error TSxxxx: message
  const errorRegex =
    /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;

  let match;
  while ((match = errorRegex.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      severity: match[4] as 'error' | 'warning',
      code: match[5],
      message: match[6],
    });
  }

  return errors;
}

/**
 * Run TypeScript compiler in noEmit mode to check types
 */
export async function typecheck(
  targetDir: string,
  tsconfigPath?: string
): Promise<TypecheckResult> {
  const startTime = Date.now();

  // Auto-detect tsconfig if not provided
  const tsconfig = tsconfigPath || (await findTsConfig(targetDir));

  if (!tsconfig) {
    return {
      success: false,
      errorCount: 1,
      warningCount: 0,
      errors: [
        {
          file: targetDir,
          line: 0,
          column: 0,
          code: 'CONFIG',
          message: 'No tsconfig.json found. Create one or specify path.',
          severity: 'error',
        },
      ],
      tsconfigPath: null,
      duration: Date.now() - startTime,
    };
  }

  return new Promise((resolve) => {
    const args = ['--noEmit', '--project', tsconfig];

    // Try to use local tsc first, fall back to npx
    const tsc = spawn('npx', ['tsc', ...args], {
      cwd: path.dirname(tsconfig),
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    tsc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    tsc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    tsc.on('close', (code) => {
      const output = stdout + stderr;
      const errors = parseTscOutput(output);

      const errorCount = errors.filter((e) => e.severity === 'error').length;
      const warningCount = errors.filter(
        (e) => e.severity === 'warning'
      ).length;

      resolve({
        success: code === 0,
        errorCount,
        warningCount,
        errors,
        tsconfigPath: tsconfig,
        duration: Date.now() - startTime,
      });
    });

    tsc.on('error', (err) => {
      resolve({
        success: false,
        errorCount: 1,
        warningCount: 0,
        errors: [
          {
            file: 'tsc',
            line: 0,
            column: 0,
            code: 'SPAWN',
            message: `Failed to run TypeScript compiler: ${err.message}`,
            severity: 'error',
          },
        ],
        tsconfigPath: tsconfig,
        duration: Date.now() - startTime,
      });
    });
  });
}

/**
 * Format typecheck results for console output
 */
export function formatTypecheckResult(
  result: TypecheckResult,
  colors: {
    red: (s: string) => string;
    yellow: (s: string) => string;
    green: (s: string) => string;
    gray: (s: string) => string;
    cyan: (s: string) => string;
    white: (s: string) => string;
  }
): string[] {
  const lines: string[] = [];

  if (result.success) {
    lines.push(colors.green('✓ Type check passed!'));
    lines.push(colors.gray(`  Checked against: ${result.tsconfigPath}`));
    lines.push(colors.gray(`  Duration: ${result.duration}ms`));
  } else {
    lines.push(
      colors.red(`✗ Type check failed: ${result.errorCount} error(s)`)
    );

    if (result.tsconfigPath) {
      lines.push(colors.gray(`  Using: ${result.tsconfigPath}`));
    }
    lines.push('');

    // Group errors by file
    const byFile = new Map<string, TypecheckError[]>();
    for (const error of result.errors) {
      const existing = byFile.get(error.file) || [];
      existing.push(error);
      byFile.set(error.file, existing);
    }

    for (const [file, fileErrors] of byFile) {
      lines.push(colors.cyan(`  ${file}`));

      for (const error of fileErrors.slice(0, 5)) {
        // Show max 5 per file
        const loc = colors.gray(`(${error.line}:${error.column})`);
        const code = colors.yellow(`[${error.code}]`);
        const msg =
          error.severity === 'error'
            ? colors.red(error.message)
            : colors.yellow(error.message);
        lines.push(`    ${loc} ${code} ${msg}`);
      }

      if (fileErrors.length > 5) {
        lines.push(
          colors.gray(
            `    ... and ${fileErrors.length - 5} more errors in this file`
          )
        );
      }
      lines.push('');
    }

    // Suggestions
    lines.push(colors.white('Suggestions:'));
    lines.push(
      colors.gray('  • Check that Convex types are installed: npm i convex')
    );
    lines.push(
      colors.gray('  • Ensure tsconfig includes the output directory')
    );
    lines.push(colors.gray('  • Run: npx tsc --noEmit for full output'));
  }

  return lines;
}
