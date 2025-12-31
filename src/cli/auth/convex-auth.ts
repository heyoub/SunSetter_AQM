/**
 * Convex Authentication Flow
 *
 * Provides seamless authentication with Convex:
 * 1. Detect existing credentials (env vars, .env files, convex.json)
 * 2. Browser-based OAuth with localhost callback
 * 3. Manual credential entry fallback
 *
 * Inspired by: GitHub CLI, Vercel CLI, Stripe CLI
 */

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URL } from 'url';
import chalk from 'chalk';
import open from 'open';

// ============================================================================
// Types
// ============================================================================

export interface ConvexCredentials {
  deploymentUrl: string;
  deployKey: string;
  projectName?: string;
}

export interface AuthResult {
  success: boolean;
  credentials?: ConvexCredentials;
  source?: 'env' | 'file' | 'browser' | 'manual';
  error?: string;
}

interface ConvexProject {
  name: string;
  deploymentUrl: string;
}

// ============================================================================
// Credential Detection
// ============================================================================

/**
 * Check for existing Convex credentials from multiple sources
 */
export async function detectExistingCredentials(): Promise<AuthResult | null> {
  // 1. Check environment variables
  const envCreds = checkEnvVars();
  if (envCreds) {
    return { success: true, credentials: envCreds, source: 'env' };
  }

  // 2. Check .env.local in current directory
  const envLocalCreds = await checkEnvFile('.env.local');
  if (envLocalCreds) {
    return { success: true, credentials: envLocalCreds, source: 'file' };
  }

  // 3. Check .env in current directory
  const envCreds2 = await checkEnvFile('.env');
  if (envCreds2) {
    return { success: true, credentials: envCreds2, source: 'file' };
  }

  // 4. Check convex.json for project info
  const convexJson = await checkConvexJson();
  if (convexJson) {
    // We have project info but may still need deploy key
    return { success: true, credentials: convexJson, source: 'file' };
  }

  return null;
}

function checkEnvVars(): ConvexCredentials | null {
  const deploymentUrl = process.env.CONVEX_URL || process.env.CONVEX_DEPLOYMENT;
  const deployKey = process.env.CONVEX_DEPLOY_KEY || process.env.CONVEX_ADMIN_KEY;

  if (deploymentUrl && deployKey) {
    return { deploymentUrl, deployKey };
  }
  return null;
}

async function checkEnvFile(filename: string): Promise<ConvexCredentials | null> {
  const filepath = path.join(process.cwd(), filename);

  try {
    if (!fs.existsSync(filepath)) return null;

    const content = fs.readFileSync(filepath, 'utf-8');
    const vars: Record<string, string> = {};

    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match) {
        vars[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }

    const deploymentUrl = vars.CONVEX_URL || vars.CONVEX_DEPLOYMENT;
    const deployKey = vars.CONVEX_DEPLOY_KEY || vars.CONVEX_ADMIN_KEY;

    if (deploymentUrl && deployKey) {
      return { deploymentUrl, deployKey };
    }
  } catch {
    // File not readable
  }

  return null;
}

async function checkConvexJson(): Promise<ConvexCredentials | null> {
  const filepath = path.join(process.cwd(), 'convex.json');

  try {
    if (!fs.existsSync(filepath)) return null;

    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));

    if (content.prodUrl) {
      return {
        deploymentUrl: content.prodUrl,
        deployKey: '', // Need to get from dashboard
        projectName: content.project,
      };
    }
  } catch {
    // File not readable or invalid JSON
  }

  return null;
}

// ============================================================================
// Browser-Based Authentication
// ============================================================================

const CONVEX_DASHBOARD = 'https://dashboard.convex.dev';
const CALLBACK_TIMEOUT_MS = 300000; // 5 minutes

/**
 * Start browser-based authentication flow
 * Opens Convex dashboard and captures credentials via localhost callback
 */
