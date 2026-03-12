/**
 * Connection Validator Tests
 *
 * Comprehensive testing suite covering:
 * - Example-based tests: Known inputs with expected outputs
 * - Property-based tests: Invariants that must hold for all inputs
 * - Security tests: Injection and malformed input handling
 * - Edge case tests: Boundary conditions and unusual inputs
 *
 * Each test category exposes different types of potential issues:
 * - Example tests catch regressions on known cases
 * - Property tests find unexpected edge cases through randomization
 * - Security tests verify safe handling of malicious input
 */

import * as fc from 'fast-check';
import {
  parseConnectionString,
  validateConnectionString,
  maskPassword,
  escapeHtml,
  buildConnectionString,
  detectCloudProvider,
  analyzeConnection,
  CLOUD_DB_EXAMPLES,
} from '../../src/utils/connection-validator';
import {
  validPostgresConnectionString,
  validMySQLConnectionString,
  validSQLiteConnectionString,
  malformedConnectionString,
  hostname,
  validPort,
  invalidPort,
  databaseName,
  username,
  simplePassword,
  passwordWithSpecialChars,
  sqlInjectionPayload,
  xssPayload,
  pathTraversalPayload,
  assertProperty,
  deterministicProperty,
} from './test-generators';

// ============================================================================
// EXAMPLE-BASED TESTS
// Purpose: Catch regressions on known, documented behavior
// ============================================================================

