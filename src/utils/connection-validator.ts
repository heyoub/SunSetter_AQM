/**
 * Connection String Validator
 *
 * Validates and parses database connection strings with helpful error messages.
 * Supports PostgreSQL, MySQL, SQLite, and SQL Server.
 */

import {
  ConnectionError,
  ConfigurationError,
  ERROR_CODES,
} from '../cli/errors/index.js';

/**
 * Parsed connection string components
 */
export interface ParsedConnection {
  type: 'postgresql' | 'mysql' | 'sqlite' | 'mssql';
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  options: Record<string, string>;
  raw: string;
}

/**
 * Validation result
 */
export interface ConnectionValidationResult {
  valid: boolean;
  parsed?: ParsedConnection;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Common cloud database patterns with connection string templates
 */
export const CLOUD_DB_EXAMPLES: Record<
  string,
  { name: string; template: string; notes: string }
> = {
  supabase: {
    name: 'Supabase',
    template:
      'postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres',
    notes:
      'Find your connection string in Supabase Dashboard > Settings > Database',
  },
  neon: {
    name: 'Neon',
    template:
      'postgresql://[user]:[password]@[endpoint].neon.tech/[database]?sslmode=require',
    notes:
      'Find your connection string in the Neon Console > Connection Details',
  },
  planetscale: {
    name: 'PlanetScale',
    template:
      'mysql://[user]:[password]@[host].connect.psdb.cloud/[database]?ssl={"rejectUnauthorized":true}',
    notes:
      'Create a password in PlanetScale Console > Branches > Connect > Create password',
  },
  railway: {
    name: 'Railway',
    template:
      'postgresql://postgres:[password]@[host].railway.app:5432/railway',
    notes: 'Find DATABASE_URL in Railway Dashboard > Variables',
  },
  render: {
    name: 'Render',
    template:
      'postgresql://[user]:[password]@[host].oregon-postgres.render.com/[database]',
    notes: 'Copy the External Database URL from Render Dashboard',
  },
  heroku: {
    name: 'Heroku',
    template:
      'postgresql://[user]:[password]@[host].compute-1.amazonaws.com:5432/[database]',
    notes: 'Run `heroku config:get DATABASE_URL` or check Heroku Data settings',
  },
  aws_rds: {
    name: 'AWS RDS',
    template:
      'postgresql://[user]:[password]@[instance].[region].rds.amazonaws.com:5432/[database]',
    notes: 'Find endpoint in RDS Console > Databases > Connectivity & security',
  },
  azure_sql: {
    name: 'Azure SQL',
    template:
      'mssql://[user]:[password]@[server].database.windows.net:1433/[database]',
    notes:
      'Find connection string in Azure Portal > SQL databases > Connection strings',
  },
  gcp_cloudsql: {
    name: 'Google Cloud SQL',
    template: 'postgresql://[user]:[password]@[instance-ip]:5432/[database]',
    notes:
      'Enable public IP or use Cloud SQL Proxy. Find IP in Cloud Console > SQL > Connections',
  },
  local_postgres: {
    name: 'Local PostgreSQL',
    template: 'postgresql://postgres:password@localhost:5432/mydb',
    notes:
      'Default PostgreSQL installation. Adjust port if using non-standard.',
  },
  local_mysql: {
    name: 'Local MySQL',
    template: 'mysql://root:password@localhost:3306/mydb',
    notes:
      'Default MySQL installation. Root password may be empty on fresh install.',
  },
  sqlite: {
    name: 'SQLite',
    template: 'sqlite:///path/to/database.db',
    notes:
      'Use absolute path for reliability. Relative paths are from working directory.',
  },
};

/**
 * Default ports for database types
 */
const DEFAULT_PORTS: Record<string, number> = {
  postgresql: 5432,
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
  sqlserver: 1433,
};

/**
 * Parse a connection string into components
 */
export function parseConnectionString(
  connectionString: string
): ParsedConnection {
  const trimmed = connectionString.trim();

  if (!trimmed) {
    throw new ConfigurationError(
      'Connection string is empty',
      ERROR_CODES.CONFIG_MISSING_REQUIRED,
      { details: { field: 'connectionString' } }
    );
  }

  // SQLite special handling (doesn't use URL format the same way)
  if (trimmed.startsWith('sqlite:')) {
    const dbPath = trimmed
      .replace(/^sqlite:\/\/\/?/, '')
      .replace(/^sqlite:/, '');
    return {
      type: 'sqlite',
      database: dbPath || ':memory:',
      options: {},
      raw: trimmed,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConfigurationError(
      'Invalid connection string format. Expected URL format like postgresql://user:pass@host:port/database',
      ERROR_CODES.CONFIG_PARSE_ERROR,
      {
        details: {
          connectionString: maskPassword(trimmed),
          hint: 'Check for special characters in password (use URL encoding)',
        },
      }
    );
  }

  const protocol = url.protocol.replace(':', '').toLowerCase();

  // Determine database type
  let dbType: 'postgresql' | 'mysql' | 'sqlite' | 'mssql';
  switch (protocol) {
    case 'postgresql':
    case 'postgres':
      dbType = 'postgresql';
      break;
    case 'mysql':
      dbType = 'mysql';
      break;
    case 'mssql':
    case 'sqlserver':
      dbType = 'mssql';
      break;
    default:
      throw new ConfigurationError(
        `Unsupported database protocol: ${protocol}`,
        ERROR_CODES.CONFIG_INVALID,
        {
          details: {
            protocol,
            supportedProtocols: [
              'postgresql',
              'postgres',
              'mysql',
              'mssql',
              'sqlserver',
              'sqlite',
            ],
          },
        }
      );
  }

  // Parse query parameters
  const options: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    options[key] = value;
  });

