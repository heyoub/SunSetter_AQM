/**
 * Test Generators - Property-Based Testing Utilities
 *
 * Fast-check arbitrary generators for deterministic, comprehensive testing.
 * These generators create well-formed and malformed data to expose edge cases.
 */

import * as fc from 'fast-check';

// ============================================================================
// DATABASE CONNECTION STRING GENERATORS
// ============================================================================

/**
 * Generates valid database protocols
 */
export const dbProtocol = fc.constantFrom(
  'postgresql',
  'postgres',
  'mysql',
  'mssql',
  'sqlserver',
  'sqlite'
);

/**
 * Generates valid hostnames (including edge cases)
 */
export const hostname = fc.oneof(
  fc.constant('localhost'),
  fc.constant('127.0.0.1'),
  fc.constant('host.docker.internal'),
  // Standard hostnames
  fc.stringMatching(/^[a-z][a-z0-9-]{0,20}\.[a-z]{2,6}$/),
  // Cloud provider patterns
  fc.constant('db.example.supabase.com'),
  fc.constant('ep-cool-grass.neon.tech'),
  fc.constant('db.railway.app'),
  fc.constant('mydb.rds.amazonaws.com'),
  fc.constant('server.database.windows.net'),
  // IPv4
  fc
    .tuple(
      fc.integer({ min: 1, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 255 })
    )
    .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`)
);

/**
 * Generates valid port numbers
 */
export const validPort = fc.integer({ min: 1, max: 65535 });

/**
 * Generates invalid port numbers for negative testing
 */
export const invalidPort = fc.oneof(
  fc.integer({ min: -10000, max: 0 }),
  fc.integer({ min: 65536, max: 100000 })
);

/**
 * Generates database names (safe characters)
 */
export const databaseName = fc.stringMatching(/^[a-z][a-z0-9_]{0,30}$/);

/**
 * Generates usernames (safe characters)
 */
export const username = fc.stringMatching(/^[a-z][a-z0-9_-]{0,20}$/);

/**
 * Generates passwords with varying complexity
 */
export const simplePassword = fc.stringMatching(/^[a-zA-Z0-9]{4,20}$/);

export const complexPassword = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%^&*()_+-=[]{}|;:,.<>?'.split(
        ''
      )
    ),
    { minLength: 8, maxLength: 32 }
  )
  .map((arr) => arr.join(''));

/**
 * Generates passwords with special chars that need URL encoding
 */
export const passwordWithSpecialChars = fc
  .tuple(simplePassword, fc.constantFrom('@', ':', '/', '?', '#'))
  .map(([pwd, special]) => pwd + special + pwd);

/**
 * Generates a complete valid PostgreSQL connection string
 */
export const validPostgresConnectionString = fc
  .record({
    host: hostname,
    port: fc.option(fc.constant(5432), { nil: undefined }),
    database: databaseName,
    user: fc.option(username, { nil: undefined }),
    password: fc.option(simplePassword, { nil: undefined }),
    ssl: fc.boolean(),
  })
  .map(({ host, port, database, user, password, ssl }) => {
    let conn = 'postgresql://';
    if (user) {
      conn += encodeURIComponent(user);
      if (password) conn += ':' + encodeURIComponent(password);
      conn += '@';
    }
    conn += host;
    if (port) conn += ':' + port;
    conn += '/' + database;
    if (ssl) conn += '?sslmode=require';
    return conn;
  });

/**
 * Generates a complete valid MySQL connection string
 */
export const validMySQLConnectionString = fc
  .record({
    host: hostname,
    port: fc.option(fc.constant(3306), { nil: undefined }),
    database: databaseName,
    user: username,
    password: simplePassword,
  })
  .map(({ host, port, database, user, password }) => {
    return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}${port ? ':' + port : ''}/${database}`;
  });

/**
 * Generates SQLite connection strings
 */
export const validSQLiteConnectionString = fc.oneof(
  fc.constant('sqlite:///path/to/database.db'),
  fc.constant('sqlite://:memory:'),
  fc.stringMatching(/^[a-z_][a-z0-9_-]{0,20}\.db$/).map((f) => `sqlite:///${f}`)
);

/**
 * Generates malformed connection strings for negative testing
 */
export const malformedConnectionString = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.constant('not-a-url'),
  fc.constant('http://wrong-protocol.com'),
  fc.constant('postgresql://'),
  fc.constant('postgresql:///nohost'),
  fc.constant('mysql://user@host'), // missing database
  fc.stringMatching(/^[a-z]{5,10}$/), // random strings
  fc.constant('postgresql://user:p@ss@host/db'), // unencoded @
  fc.constant('postgresql://user:pass@:5432/db'), // missing host
  fc.constant('postgresql://user:pass@host:/db') // missing port after :
);