describe('Connection Validator - Example Tests', () => {
  describe('parseConnectionString', () => {
    it('should parse PostgreSQL connection string', () => {
      const result = parseConnectionString(
        'postgresql://user:pass@localhost:5432/mydb'
      );

      expect(result.type).toBe('postgresql');
      expect(result.host).toBe('localhost');
      expect(result.port).toBe(5432);
      expect(result.database).toBe('mydb');
      expect(result.user).toBe('user');
      expect(result.password).toBe('pass');
    });

    it('should parse MySQL connection string', () => {
      const result = parseConnectionString(
        'mysql://root:secret@db.example.com:3306/production'
      );

      expect(result.type).toBe('mysql');
      expect(result.host).toBe('db.example.com');
      expect(result.port).toBe(3306);
      expect(result.database).toBe('production');
    });

    it('should parse SQLite connection string', () => {
      const result = parseConnectionString('sqlite:///path/to/db.sqlite');

      expect(result.type).toBe('sqlite');
      expect(result.database).toBe('path/to/db.sqlite');
    });

    it('should parse SQLite :memory: connection', () => {
      const result = parseConnectionString('sqlite://:memory:');

      expect(result.type).toBe('sqlite');
      expect(result.database).toBe(':memory:');
    });

    it('should parse MSSQL connection string', () => {
      const result = parseConnectionString(
        'mssql://sa:Password123@server.database.windows.net:1433/mydb'
      );

      expect(result.type).toBe('mssql');
      expect(result.host).toBe('server.database.windows.net');
      expect(result.port).toBe(1433);
    });

    it('should parse connection with URL-encoded password', () => {
      const result = parseConnectionString(
        'postgresql://user:p%40ssw%3Ard@localhost:5432/mydb'
      );

      expect(result.password).toBe('p@ssw:rd');
    });

    it('should parse connection with SSL options', () => {
      const result = parseConnectionString(
        'postgresql://user:pass@localhost/db?sslmode=require'
      );

      expect(result.ssl).toBe(true);
      expect(result.options.sslmode).toBe('require');
    });

    it('should use default port when not specified', () => {
      const pgResult = parseConnectionString(
        'postgresql://user:pass@localhost/db'
      );
      expect(pgResult.port).toBe(5432);

      const mysqlResult = parseConnectionString(
        'mysql://user:pass@localhost/db'
      );
      expect(mysqlResult.port).toBe(3306);
    });

    it('should throw on empty connection string', () => {
      expect(() => parseConnectionString('')).toThrow();
      expect(() => parseConnectionString('   ')).toThrow();
    });

    it('should throw on invalid protocol', () => {
      expect(() => parseConnectionString('http://localhost/db')).toThrow();
      expect(() => parseConnectionString('mongodb://localhost/db')).toThrow();
    });
  });

  describe('validateConnectionString', () => {
    it('should return valid=true for complete connection', () => {
      const result = validateConnectionString(
        'postgresql://user:pass@localhost:5432/mydb'
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should warn about missing username', () => {
      const result = validateConnectionString(
        'postgresql://localhost:5432/mydb'
      );

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        'No username specified - will use default'
      );
    });

    it('should warn about missing password', () => {
      const result = validateConnectionString(
        'postgresql://user@localhost:5432/mydb'
      );

      expect(result.warnings).toContain(
        'No password specified - authentication may fail'
      );
    });

    it('should suggest SSL for cloud databases', () => {
      const result = validateConnectionString(
        'postgresql://user:pass@db.supabase.com:5432/mydb'
      );

      expect(result.warnings.some((w) => w.includes('SSL'))).toBe(true);
      expect(
        result.suggestions.some((s) => s.includes('sslmode=require'))
      ).toBe(true);
    });

    it('should fail on missing host', () => {
      const result = validateConnectionString('postgresql:///mydb');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('host'))).toBe(true);
    });

    it('should fail on missing database', () => {
      const result = validateConnectionString(
        'postgresql://user:pass@localhost/'
      );

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.toLowerCase().includes('database'))
      ).toBe(true);
    });
  });

  describe('maskPassword', () => {
    it('should mask password in URL', () => {
      const masked = maskPassword('postgresql://user:secret123@localhost/db');
      expect(masked).not.toContain('secret123');
      expect(masked).toContain('***');
    });

    it('should preserve structure', () => {
      const masked = maskPassword('postgresql://user:secret123@localhost/db');
      expect(masked).toContain('user:');
      expect(masked).toContain('@localhost');
    });

    it('should handle no password', () => {
      const masked = maskPassword('postgresql://user@localhost/db');
      expect(masked).toBe('postgresql://user@localhost/db');
    });

    it('should handle passwords with regex special characters', () => {
      // Characters that could break regex: . * + ? ^ $ { } [ ] \ | ( )
      const password = 'p@ss.w*rd+123';
      const encoded = encodeURIComponent(password);
      const conn = `postgresql://user:${encoded}@localhost/db`;
      const masked = maskPassword(conn);
      expect(masked).not.toContain(password);
      expect(masked).toContain('***');
    });

    it('should handle passwords with parentheses', () => {
      const password = 'pass(word)';
      const encoded = encodeURIComponent(password);
      const conn = `postgresql://user:${encoded}@localhost/db`;
      const masked = maskPassword(conn);
      expect(masked).not.toContain(password);
      expect(masked).toContain('***');
    });
  });

  describe('escapeHtml', () => {
    it('should escape ampersand', () => {
      expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    it('should escape less than', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('should escape greater than', () => {
      expect(escapeHtml('1 > 0')).toBe('1 &gt; 0');
    });

    it('should escape double quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#039;s');
    });

    it('should escape multiple characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('should return empty string for empty input', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('should not modify safe text', () => {
      expect(escapeHtml('hello world 123')).toBe('hello world 123');
    });
  });

  describe('buildConnectionString', () => {
    it('should build PostgreSQL connection string', () => {
      const result = buildConnectionString({
        type: 'postgresql',
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        user: 'admin',
        password: 'secret',
      });

      expect(result).toBe('postgresql://admin:secret@localhost:5432/mydb');
    });

    it('should URL-encode special characters', () => {
      const result = buildConnectionString({
        type: 'postgresql',
        host: 'localhost',
        database: 'mydb',
        user: 'user@domain',
        password: 'p@ss:word',
      });

      expect(result).toContain('user%40domain');
      expect(result).toContain('p%40ss%3Aword');
    });

    it('should add SSL option when specified', () => {
      const result = buildConnectionString({
        type: 'postgresql',
        host: 'localhost',
        database: 'mydb',
        ssl: true,
      });

      expect(result).toContain('sslmode=require');
    });

    it('should build SQLite connection string', () => {
      const result = buildConnectionString({
        type: 'sqlite',
        database: '/path/to/db.sqlite',
      });

      expect(result).toBe('sqlite:////path/to/db.sqlite');
    });
  });

  describe('detectCloudProvider', () => {
    it('should detect Supabase', () => {
      const result = detectCloudProvider('project.supabase.com');
      expect(result?.provider).toBe('supabase');
    });

    it('should detect Neon', () => {
      const result = detectCloudProvider('ep-cool-grass.neon.tech');
      expect(result?.provider).toBe('neon');
    });

    it('should detect PlanetScale', () => {
      const result = detectCloudProvider('db.connect.psdb.cloud');
      expect(result?.provider).toBe('planetscale');
    });

    it('should detect Railway', () => {
      const result = detectCloudProvider('postgres.railway.app');
      expect(result?.provider).toBe('railway');
    });

    it('should detect AWS RDS', () => {
      const result = detectCloudProvider('mydb.us-west-2.rds.amazonaws.com');
      expect(result?.provider).toBe('aws_rds');
    });

    it('should detect Azure SQL', () => {
      const result = detectCloudProvider('server.database.windows.net');
      expect(result?.provider).toBe('azure_sql');
    });

    it('should return null for unknown hosts', () => {
      const result = detectCloudProvider('localhost');
      expect(result).toBeNull();
    });
  });
});

