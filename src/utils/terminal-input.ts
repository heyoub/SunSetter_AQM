/**
 * Windows-compatible terminal input helpers
 *
 * Uses terminal: false to avoid raw mode issues on Windows terminals.
 * All input is line-based (press Enter to submit).
 */

import * as readline from 'readline';

/**
 * Reset terminal to clean state (fixes issues after inquirer usage)
 */
function resetTerminal(): void {
  // Ensure stdin is not in raw mode
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // Ignore errors
    }
  }
  // Resume stdin if paused
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }
}

/**
 * Create a readline interface with safe defaults
 */
function createRL(): readline.Interface {
  resetTerminal();
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false, // CRITICAL: Prevents raw mode and echo doubling
  });
}

/**
 * Simple text input
 */
export async function textInput(
  prompt: string,
  defaultValue?: string
): Promise<string> {
  const rl = createRL();

  const displayPrompt = defaultValue
    ? `${prompt} [${defaultValue}]: `
    : `${prompt}: `;

  process.stdout.write(displayPrompt);

  return new Promise((resolve) => {
    rl.once('line', (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Password input (note: characters will be visible on Windows)
 */
export async function passwordInput(prompt: string): Promise<string> {
  const rl = createRL();

  process.stdout.write(`${prompt}: `);

  return new Promise((resolve) => {
    rl.once('line', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Yes/No confirmation
 */
export async function confirm(
  prompt: string,
  defaultValue = true
): Promise<boolean> {
  const rl = createRL();

  const defaultHint = defaultValue ? '[Y/n]' : '[y/N]';
  process.stdout.write(`${prompt} ${defaultHint}: `);

  return new Promise((resolve) => {
    rl.once('line', (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) {
        resolve(defaultValue);
      } else {
        resolve(trimmed === 'y' || trimmed === 'yes');
      }
    });
  });
}

/**
 * Number input
 */
export async function numberInput(
  prompt: string,
  defaultValue?: number
): Promise<number> {
  const result = await textInput(prompt, defaultValue?.toString());
  const num = parseInt(result, 10);
  return isNaN(num) ? (defaultValue ?? 0) : num;
}

/**
 * Simple list selection using numbers
 */
export async function selectFromList<T>(
  prompt: string,
  choices: Array<{ name: string; value: T }>
): Promise<T> {
  if (prompt) {
    console.log(prompt);
    console.log();
  }

  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choice.name}`);
  });

  console.log();

  const askForSelection = async (): Promise<T> => {
    const rl = createRL();

    process.stdout.write(`Enter choice (1-${choices.length}): `);

    return new Promise((resolve) => {
      rl.once('line', async (answer) => {
        rl.close();
        const num = parseInt(answer.trim(), 10);
        if (num >= 1 && num <= choices.length) {
          resolve(choices[num - 1].value);
        } else {
          console.log(`Please enter a number between 1 and ${choices.length}`);
          resolve(await askForSelection());
        }
      });
    });
  };

  return askForSelection();
}

/**
 * Multi-select using comma-separated numbers
 */
export async function multiSelectFromList<T>(
  prompt: string,
  choices: Array<{ name: string; value: T; checked?: boolean }>
): Promise<T[]> {
  if (prompt) {
    console.log(prompt);
    console.log();
  }

  choices.forEach((choice, index) => {
    const check = choice.checked ? '✓' : ' ';
    console.log(`  [${check}] ${index + 1}. ${choice.name}`);
  });

  console.log();
  console.log('Enter numbers separated by commas (e.g., 1,3,5) or "all"');
  console.log();

  const rl = createRL();

  process.stdout.write('Selection: ');

  return new Promise((resolve) => {
    rl.once('line', (answer) => {
      rl.close();

      const trimmed = answer.trim().toLowerCase();

      if (trimmed === 'all') {
        resolve(choices.map((c) => c.value));
        return;
      }

      const nums = trimmed.split(',').map((s) => parseInt(s.trim(), 10));
      const selected = nums
        .filter((n) => n >= 1 && n <= choices.length)
        .map((n) => choices[n - 1].value);

      resolve(selected);
    });
  });
}
