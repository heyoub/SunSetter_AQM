/**
 * SunSetter AQM+ Branding
 *
 * ASCII art, colors, and visual identity for the TUI.
 * AQM = Actions, Queries, Mutations
 */

import gradient from 'gradient-string';
import chalk from 'chalk';

// Type for gradient function result
type GradientFn = ReturnType<typeof gradient>;

// ============================================================================
// Color Themes
// ============================================================================

/**
 * SunSetter gradient - warm sunset colors
 */
export const sunsetGradient: GradientFn = gradient([
  '#FF6B35', // Orange
  '#FF3864', // Pink-red
  '#9B59B6', // Purple
  '#3498DB', // Blue
]);

/**
 * Fire gradient for intense moments
 */
export const fireGradient: GradientFn = gradient([
  '#FF0000', // Red
  '#FF4500', // Orange-red
  '#FF8C00', // Dark orange
  '#FFD700', // Gold
]);

/**
 * Ocean gradient for calm states
 */
export const oceanGradient: GradientFn = gradient([
  '#00CED1', // Dark turquoise
  '#20B2AA', // Light sea green
  '#5F9EA0', // Cadet blue
  '#4682B4', // Steel blue
]);

/**
 * Success gradient
 */
export const successGradient: GradientFn = gradient([
  '#00FF00', // Lime
  '#32CD32', // Lime green
  '#228B22', // Forest green
]);

/**
 * Matrix-style gradient
 */
export const matrixGradient: GradientFn = gradient([
  '#00FF00',
  '#00DD00',
  '#00BB00',
  '#009900',
]);

// ============================================================================
// ASCII Art Logos
// ============================================================================

export const LOGO_SMALL = `
  ╔═══════════════════════════════════════╗
  ║   ☀️  S U N S E T T E R   A Q M +   ☀️   ║
  ║      Actions · Queries · Mutations     ║
  ╚═══════════════════════════════════════╝
`;

export const LOGO_LARGE = `
   ███████╗██╗   ██╗███╗   ██╗███████╗███████╗████████╗████████╗███████╗██████╗
   ██╔════╝██║   ██║████╗  ██║██╔════╝██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗
   ███████╗██║   ██║██╔██╗ ██║███████╗█████╗     ██║      ██║   █████╗  ██████╔╝
   ╚════██║██║   ██║██║╚██╗██║╚════██║██╔══╝     ██║      ██║   ██╔══╝  ██╔══██╗
   ███████║╚██████╔╝██║ ╚████║███████║███████╗   ██║      ██║   ███████╗██║  ██║
   ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝╚══════╝   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝

        █████╗  ██████╗ ███╗   ███╗    ╔═╗
       ██╔══██╗██╔═══██╗████╗ ████║    ╠═╣
       ███████║██║   ██║██╔████╔██║    ║ ║
       ██╔══██║██║▄▄ ██║██║╚██╔╝██║    ║ ║
       ██║  ██║╚██████╔╝██║ ╚═╝ ██║    ╚═╝ +
       ╚═╝  ╚═╝ ╚══▀▀═╝ ╚═╝     ╚═╝
`;

export const LOGO_SUNSET = `
                          . . .
                   . . . . . . . . . .
               . . . ☀ . . . . . ☀ . . . .
           . . . . . . ═══════════ . . . . . .
         . . . . ═══════════════════════ . . . .
       . . . ═══════ SUNSETTER ═══════ . . .
     . . . ═══════════ AQM+ ═══════════ . . .
   . . . ═════ Actions·Queries·Mutations ═════ . . .
`;

export const LOGO_MINIMAL = `
┌─────────────────────────────────────────┐
│  ☀ SUNSETTER AQM+                       │
│  ══════════════════                     │
│  Actions · Queries · Mutations          │
│  Database → Convex Migration Tool       │
└─────────────────────────────────────────┘
`;

export const LOGO_NEON = `
╭──────────────────────────────────────────────────────────────────────────────╮
│ ░██████╗██╗░░░██╗███╗░░██╗░██████╗███████╗████████╗████████╗███████╗██████╗░ │
│ ██╔════╝██║░░░██║████╗░██║██╔════╝██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗ │
│ ╚█████╗░██║░░░██║██╔██╗██║╚█████╗░█████╗░░░░░██║░░░░░░██║░░░█████╗░░██████╔╝ │
│ ░╚═══██╗██║░░░██║██║╚████║░╚═══██╗██╔══╝░░░░░██║░░░░░░██║░░░██╔══╝░░██╔══██╗ │
│ ██████╔╝╚██████╔╝██║░╚███║██████╔╝███████╗░░░██║░░░░░░██║░░░███████╗██║░░██║ │
│ ╚═════╝░░╚═════╝░╚═╝░░╚══╝╚═════╝░╚══════╝░░░╚═╝░░░░░░╚═╝░░░╚══════╝╚═╝░░╚═╝ │
│                                                                              │
│                       █▀▀█ █▀▀█ █▀▄▀█  ╋                                     │
│                       █▄▄█ █──█ █─▀─█  +                                     │
│                       ▀──▀ ▀▀▀▀ ▀───▀                                        │
│                                                                              │
│               Actions  ·  Queries  ·  Mutations                              │
╰──────────────────────────────────────────────────────────────────────────────╯
`;

// ============================================================================
// Animated Frames
// ============================================================================