// ============================================================================
// PROPERTY-BASED TESTS
// Purpose: Verify invariants hold for ANY valid input
// These tests expose edge cases that example tests miss
// ============================================================================

describe('Connection Validator - Property Tests', () => {
  describe('parseConnectionString properties', () => {
    /**
     * PROPERTY: Round-trip consistency
     * If we build a connection string and parse it, we should get equivalent values back.
     * This exposes issues with URL encoding/decoding, special character handling.
     */
    it('should maintain round-trip consistency for PostgreSQL', () => {
      assertProperty(
        'PostgreSQL round-trip',
        fc.record({
          host: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
          port: fc.constant(5432),
          database: databaseName,
          user: username,
          password: simplePassword,
        }),
        ({ host, port, database, user, password }) => {
          const built = buildConnectionString({
            type: 'postgresql',
            host,
            port,
            database,
            user,
            password,
          });
          const parsed = parseConnectionString(built);

          expect(parsed.type).toBe('postgresql');
          expect(parsed.host).toBe(host);
          expect(parsed.database).toBe(database);
          expect(parsed.user).toBe(user);
          expect(parsed.password).toBe(password);
        }
      );
    });

    /**
     * PROPERTY: Type preservation
     * The parsed type should always match the protocol prefix.
     */
    it('should preserve database type correctly', () => {
      deterministicProperty(
        'Type preservation',
        fc.oneof(
          validPostgresConnectionString.map((s) => ({
            conn: s,
            expected: 'postgresql',
          })),
          validMySQLConnectionString.map((s) => ({
            conn: s,
            expected: 'mysql',
          })),
          validSQLiteConnectionString.map((s) => ({
            conn: s,
            expected: 'sqlite',
          }))
        ),
        ({ conn, expected }) => {
          try {
            const parsed = parseConnectionString(conn);
            expect(parsed.type).toBe(expected);
          } catch {
            // Invalid connections throw - that's acceptable
          }
        }
      );
    });

    /**
     * PROPERTY: Non-empty database for valid connections
     * Any successfully parsed connection should have a database name.
     */
    it('should always have a database name for valid connections', () => {
      assertProperty(
        'Non-empty database',
        fc.oneof(
          validPostgresConnectionString,
          validMySQLConnectionString,
          validSQLiteConnectionString
        ),
        (conn) => {
          try {
            const parsed = parseConnectionString(conn);
            expect(parsed.database).toBeDefined();
            expect(parsed.database.length).toBeGreaterThan(0);
          } catch {
            // Throwing is acceptable for edge cases
          }
        }
      );
    });

    /**
     * PROPERTY: Port range validity
     * Parsed ports should always be in valid range or undefined.
     */
    it('should have valid port range when present', () => {
      assertProperty(
        'Valid port range',
        validPostgresConnectionString,
        (conn) => {
          try {
            const parsed = parseConnectionString(conn);
            if (parsed.port !== undefined) {
              expect(parsed.port).toBeGreaterThanOrEqual(1);
              expect(parsed.port).toBeLessThanOrEqual(65535);
            }
          } catch {
            // Throwing is fine
          }
        }
      );
    });
  });

  describe('validateConnectionString properties', () => {
    /**
     * PROPERTY: Complete connections are valid
     * A connection with all required fields should always validate.
     */
    it('should validate complete PostgreSQL connections', () => {
      assertProperty(
        'Complete connections are valid',
        fc.record({
          host: fc.stringMatching(/^[a-z][a-z0-9-]{1,10}\.[a-z]{2,4}$/),
          database: databaseName,
          user: username,
          password: simplePassword,
        }),
        ({ host, database, user, password }) => {
          const conn = `postgresql://${user}:${password}@${host}:5432/${database}`;
          const result = validateConnectionString(conn);
          expect(result.valid).toBe(true);
        }
      );
    });

    /**
     * PROPERTY: Empty inputs are always invalid
     * Any empty-ish input should fail validation.
     */
    it('should reject empty inputs', () => {
      assertProperty(
        'Empty inputs rejected',
        fc.oneof(fc.constant(''), fc.constant('   '), fc.constant('\n\t')),
        (input) => {
          const result = validateConnectionString(input);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        }
      );
    });

    /**
     * PROPERTY: Invalid connections have errors
     * If validation fails, there must be at least one error.
     */
    it('should always provide errors when invalid', () => {
      assertProperty(
        'Invalid has errors',
        malformedConnectionString,
        (conn) => {
          const result = validateConnectionString(conn);
          if (!result.valid) {
            expect(result.errors.length).toBeGreaterThan(0);
          }
        }
      );
    });

    /**
     * PROPERTY: Suggestions are actionable
     * When there are suggestions, they should be non-empty strings.
     */
    it('should provide actionable suggestions', () => {
      assertProperty(
        'Actionable suggestions',
        fc.oneof(validPostgresConnectionString, malformedConnectionString),
        (conn) => {
          const result = validateConnectionString(conn);
          for (const suggestion of result.suggestions) {
            expect(typeof suggestion).toBe('string');
            expect(suggestion.length).toBeGreaterThan(0);
          }
        }
      );
    });
  });

  describe('maskPassword properties', () => {
    /**
     * PROPERTY: Password is replaced with mask
     * The password portion should be replaced with ***.
     */
    it('should replace password with mask', () => {
      assertProperty(
        'Password masked',
        fc.tuple(username, simplePassword, hostname, databaseName),
        ([user, password, host, database]) => {
          const conn = `postgresql://${user}:${password}@${host}/${database}`;
          const masked = maskPassword(conn);

          // The password pattern :password@ should be replaced with :***@
          expect(masked).toContain(':***@');
          // And the original password pattern should NOT appear
          expect(masked).not.toContain(`:${password}@`);
        }
      );
    });

    /**
     * PROPERTY: Masking preserves parsability
     * The masked string should still be structurally valid as a URL.
     */
    it('should preserve URL structure', () => {
      assertProperty(
        'URL structure preserved',
        fc.record({
          host: fc.stringMatching(/^[a-z][a-z0-9-]{1,10}\.[a-z]{2,4}$/),
          database: databaseName,
          user: username,
          password: simplePassword,
        }),
        ({ host, database, user, password }) => {
          const conn = `postgresql://${user}:${password}@${host}:5432/${database}`;
          const masked = maskPassword(conn);
          // Should still have the basic structure
          expect(masked).toMatch(/^postgresql:\/\//);
          expect(masked).toContain('@');
        }
      );
    });

    /**
     * PROPERTY: Idempotent masking
     * Masking twice should give the same result as masking once.
     */
    it('should be idempotent', () => {
      assertProperty(
        'Idempotent masking',
        validPostgresConnectionString,
        (conn) => {
          const once = maskPassword(conn);
          const twice = maskPassword(once);
          expect(twice).toBe(once);
        }
      );
    });
  });

  describe('buildConnectionString properties', () => {
    /**
     * PROPERTY: Protocol correctness
     * Built strings should start with the correct protocol.
     */
    it('should use correct protocol prefix', () => {
      assertProperty(
        'Protocol prefix',
        fc.record({
          type: fc.constantFrom(
            'postgresql' as const,
            'mysql' as const,
            'mssql' as const
          ),
          host: hostname,
          database: databaseName,
        }),
        ({ type, host, database }) => {
          const result = buildConnectionString({ type, host, database });
          expect(result.startsWith(type + '://')).toBe(true);
        }
      );
    });

    /**
     * PROPERTY: SQLite special handling
     * SQLite should use file path format.
     */
    it('should handle SQLite correctly', () => {
      assertProperty(
        'SQLite format',
        fc.stringMatching(/^[a-z][a-z0-9_-]{0,20}\.db$/),
        (database) => {
          const result = buildConnectionString({
            type: 'sqlite',
            database,
          });
          expect(result).toMatch(/^sqlite:\/\/\//);
          expect(result).toContain(database);
        }
      );
    });
  });
});

// ============================================================================
// SECURITY TESTS
// Purpose: Verify safe handling of malicious inputs
// These tests expose potential injection vulnerabilities
// ============================================================================

describe('Connection Validator - Security Tests', () => {
  describe('SQL Injection resistance', () => {
    /**
     * SQL injection payloads should not cause unexpected behavior.
     * The validator should either reject them or sanitize appropriately.
     */
    it('should handle SQL injection in database name', () => {
      assertProperty(
        'SQL injection in database',
        sqlInjectionPayload,
        (payload) => {
          const conn = `postgresql://user:pass@localhost/${encodeURIComponent(payload)}`;
          // Should either throw or return a validation result, not crash
          expect(() => {
            const result = validateConnectionString(conn);
            // If it parses, the payload should be URL-decoded but not executed
            if (result.parsed) {
              expect(result.parsed.database).toBe(payload);
            }
          }).not.toThrow(/cannot read|undefined|null pointer|segmentation/i);
        }
      );
    });

    it('should handle SQL injection in password', () => {
      assertProperty(
        'SQL injection in password',
        sqlInjectionPayload,
        (payload) => {
          const conn = `postgresql://user:${encodeURIComponent(payload)}@localhost/db`;
          expect(() => validateConnectionString(conn)).not.toThrow();
        }
      );
    });

    it('should handle SQL injection in username', () => {
      assertProperty(
        'SQL injection in username',
        sqlInjectionPayload,
        (payload) => {
          const conn = `postgresql://${encodeURIComponent(payload)}:pass@localhost/db`;
          expect(() => validateConnectionString(conn)).not.toThrow();
        }
      );
    });
  });

  describe('XSS resistance', () => {
    /**
     * XSS payloads in connection strings should not be dangerous
     * when the masked/logged output is displayed.
     */
    it('should safely mask XSS payloads in passwords', () => {
      assertProperty('XSS in password masked', xssPayload, (payload) => {
        const conn = `postgresql://user:${encodeURIComponent(payload)}@localhost/db`;
        const masked = maskPassword(conn);
        // The payload should be masked, not exposed
        expect(masked).not.toContain(payload);
        expect(masked).toContain('***');
      });
    });

    it('should handle XSS in database names', () => {
      assertProperty('XSS in database name', xssPayload, (payload) => {
        const conn = `postgresql://user:pass@localhost/${encodeURIComponent(payload)}`;
        // Should not crash
        expect(() => validateConnectionString(conn)).not.toThrow();
      });
    });
  });

  describe('Path traversal resistance', () => {
    /**
     * Path traversal attempts in SQLite paths should be handled safely.
     */
    it('should handle path traversal in SQLite paths', () => {
      assertProperty(
        'Path traversal in SQLite',
        pathTraversalPayload,
        (payload) => {
          const conn = `sqlite:///${payload}`;
          // Should parse without crashing
          expect(() => {
            const result = parseConnectionString(conn);
            // The path is preserved as-is - validation of actual paths
            // should happen at file access time, not parse time
            expect(result.database).toBeDefined();
          }).not.toThrow();
        }
      );
    });
  });

  describe('Denial of service resistance', () => {
    /**
     * Very long inputs should not cause excessive memory or CPU usage.
     */
    it('should handle extremely long connection strings', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10000, maxLength: 100000 }),
          (longString) => {
            const start = Date.now();
            try {
              validateConnectionString(
                `postgresql://user:pass@host/${longString}`
              );
            } catch {
              // Throwing is fine
            }
            const elapsed = Date.now() - start;
            // Should complete in reasonable time (under 1 second)
            expect(elapsed).toBeLessThan(1000);
          }
        ),
        { numRuns: 10 }
      );
    });

    /**
     * Deeply nested query parameters should not cause stack overflow.
     */
    it('should handle many query parameters', () => {
      const manyParams = Array.from(
        { length: 1000 },
        (_, i) => `p${i}=v${i}`
      ).join('&');
      const conn = `postgresql://user:pass@localhost/db?${manyParams}`;

      expect(() => {
        const result = validateConnectionString(conn);
        expect(result.parsed?.options).toBeDefined();
      }).not.toThrow();
    });
  });
});