export async function authenticateViaBrowser(
  options: {
    onStatusChange?: (status: string) => void;
    skipOpen?: boolean;
  } = {}
): Promise<AuthResult> {
  const { onStatusChange, skipOpen } = options;

  return new Promise((resolve) => {
    // Find available port
    const server = http.createServer();

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        resolve({ success: false, error: 'Failed to start callback server' });
        return;
      }

      const port = address.port;
      const callbackUrl = `http://127.0.0.1:${port}/callback`;

      // The auth URL - Convex doesn't have a direct OAuth flow for CLI,
      // so we'll guide users to the dashboard and have them paste credentials
      const authUrl = `${CONVEX_DASHBOARD}/deployment/settings`;

      onStatusChange?.('Starting authentication server...');

      // Set up request handler
      server.on('request', (req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);

        if (url.pathname === '/callback') {
          // Parse credentials from query params
          const deploymentUrl = url.searchParams.get('url');
          const deployKey = url.searchParams.get('key');

          if (deploymentUrl && deployKey) {
            // Success! Send nice response
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(getSuccessHtml());

            server.close();
            resolve({
              success: true,
              credentials: { deploymentUrl, deployKey },
              source: 'browser',
            });
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(getErrorHtml('Missing credentials in callback'));
          }
        } else if (url.pathname === '/') {
          // Serve the credential input page
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getInputHtml(port));
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      // Set timeout
      const timeout = setTimeout(() => {
        server.close();
        resolve({ success: false, error: 'Authentication timed out' });
      }, CALLBACK_TIMEOUT_MS);

      server.on('close', () => clearTimeout(timeout));

      // Open browser
      const inputUrl = `http://127.0.0.1:${port}/`;

      onStatusChange?.(`Opening browser...`);

      if (!skipOpen) {
        open(inputUrl).catch(() => {
          onStatusChange?.(`Could not open browser. Visit: ${inputUrl}`);
        });
      }

      onStatusChange?.(`
┌─────────────────────────────────────────────────────────────┐
│  ${chalk.cyan('🔐 Convex Authentication')}                                   │
│                                                             │
│  A browser window should open automatically.                │
│  If not, visit: ${chalk.yellow(inputUrl)}                     │
│                                                             │
│  ${chalk.dim('Steps:')}                                                      │
│  ${chalk.dim('1. Log in to Convex Dashboard')}                               │
│  ${chalk.dim('2. Copy your Deployment URL and Deploy Key')}                  │
│  ${chalk.dim('3. Paste them in the browser form')}                           │
│                                                             │
│  ${chalk.dim('Waiting for credentials...')} ${chalk.cyan('⠋')}                              │
└─────────────────────────────────────────────────────────────┘
`);
    });

    server.on('error', (err) => {
      resolve({ success: false, error: `Server error: ${err.message}` });
    });
  });
}

// ============================================================================
// HTML Templates
// ============================================================================

function getInputHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SunSetter AQM+ - Connect to Convex</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: #fff;
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 {
      font-size: 24px;
      margin-bottom: 8px;
      color: #1a1a2e;
    }
    .subtitle {
      color: #666;
      margin-bottom: 24px;
    }
    .step {
      background: #f5f5f5;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .step-number {
      display: inline-block;
      width: 24px;
      height: 24px;
      background: #ff6b35;
      color: white;
      border-radius: 50%;
      text-align: center;
      line-height: 24px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 8px;
    }
    .step a {
      color: #ff6b35;
      text-decoration: none;
    }
    .step a:hover { text-decoration: underline; }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 6px;
      color: #333;
    }
    input {
      width: 100%;
      padding: 12px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      margin-bottom: 16px;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #ff6b35;
    }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(255, 107, 53, 0.4);
    }
    .logo {
      font-size: 32px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">☀️</div>
    <h1>Connect to Convex</h1>
    <p class="subtitle">SunSetter AQM+ needs your Convex credentials to migrate data.</p>

    <div class="step">
      <span class="step-number">1</span>
      <a href="https://dashboard.convex.dev" target="_blank">Open Convex Dashboard →</a>
    </div>

    <div class="step">
      <span class="step-number">2</span>
      Go to your project's <strong>Settings → Deploy Keys</strong>
    </div>

    <div class="step">
      <span class="step-number">3</span>
      Copy and paste your credentials below:
    </div>

    <form id="authForm">
      <label for="url">Deployment URL</label>
      <input type="text" id="url" name="url" placeholder="https://your-project.convex.cloud" required>

      <label for="key">Deploy Key</label>
      <input type="password" id="key" name="key" placeholder="prod:your-deploy-key" required>

      <button type="submit">Connect to Convex</button>
    </form>
  </div>

  <script>
    document.getElementById('authForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const url = document.getElementById('url').value.trim();
      const key = document.getElementById('key').value.trim();
      window.location.href = '/callback?url=' + encodeURIComponent(url) + '&key=' + encodeURIComponent(key);
    });
  </script>