  // Extract database name from path
  const database = url.pathname.replace(/^\/+/, '');

  return {
    type: dbType,
    host: url.hostname || undefined,
    port: url.port ? parseInt(url.port, 10) : DEFAULT_PORTS[protocol],
    database,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: options.ssl === 'true' || options.sslmode === 'require',
    options,
    raw: trimmed,
  };
}

/**
 * Validate a connection string with detailed feedback
 */
export function validateConnectionString(
  connectionString: string
): ConnectionValidationResult {
  const result: ConnectionValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    suggestions: [],
  };

  // Empty check
  if (!connectionString || !connectionString.trim()) {
    result.valid = false;
    result.errors.push('Connection string is required');
    result.suggestions.push(
      'Provide a connection string with -c or --connection flag'
    );
    result.suggestions.push('Or set DATABASE_URL environment variable');
    return result;
  }

  const trimmed = connectionString.trim();

  // Try to parse
  try {
    result.parsed = parseConnectionString(trimmed);
  } catch (error) {
    result.valid = false;
    if (error instanceof ConfigurationError) {
      result.errors.push(error.message);
    } else {
      result.errors.push(
        `Failed to parse connection string: ${(error as Error).message}`
      );
    }
    return result;
  }

  const parsed = result.parsed;

  // Validate based on database type
  if (parsed.type === 'sqlite') {
    // SQLite validation
    if (!parsed.database) {
      result.valid = false;
      result.errors.push('SQLite database path is required');
      result.suggestions.push('Use format: sqlite:///path/to/database.db');
    }
  } else {
    // Network database validation
    if (!parsed.host) {
      result.valid = false;
      result.errors.push('Database host is required');
      result.suggestions.push('Add hostname to connection string');
    }

    if (!parsed.database) {
      result.valid = false;
      result.errors.push('Database name is required');
      result.suggestions.push('Add database name after the host/port');
    }

    if (!parsed.user) {
      result.warnings.push('No username specified - will use default');
    }

    if (!parsed.password) {
      result.warnings.push('No password specified - authentication may fail');
    }

    // SSL warnings for cloud databases
    if (!parsed.ssl && parsed.host) {
      const hostLower = parsed.host.toLowerCase();
      const cloudHosts = [
        'supabase.com',
        'neon.tech',
        'psdb.cloud',
        'railway.app',
        'render.com',
        'rds.amazonaws.com',
        'database.windows.net',
      ];

      if (cloudHosts.some((h) => hostLower.includes(h))) {
        result.warnings.push('Cloud database detected - SSL is recommended');
        result.suggestions.push(
          'Add ?sslmode=require to your connection string'
        );
      }
    }

    // Port warnings
    if (
      (parsed.port && parsed.port < 1) ||
      (parsed.port && parsed.port > 65535)
    ) {
      result.valid = false;
      result.errors.push(`Invalid port number: ${parsed.port}`);
    }

    // Special character warnings
    if (parsed.password) {
      const specialChars = ['@', ':', '/', '?', '#', '[', ']'];
      const hasUnencoded = specialChars.some(
        (c) =>
          parsed.password!.includes(c) &&
          !connectionString.includes(encodeURIComponent(c))
      );
      if (hasUnencoded) {
        result.warnings.push(
          'Password may contain special characters that need URL encoding'
        );
        result.suggestions.push(
          'URL-encode special characters: @ -> %40, : -> %3A, / -> %2F'
        );
      }
    }
  }

  // Detect common mistakes
  if (trimmed.includes(' ')) {
    result.warnings.push(
      'Connection string contains spaces - this may cause issues'
    );
  }

  if (trimmed.includes('localhost') && parsed.port === 5432) {
    result.suggestions.push(
      'Tip: For Docker, use host.docker.internal instead of localhost'
    );
  }

  return result;
}