export const SUN_FRAMES = ['☀️ ', '🌤️', '⛅', '🌥️', '☁️ ', '🌥️', '⛅', '🌤️'];

export const FIRE_FRAMES = ['🔥', '💥', '✨', '⚡', '💫', '⭐', '✨', '💥'];

export const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];

export const PROGRESS_CHARS = {
  filled: '█',
  partial: ['▏', '▎', '▍', '▌', '▋', '▊', '▉'],
  empty: '░',
};

export const BOX_CHARS = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  cross: '┼',
  teeDown: '┬',
  teeUp: '┴',
  teeRight: '├',
  teeLeft: '┤',
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Print the logo with sunset gradient
 */
export function printLogo(
  style: 'small' | 'large' | 'sunset' | 'minimal' | 'neon' = 'neon'
): void {
  const logos: Record<string, string> = {
    small: LOGO_SMALL,
    large: LOGO_LARGE,
    sunset: LOGO_SUNSET,
    minimal: LOGO_MINIMAL,
    neon: LOGO_NEON,
  };

  console.log(sunsetGradient.multiline(logos[style]));
}

/**
 * Print a gradient text
 */
export function printGradient(
  text: string,
  type: 'sunset' | 'fire' | 'ocean' | 'success' | 'matrix' = 'sunset'
): void {
  const gradients: Record<string, typeof sunsetGradient> = {
    sunset: sunsetGradient,
    fire: fireGradient,
    ocean: oceanGradient,
    success: successGradient,
    matrix: matrixGradient,
  };

  console.log(gradients[type](text));
}

/**
 * Create a boxed message
 */
export function boxMessage(message: string, title?: string): string {
  const lines = message.split('\n');
  const maxWidth = Math.max(...lines.map((l) => l.length), title?.length || 0);
  const width = maxWidth + 4;

  let box =
    BOX_CHARS.topLeft +
    BOX_CHARS.horizontal.repeat(width) +
    BOX_CHARS.topRight +
    '\n';

  if (title) {
    const padding = Math.floor((width - title.length) / 2);
    box +=
      BOX_CHARS.vertical +
      ' '.repeat(padding) +
      chalk.bold(title) +
      ' '.repeat(width - padding - title.length) +
      BOX_CHARS.vertical +
      '\n';
    box +=
      BOX_CHARS.teeRight +
      BOX_CHARS.horizontal.repeat(width) +
      BOX_CHARS.teeLeft +
      '\n';
  }

  for (const line of lines) {
    const padding = width - line.length - 2;
    box +=
      BOX_CHARS.vertical +
      ' ' +
      line +
      ' '.repeat(padding) +
      ' ' +
      BOX_CHARS.vertical +
      '\n';
  }

  box +=
    BOX_CHARS.bottomLeft +
    BOX_CHARS.horizontal.repeat(width) +
    BOX_CHARS.bottomRight;

  return box;
}

/**
 * Create a progress bar
 */
export function createProgressBar(
  progress: number,
  width: number = 40,
  showPercent: boolean = true
): string {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const filledWidth = Math.floor(clampedProgress * width);
  const partialIndex = Math.floor((clampedProgress * width - filledWidth) * 8);

  let bar = PROGRESS_CHARS.filled.repeat(filledWidth);

  if (partialIndex > 0 && filledWidth < width) {
    bar += PROGRESS_CHARS.partial[partialIndex - 1];
  }

  bar += PROGRESS_CHARS.empty.repeat(Math.max(0, width - bar.length));

  const percentText = showPercent
    ? ` ${Math.round(clampedProgress * 100)}%`
    : '';

  return `[${bar}]${percentText}`;
}

export { formatNumber, formatBytes, formatDuration } from '../utils/formatting.js';

/**
 * Get a status icon
 */
export function getStatusIcon(
  status: 'pending' | 'running' | 'success' | 'error' | 'warning'
): string {
  const icons: Record<string, string> = {
    pending: '○',
    running: '◉',
    success: '✓',
    error: '✗',
    warning: '⚠',
  };

  const colors: Record<string, (s: string) => string> = {
    pending: chalk.gray,
    running: chalk.cyan,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
  };

  return colors[status](icons[status]);
}

/**
 * Get terminal width with safe fallback
 */
export function getTermWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Center text in terminal
 */
export function centerText(text: string, width?: number): string {
  const w = width || getTermWidth();
  const padding = Math.max(0, Math.floor((w - text.length) / 2));
  return ' '.repeat(padding) + text;
}

/**
 * Print a horizontal divider
 */
export function printDivider(char = '─'): void {
  const width = Math.min(getTermWidth() - 2, 60);
  console.log(chalk.dim(char.repeat(width)));
}

/**
 * Print a section header
 */
export function printHeader(text: string): void {
  const width = Math.min(getTermWidth() - 4, 50);
  console.log();
  console.log(chalk.cyan('━'.repeat(width)));
  console.log(chalk.cyan.bold(`  ${text}`));
  console.log(chalk.cyan('━'.repeat(width)));
  console.log();
}

// ============================================================================
// Exports
// ============================================================================

export const VERSION = '1.6.0';
export const APP_NAME = 'SunSetter AQM+';
export const APP_TAGLINE = 'Actions · Queries · Mutations';
export const APP_DESCRIPTION = 'Database → Convex Migration Tool';
