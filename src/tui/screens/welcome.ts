/**
 * SunSetter AQM+ Welcome Screen
 *
 * Animated welcome screen with logo and quick-start options.
 */

import blessed from 'blessed';
import {
  LOGO_NEON,
  APP_NAME,
  APP_TAGLINE,
  VERSION,
  SUN_FRAMES,
} from '../branding.js';

// ============================================================================
// Types
// ============================================================================

export interface WelcomeResult {
  action: 'migrate' | 'generate' | 'introspect' | 'help' | 'quit';
}

// ============================================================================
// Welcome Screen
// ============================================================================

export class WelcomeScreen {
  private screen: blessed.Widgets.Screen;
  private sunIndex = 0;
  private animationInterval: NodeJS.Timeout | null = null;
  private resolvePromise: ((result: WelcomeResult) => void) | null = null;

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: `${APP_NAME} v${VERSION}`,
      fullUnicode: true,
    });
  }

  /**
   * Show the welcome screen
   */
  public async show(): Promise<WelcomeResult> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.render();
      this.startAnimation();
    });
  }

  /**
   * Render the welcome screen
   */
  private render(): void {
    // Background
    blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      style: {
        bg: '#0d0d1a',
      },
    });

    // Logo
    blessed.box({
      parent: this.screen,
      top: 2,
      left: 'center',
      width: 82,
      height: 15,
      content: LOGO_NEON,
      tags: true,
      style: {
        fg: '#FF6B35',
      },
    });

    // Animated sun
    const sunBox = blessed.box({
      parent: this.screen,
      top: 2,
      right: 5,
      width: 3,
      height: 1,
      content: SUN_FRAMES[0],
      tags: true,
    });

    // Menu box
    const menuBox = blessed.box({
      parent: this.screen,
      top: 18,
      left: 'center',
      width: 60,
      height: 10,
      border: { type: 'line' },
      style: {
        border: { fg: '#9B59B6' },
        fg: 'white',
      },
      label: ' Quick Start ',
    });

    // Menu items
    const menuList = blessed.list({
      parent: menuBox,
      top: 1,
      left: 2,
      width: '95%',
      height: 6,
      items: [
        '{#FF6B35-fg}[1]{/} Start Migration   - Database to Convex',
        '{#FF6B35-fg}[2]{/} Generate Schema   - Convex schema only',
        '{#FF6B35-fg}[3]{/} Introspect DB     - View structure',
        '{#FF6B35-fg}[4]{/} Help',
        '{#FF6B35-fg}[Q]{/} Quit',
      ],
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: {
          bg: '#FF6B35',
          fg: 'black',
        },
        item: {
          fg: 'white',
        },
      },
    });

    // Version info
    blessed.box({
      parent: this.screen,
      bottom: 1,
      left: 'center',
      width: 60,
      height: 1,
      content: `{center}{#666666-fg}${APP_NAME} v${VERSION} | ${APP_TAGLINE}{/}{/center}`,
      tags: true,
    });

    // Keyboard hints
    blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content:
        '  {bold}↑/↓{/bold} Navigate  {bold}Enter{/bold} Select  {bold}1-4{/bold} Quick Select  {bold}Q{/bold} Quit',
      tags: true,
      style: {
        bg: '#1a1a2e',
        fg: '#999999',
      },
    });

    // Setup key handlers
    this.screen.key(['escape', 'q', 'Q'], () => {
      this.stop();
      this.resolvePromise?.({ action: 'quit' });
    });

    this.screen.key(['1'], () => {
      this.stop();
      this.resolvePromise?.({ action: 'migrate' });
    });

    this.screen.key(['2'], () => {
      this.stop();
      this.resolvePromise?.({ action: 'generate' });
    });

    this.screen.key(['3'], () => {
      this.stop();
      this.resolvePromise?.({ action: 'introspect' });
    });

    this.screen.key(['4', '?', 'h'], () => {
      this.stop();
      this.resolvePromise?.({ action: 'help' });
    });

    menuList.on('select', (item, index) => {
      this.stop();
      const actions: WelcomeResult['action'][] = [
        'migrate',
        'generate',
        'introspect',
        'help',
        'quit',
      ];
      this.resolvePromise?.({ action: actions[index] });
    });

    menuList.focus();

    // Store sunBox for animation
    (this as any).sunBox = sunBox;

    this.screen.render();
  }

  /**
   * Start sun animation
   */
  private startAnimation(): void {
    this.animationInterval = setInterval(() => {
      this.sunIndex = (this.sunIndex + 1) % SUN_FRAMES.length;
      const sunBox = (this as any).sunBox;
      if (sunBox) {
        sunBox.setContent(SUN_FRAMES[this.sunIndex]);
        this.screen.render();
      }
    }, 200);
  }

  /**
   * Stop and cleanup
   */
  private stop(): void {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    }
    this.screen.destroy();
  }
}

// ============================================================================
// Factory
// ============================================================================

export async function showWelcomeScreen(): Promise<WelcomeResult> {
  const screen = new WelcomeScreen();
  return screen.show();
}