/**
 * Mask password in connection string for logging
 */
export function maskPassword(connectionString: string): string {
  // Match password in URL format
  return connectionString.replace(/(:\/\/[^:]+:)([^@]+)(@)/, '$1***$3');
}

/**
 * Generate connection string examples for help output
 */
export function getConnectionStringExamples(): string {
  const lines: string[] = ['', 'Connection String Examples:', ''];

  for (const [key, info] of Object.entries(CLOUD_DB_EXAMPLES)) {
    if (key.startsWith('local_') || key === 'sqlite') {
      continue; // Skip local examples in cloud section
    }
    lines.push(`  ${info.name}:`);
    lines.push(`    ${info.template}`);
    lines.push(`    Note: ${info.notes}`);
    lines.push('');
  }

  lines.push('Local Databases:');
  lines.push('');
  lines.push(`  PostgreSQL: ${CLOUD_DB_EXAMPLES.local_postgres.template}`);
  lines.push(`  MySQL:      ${CLOUD_DB_EXAMPLES.local_mysql.template}`);
  lines.push(`  SQLite:     ${CLOUD_DB_EXAMPLES.sqlite.template}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Suggest the most likely cloud provider based on hostname
 */
export function detectCloudProvider(
  host: string
): { provider: string; info: (typeof CLOUD_DB_EXAMPLES)[string] } | null {
  const hostLower = host.toLowerCase();

  if (hostLower.includes('supabase.com'))
    return { provider: 'supabase', info: CLOUD_DB_EXAMPLES.supabase };
  if (hostLower.includes('neon.tech'))
    return { provider: 'neon', info: CLOUD_DB_EXAMPLES.neon };
  if (hostLower.includes('psdb.cloud'))
    return { provider: 'planetscale', info: CLOUD_DB_EXAMPLES.planetscale };
  if (hostLower.includes('railway.app'))
    return { provider: 'railway', info: CLOUD_DB_EXAMPLES.railway };
  if (hostLower.includes('render.com'))
    return { provider: 'render', info: CLOUD_DB_EXAMPLES.render };
  if (hostLower.includes('amazonaws.com'))
    return { provider: 'aws_rds', info: CLOUD_DB_EXAMPLES.aws_rds };
  if (hostLower.includes('database.windows.net'))
    return { provider: 'azure_sql', info: CLOUD_DB_EXAMPLES.azure_sql };

  return null;
}

/**
 * Test connection to database (without actually connecting)
 * Returns potential issues based on the connection string
 */
export function analyzeConnection(connectionString: string): {
  validation: ConnectionValidationResult;
  cloudProvider: {
    provider: string;
    info: (typeof CLOUD_DB_EXAMPLES)[string];
  } | null;
  securityChecks: {
    hasSSL: boolean;
    hasPassword: boolean;
    isLocalhost: boolean;
    usesDefaultPort: boolean;
  };
} {
  const validation = validateConnectionString(connectionString);

  let cloudProvider: {
    provider: string;
    info: (typeof CLOUD_DB_EXAMPLES)[string];
  } | null = null;
  const securityChecks = {
    hasSSL: false,
    hasPassword: false,
    isLocalhost: false,
    usesDefaultPort: false,
  };

  if (validation.parsed) {
    const parsed = validation.parsed;

    // Detect cloud provider
    if (parsed.host) {
      cloudProvider = detectCloudProvider(parsed.host);
    }

    // Security checks
    securityChecks.hasSSL = parsed.ssl || false;
    securityChecks.hasPassword = !!parsed.password;
    securityChecks.isLocalhost =
      parsed.host === 'localhost' || parsed.host === '127.0.0.1';
    securityChecks.usesDefaultPort =
      parsed.port === DEFAULT_PORTS[parsed.type] || !parsed.port;
  }

  return {
    validation,
    cloudProvider,
    securityChecks,
  };
}

/**
 * Test if a database connection can be established
 * Returns detailed error info using ConnectionError for actual failures
 */
export async function testConnection(connectionString: string): Promise<{
  success: boolean;
  latencyMs?: number;
  error?: Error;
  suggestion?: string;
}> {
  const validation = validateConnectionString(connectionString);

  if (!validation.valid || !validation.parsed) {
    return {
      success: false,
      error: new ConfigurationError(
        validation.errors.join('; '),
        ERROR_CODES.CONFIG_INVALID
      ),
      suggestion: validation.suggestions[0],
    };
  }

  const parsed = validation.parsed;
  const startTime = Date.now();

  try {
    // For SQLite, just check if the file exists (or is :memory:)
    if (parsed.type === 'sqlite') {
      if (parsed.database === ':memory:') {
        return { success: true, latencyMs: Date.now() - startTime };
      }
      const fs = await import('fs/promises');
      try {
        await fs.access(parsed.database);
        return { success: true, latencyMs: Date.now() - startTime };
      } catch {
        throw new ConnectionError(
          `SQLite database file not found: ${parsed.database}`,
          ERROR_CODES.CONNECTION_FAILED,
          { details: { path: parsed.database } }
        );
      }
    }

    // For network databases, try a TCP connection to the host:port
    const net = await import('net');
    const socket = new net.Socket();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve({
          success: false,
          latencyMs: Date.now() - startTime,
          error: new ConnectionError(
            `Connection timeout to ${parsed.host}:${parsed.port}`,
            ERROR_CODES.CONNECTION_TIMEOUT,
            { details: { host: parsed.host, port: parsed.port } }
          ),
          suggestion: 'Check if the database server is running and accessible',
        });
      }, 5000);

      socket.connect(parsed.port || 5432, parsed.host || 'localhost', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve({ success: true, latencyMs: Date.now() - startTime });
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        socket.destroy();

        let suggestion = 'Check your connection string and network settings';
        if (err.message.includes('ECONNREFUSED')) {
          suggestion = `Database server not running on ${parsed.host}:${parsed.port}`;
        } else if (err.message.includes('ENOTFOUND')) {
          suggestion = `Host "${parsed.host}" not found - check the hostname`;
        } else if (err.message.includes('ETIMEDOUT')) {
          suggestion = 'Connection timed out - check firewall settings';
        }

        resolve({
          success: false,
          latencyMs: Date.now() - startTime,
          error: new ConnectionError(
            `Failed to connect to ${parsed.host}:${parsed.port}: ${err.message}`,
            ERROR_CODES.CONNECTION_FAILED,
            {
              details: {
                host: parsed.host,
                port: parsed.port,
                originalError: err.message,
              },
            }
          ),
          suggestion,
        });
      });
    });
  } catch (error) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error:
        error instanceof ConnectionError
          ? error
          : new ConnectionError(
              `Connection test failed: ${(error as Error).message}`,
              ERROR_CODES.CONNECTION_FAILED
            ),
    };
  }
}

/**
 * Build a connection string from components
 */
export function buildConnectionString(options: {
  type: 'postgresql' | 'mysql' | 'mssql' | 'sqlite';
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  options?: Record<string, string>;
}): string {
  if (options.type === 'sqlite') {
    return `sqlite:///${options.database}`;
  }

  const protocol = options.type === 'mssql' ? 'mssql' : options.type;
  let connectionString = `${protocol}://`;

  if (options.user) {
    connectionString += encodeURIComponent(options.user);
    if (options.password) {
      connectionString += ':' + encodeURIComponent(options.password);
    }
    connectionString += '@';
  }

  connectionString += options.host || 'localhost';

  if (options.port) {
    connectionString += ':' + options.port;
  }

  connectionString += '/' + options.database;

  // Add query parameters
  const params: string[] = [];
  if (options.ssl) {
    params.push('sslmode=require');
  }
  if (options.options) {
    for (const [key, value] of Object.entries(options.options)) {
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  if (params.length > 0) {
    connectionString += '?' + params.join('&');
  }

  return connectionString;
}