// ============================================================================
// TABLE INFO GENERATORS (for dependency resolver, migration)
// ============================================================================

/**
 * Generates valid SQL table names
 */
export const tableName = fc.stringMatching(/^[a-z][a-z0-9_]{0,30}$/);

/**
 * Generates SQL column types
 */
export const columnType = fc.constantFrom(
  'integer',
  'bigint',
  'smallint',
  'serial',
  'bigserial',
  'text',
  'varchar',
  'char',
  'boolean',
  'timestamp',
  'timestamptz',
  'date',
  'time',
  'uuid',
  'json',
  'jsonb',
  'bytea',
  'float4',
  'float8',
  'numeric',
  'decimal',
  'money',
  'inet',
  'cidr',
  'macaddr',
  'point',
  'line',
  'box',
  'path',
  'polygon',
  'circle',
  'interval',
  'array',
  'tsvector',
  'tsquery'
);

/**
 * Generates column info objects
 */
export const columnInfo = fc.record({
  columnName: fc.stringMatching(/^[a-z][a-z0-9_]{0,20}$/),
  dataType: columnType,
  isNullable: fc.boolean(),
  columnDefault: fc.option(
    fc.oneof(fc.constant('NULL'), fc.constant("'default'"), fc.constant('0')),
    { nil: null }
  ),
  characterMaximumLength: fc.option(fc.integer({ min: 1, max: 10000 }), {
    nil: null,
  }),
  numericPrecision: fc.option(fc.integer({ min: 1, max: 38 }), { nil: null }),
  numericScale: fc.option(fc.integer({ min: 0, max: 38 }), { nil: null }),
  ordinalPosition: fc.integer({ min: 1, max: 100 }),
  isIdentity: fc.boolean(),
  isPrimaryKey: fc.boolean(),
  isForeignKey: fc.boolean(),
  foreignKeyTable: fc.option(tableName, { nil: null }),
  foreignKeyColumn: fc.option(fc.constant('id'), { nil: null }),
  description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
});

/**
 * Generates TableInfo objects for dependency testing
 */
export const tableInfo = (availableTables: string[]) =>
  fc
    .record({
      tableName: tableName,
      schemaName: fc.constant('public'),
      tableType: fc.constantFrom('BASE TABLE', 'VIEW'),
      columns: fc.array(columnInfo, { minLength: 1, maxLength: 10 }),
      primaryKeys: fc.array(fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/), {
        minLength: 1,
        maxLength: 3,
      }),
      foreignKeys: fc.array(
        fc.record({
          constraintName: fc.stringMatching(/^fk_[a-z0-9_]{5,20}$/),
          columnName: fc.stringMatching(/^[a-z][a-z0-9_]{0,15}_id$/),
          referencedTable:
            availableTables.length > 0
              ? fc.constantFrom(...availableTables)
              : fc.constant('users'),
          referencedColumn: fc.constant('id'),
        }),
        { maxLength: 3 }
      ),
      indexes: fc.array(
        fc.record({
          indexName: fc.stringMatching(/^idx_[a-z0-9_]{5,20}$/),
          columnNames: fc.array(fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/), {
            minLength: 1,
            maxLength: 3,
          }),
          isUnique: fc.boolean(),
          isPrimary: fc.boolean(),
        }),
        { maxLength: 5 }
      ),
      description: fc.option(fc.string({ maxLength: 200 }), { nil: null }),
    })
    .map((t) => ({
      ...t,
      // Ensure columns include primary keys
      columns: [
        ...t.primaryKeys.map((pk, i) => ({
          columnName: pk,
          dataType: 'integer' as const,
          isNullable: false,
          columnDefault: null,
          characterMaximumLength: null,
          numericPrecision: 32,
          numericScale: 0,
          ordinalPosition: i + 1,
          isIdentity: true,
          isPrimaryKey: true,
          isForeignKey: false,
          foreignKeyTable: null,
          foreignKeyColumn: null,
          description: null,
        })),
        ...t.columns.filter((c) => !t.primaryKeys.includes(c.columnName)),
      ],
    }));

// ============================================================================
// ID MAPPING GENERATORS
// ============================================================================

/**
 * Generates source database IDs (numeric or UUID)
 */
export const sourceId = fc.oneof(
  fc.integer({ min: 1, max: 1000000 }),
  fc.uuid()
);

/**
 * Generates Convex-style document IDs
 */
export const convexId = fc
  .tuple(
    tableName,
    fc
      .array(fc.constantFrom(...'0123456789abcdef'.split('')), {
        minLength: 16,
        maxLength: 16,
      })
      .map((arr) => arr.join(''))
  )
  .map(([table, hex]) => `${table}:${hex}`);