</body>
</html>`;
}

function getSuccessHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connected!</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      text-align: center;
    }
    .container { padding: 40px; }
    .checkmark { font-size: 72px; margin-bottom: 16px; }
    h1 { margin-bottom: 8px; }
    p { opacity: 0.8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✅</div>
    <h1>Connected to Convex!</h1>
    <p>You can close this window and return to the terminal.</p>
  </div>
</body>
</html>`;
}

function getErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      text-align: center;
    }
    .error { color: #ff6b6b; font-size: 72px; }
  </style>
</head>
<body>
  <div>
    <div class="error">❌</div>
    <h1>Authentication Failed</h1>
    <p>${message}</p>
    <p><a href="/" style="color: #ff6b35;">Try again</a></p>
  </div>
</body>
</html>`;
}

// ============================================================================
// Credential Validation
// ============================================================================

/**
 * Validate Convex credentials by making a test API call
 */
export async function validateCredentials(
  credentials: ConvexCredentials
): Promise<{ valid: boolean; error?: string; projectInfo?: ConvexProject }> {
  return new Promise((resolve) => {
    try {
      const url = new URL(credentials.deploymentUrl);

      // Try to hit the Convex API to validate
      const options = {
        hostname: url.hostname,
        port: 443,
        path: '/api/list_tables',
        method: 'POST',
        headers: {
          'Authorization': `Convex ${credentials.deployKey}`,
          'Content-Type': 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({
              valid: true,
              projectInfo: {
                name: url.hostname.split('.')[0],
                deploymentUrl: credentials.deploymentUrl,
              },
            });
          } else if (res.statusCode === 401) {
            resolve({ valid: false, error: 'Invalid deploy key' });
          } else {
            resolve({ valid: false, error: `API returned ${res.statusCode}` });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ valid: false, error: `Connection failed: ${err.message}` });
      });

      req.write(JSON.stringify({}));
      req.end();

      // Timeout after 10 seconds
      setTimeout(() => {
        req.destroy();
        resolve({ valid: false, error: 'Connection timed out' });
      }, 10000);

    } catch (err) {
      resolve({ valid: false, error: `Invalid URL: ${(err as Error).message}` });
    }
  });
}

// ============================================================================
// Main Auth Flow
// ============================================================================

/**
 * Complete authentication flow:
 * 1. Try to detect existing credentials
 * 2. If not found, prompt for browser auth
 * 3. Validate credentials
 * 4. Return result
 */
export async function authenticateConvex(
  options: {
    onStatusChange?: (status: string) => void;
    skipBrowser?: boolean;
    forceNew?: boolean;
  } = {}
): Promise<AuthResult> {
  const { onStatusChange, skipBrowser, forceNew } = options;

  // Try existing credentials first (unless forcing new)
  if (!forceNew) {
    onStatusChange?.('Checking for existing Convex credentials...');
    const existing = await detectExistingCredentials();

    if (existing?.credentials?.deployKey) {
      onStatusChange?.('Found existing credentials, validating...');
      const validation = await validateCredentials(existing.credentials);

      if (validation.valid) {
        onStatusChange?.(`Connected to ${validation.projectInfo?.name || 'Convex'}!`);
        return existing;
      } else {
        onStatusChange?.(`Existing credentials invalid: ${validation.error}`);
      }
    }
  }

  // No valid existing credentials, use browser auth
  if (!skipBrowser) {
    return authenticateViaBrowser({ onStatusChange });
  }

  return { success: false, error: 'No credentials found and browser auth skipped' };
}

/**
 * Save credentials to .env.local for future use
 */
export async function saveCredentials(
  credentials: ConvexCredentials,
  filepath: string = '.env.local'
): Promise<void> {
  const fullPath = path.join(process.cwd(), filepath);

  let content = '';

  // Read existing content if file exists
  if (fs.existsSync(fullPath)) {
    content = fs.readFileSync(fullPath, 'utf-8');

    // Remove existing Convex vars
    content = content
      .split('\n')
      .filter(line => !line.startsWith('CONVEX_URL=') && !line.startsWith('CONVEX_DEPLOY_KEY='))
      .join('\n');

    if (content && !content.endsWith('\n')) {
      content += '\n';
    }
  }

  // Add new credentials
  content += `\n# Convex credentials (added by SunSetter AQM+)\n`;
  content += `CONVEX_URL=${credentials.deploymentUrl}\n`;
  content += `CONVEX_DEPLOY_KEY=${credentials.deployKey}\n`;

  fs.writeFileSync(fullPath, content, 'utf-8');
}