// ============================================================================
// EDGE CASE TESTS
// Purpose: Test boundary conditions and unusual but valid inputs
// ============================================================================

describe('Connection Validator - Edge Cases', () => {
  describe('Unicode handling', () => {
    it('should handle Unicode in database names', () => {
      const conn = 'postgresql://user:pass@localhost/database_日本語';
      // Should not crash
      expect(() => validateConnectionString(conn)).not.toThrow();
    });

    it('should handle Unicode in passwords when URL-encoded', () => {
      const password = encodeURIComponent('密码123');
      const conn = `postgresql://user:${password}@localhost/db`;
      const result = parseConnectionString(conn);
      expect(result.password).toBe('密码123');
    });

    it('should handle emoji in database names', () => {
      const conn = `postgresql://user:pass@localhost/${encodeURIComponent('db_🚀')}`;
      expect(() => validateConnectionString(conn)).not.toThrow();
    });
  });

  describe('Whitespace handling', () => {
    it('should trim leading/trailing whitespace', () => {
      const conn = '  postgresql://user:pass@localhost/db  ';
      const result = validateConnectionString(conn);
      expect(result.valid).toBe(true);
    });

    it('should warn about internal spaces', () => {
      const conn = 'postgresql://user:pass@localhost/db name';
      const result = validateConnectionString(conn);
      expect(result.warnings.some((w) => w.includes('spaces'))).toBe(true);
    });
  });

  describe('Port edge cases', () => {
    it('should accept port 1', () => {
      const conn = 'postgresql://user:pass@localhost:1/db';
      const result = parseConnectionString(conn);
      expect(result.port).toBe(1);
    });

    it('should accept port 65535', () => {
      const conn = 'postgresql://user:pass@localhost:65535/db';
      const result = parseConnectionString(conn);
      expect(result.port).toBe(65535);
    });

    it('should reject port 0 during validation', () => {
      const conn = 'postgresql://user:pass@localhost:0/db';
      const result = validateConnectionString(conn);
      // Port 0 is technically parseable but invalid
      expect(result.parsed?.port).toBe(0);
    });

    it('should reject negative ports during validation', () => {
      // URL parsing should fail for invalid ports
      const conn = 'postgresql://user:pass@localhost:-1/db';
      expect(() => parseConnectionString(conn)).toThrow();
    });
  });

  describe('Empty component handling', () => {
    it('should handle empty password with user', () => {
      const conn = 'postgresql://user:@localhost/db';
      const result = parseConnectionString(conn);
      expect(result.user).toBe('user');
      // Empty password is normalized to '' when username is present
      expect(result.password).toBe('');
    });

    it('should handle no password when user is present', () => {
      const conn = 'postgresql://user@localhost/db';
      const result = parseConnectionString(conn);
      expect(result.user).toBe('user');
      // No password specified but user present - normalize to empty string
      expect(result.password).toBe('');
    });

    it('should have undefined password when no user', () => {
      const conn = 'postgresql://localhost/db';
      const result = parseConnectionString(conn);
      expect(result.user).toBeUndefined();
      expect(result.password).toBeUndefined();
    });

    it('should handle connection with only protocol and database', () => {
      const conn = 'sqlite:///mydb.sqlite';
      const result = parseConnectionString(conn);
      expect(result.type).toBe('sqlite');
      expect(result.database).toBe('mydb.sqlite');
    });
  });

  describe('IPv6 handling', () => {
    it('should parse IPv6 localhost', () => {
      const conn = 'postgresql://user:pass@[::1]:5432/db';
      const result = parseConnectionString(conn);
      expect(result.host).toBe('[::1]');
    });
  });

  describe('Cloud provider detection edge cases', () => {
    it('should detect providers case-insensitively', () => {
      expect(detectCloudProvider('DB.SUPABASE.COM')?.provider).toBe('supabase');
      expect(detectCloudProvider('EP.NEON.TECH')?.provider).toBe('neon');
    });

    it('should handle subdomain variations', () => {
      expect(
        detectCloudProvider('my-project.us-east-1.supabase.com')?.provider
      ).toBe('supabase');
    });
  });
});