/**
 * Generates ID mapping entries
 */
export const idMappingEntry = fc.record({
  tableName: tableName,
  sourceId: sourceId,
  convexId: convexId,
});

// ============================================================================
// DATA TRANSFORMATION GENERATORS
// ============================================================================

/**
 * Generates JSON-like objects for transformation testing
 */
export const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('value'), { maxLength: 5 }),
    fc.dictionary(fc.stringMatching(/^[a-z]{1,10}$/), tie('value'), {
      maxKeys: 5,
    })
  ),
})).value;

/**
 * Generates database row data
 */
export const dbRow = fc.dictionary(
  fc.stringMatching(/^[a-z][a-z0-9_]{0,20}$/),
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.constant(null),
    fc.date(),
    fc.array(fc.string(), { maxLength: 3 })
  ),
  { minKeys: 1, maxKeys: 20 }
);

// ============================================================================
// SECURITY TESTING GENERATORS
// ============================================================================

/**
 * Generates SQL injection payloads for security testing
 */
export const sqlInjectionPayload = fc.constantFrom(
  "'; DROP TABLE users; --",
  "1' OR '1'='1",
  '1; DELETE FROM users',
  "admin'--",
  "' UNION SELECT * FROM passwords --",
  "1' AND '1'='1",
  "'; TRUNCATE TABLE users; --",
  '1 OR 1=1',
  "' OR ''='",
  '\'; EXEC xp_cmdshell("cmd.exe"); --'
);

/**
 * Generates XSS payloads for security testing
 */
export const xssPayload = fc.constantFrom(
  '<script>alert("xss")</script>',
  '"><script>alert("xss")</script>',
  "javascript:alert('xss')",
  '<img src=x onerror=alert("xss")>',
  '<svg onload=alert("xss")>',
  '{{constructor.constructor("alert(1)")()}}',
  '${alert(1)}',
  '<iframe src="javascript:alert(1)">',
  '<body onload=alert("xss")>',
  '<input onfocus=alert(1) autofocus>'
);

/**
 * Generates path traversal payloads
 */
export const pathTraversalPayload = fc.constantFrom(
  '../../../etc/passwd',
  '..\\..\\..\\windows\\system32\\config\\sam',
  '/etc/passwd%00',
  '....//....//....//etc/passwd',
  '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  '..%252f..%252f..%252fetc/passwd',
  '/var/www/../../etc/passwd'
);

/**
 * Generates command injection payloads
 */
export const commandInjectionPayload = fc.constantFrom(
  '; ls -la',
  '| cat /etc/passwd',
  '`whoami`',
  '$(whoami)',
  '& dir',
  '\n/bin/cat /etc/passwd',
  '|| ls',
  '&& echo pwned'
);

// ============================================================================
// PERFORMANCE TESTING UTILITIES
// ============================================================================

/**
 * Generates large datasets for performance testing
 */
export const largeDataset = (size: number) =>
  fc.array(dbRow, { minLength: size, maxLength: size });

/**
 * Generates deep nested objects for stress testing
 */
export const deepNestedObject = (depth: number): fc.Arbitrary<unknown> => {
  if (depth <= 0) {
    return fc.oneof(fc.string(), fc.integer(), fc.boolean());
  }
  return fc.dictionary(
    fc.stringMatching(/^[a-z]{1,5}$/),
    deepNestedObject(depth - 1),
    { minKeys: 1, maxKeys: 3 }
  );
};

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Helper to assert properties hold for all generated values
 */
export function assertProperty<T>(
  name: string,
  arb: fc.Arbitrary<T>,
  predicate: (value: T) => boolean | void,
  options?: fc.Parameters<T>
): void {
  fc.assert(
    fc.property(arb, (value) => {
      const result = predicate(value);
      return result === undefined ? true : result;
    }),
    {
      ...options,
      reporter: (runDetails) => {
        if (runDetails.failed) {
          console.error(`\n❌ Property "${name}" failed!`);
          console.error(`   Seed: ${runDetails.seed}`);
          console.error(
            `   Counterexample: ${JSON.stringify(runDetails.counterexample)}`
          );
          console.error(`   Number of runs: ${runDetails.numRuns}`);
          console.error(`   Number of skips: ${runDetails.numSkips}`);
          if (runDetails.errorMessage) {
            console.error(`   Error: ${runDetails.errorMessage}`);
          }
        }
      },
    }
  );
}

/**
 * Runs property test with specific seed for determinism
 */
export function deterministicProperty<T>(
  name: string,
  arb: fc.Arbitrary<T>,
  predicate: (value: T) => boolean | void,
  seed: number = 42
): void {
  assertProperty(name, arb, predicate, {
    seed,
    numRuns: 100,
  });
}
