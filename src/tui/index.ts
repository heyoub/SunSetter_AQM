/**
 * SunSetter AQM+ TUI Module
 *
 * Terminal User Interface for database migration.
 * Provides a beautiful, interactive experience for migrating
 * databases to Convex.
 */

// Branding exports
export {
  sunsetGradient,
  fireGradient,
  successGradient,
  LOGO_SMALL,
  LOGO_LARGE,
  LOGO_SUNSET,
  LOGO_MINIMAL,
  LOGO_NEON,
  SUN_FRAMES,
  FIRE_FRAMES,
  SPINNER_FRAMES,
  PROGRESS_CHARS,
  BOX_CHARS,
  printLogo,
  printGradient,
  boxMessage,
  createProgressBar,
  formatNumber,
  formatBytes,
  formatDuration,
  getStatusIcon,
  getTermWidth,
  printDivider,
  printHeader,
  centerText,
  APP_NAME,
  APP_TAGLINE,
  APP_DESCRIPTION,
  VERSION,
} from './branding.js';

// Dashboard exports
export {
  Dashboard,
  createDashboard,
  type TableStatus,
  type MigrationStats,
  type DashboardConfig,
} from './dashboard.js';

// Screen exports
export {
  WelcomeScreen,
  showWelcomeScreen,
  type WelcomeResult,
} from './screens/welcome.js';

export {
  TableSelectorScreen,
  showTableSelector,
  type TableInfo as TableSelectorInfo,
  type TableSelectorResult,
} from './screens/table-selector.js';