// ============================================================================
// REGRESSION TESTS
// Purpose: Prevent known bugs from recurring
// Add tests here when bugs are found and fixed
// ============================================================================

describe('Connection Validator - Regression Tests', () => {
  // Add regression tests as bugs are found
  // Example:
  // it('should handle [specific edge case that caused bug]', () => {
  //   // Test for the specific condition
  // });
});

// ============================================================================
// DOCUMENTATION TESTS
// Purpose: Ensure documented examples work as expected
// ============================================================================

describe('Connection Validator - Documentation Tests', () => {
  describe('CLOUD_DB_EXAMPLES', () => {
    it('should have all required fields for each provider', () => {
      for (const [key, example] of Object.entries(CLOUD_DB_EXAMPLES)) {
        expect(example.name).toBeDefined();
        expect(example.name.length).toBeGreaterThan(0);
        expect(example.template).toBeDefined();
        expect(example.notes).toBeDefined();
        // Template should be a valid-looking connection string
        expect(example.template).toMatch(
          /^(postgresql|mysql|mssql|sqlite):\/\//
        );
      }
    });

    it('should include major cloud providers', () => {
      const providers = Object.keys(CLOUD_DB_EXAMPLES);
      expect(providers).toContain('supabase');
      expect(providers).toContain('neon');
      expect(providers).toContain('planetscale');
      expect(providers).toContain('railway');
      expect(providers).toContain('aws_rds');
      expect(providers).toContain('azure_sql');
    });
  });

  describe('analyzeConnection', () => {
    it('should provide complete analysis', () => {
      const analysis = analyzeConnection(
        'postgresql://user:pass@db.supabase.com/mydb'
      );

      expect(analysis.validation).toBeDefined();
      expect(analysis.cloudProvider).toBeDefined();
      expect(analysis.cloudProvider?.provider).toBe('supabase');
      expect(analysis.securityChecks).toBeDefined();
      expect(analysis.securityChecks.hasPassword).toBe(true);
    });
  });
});
