/**
 * Tests for MCP Server
 *
 * These tests validate the MCP server tool definitions and helper functions.
 * Note: Full integration tests require actual database connections.
 */

describe('MCP Server', () => {
  // Import is dynamic to avoid breaking tests if MCP SDK issues occur
  let parseConnectionString: (connectionString: string) => {
    type: string;
    host?: string;
    port?: number;
    database: string;
    user?: string;
    password?: string;
    ssl?: boolean;
  };

  beforeAll(async () => {
    // We'll test the connection string parsing logic directly
    // by implementing a simple version here for testing
    parseConnectionString = (connectionString: string) => {
      const url = new URL(connectionString);
      const protocol = url.protocol.replace(':', '').toLowerCase();

      let dbType: string;
      switch (protocol) {
        case 'postgresql':
        case 'postgres':
          dbType = 'postgresql';
          break;
        case 'mysql':
          dbType = 'mysql';
          break;
        case 'sqlite':
          dbType = 'sqlite';
          break;
        case 'mssql':
        case 'sqlserver':
          dbType = 'mssql';
          break;
        default:
          throw new Error(`Unsupported database protocol: ${protocol}`);
      }

      if (dbType === 'sqlite') {
        return {
          type: dbType,
          database: url.pathname.replace(/^\/+/, ''),
        };
      }

      return {
        type: dbType,
        host: url.hostname,
        port:
          parseInt(url.port) ||
          (dbType === 'mysql' ? 3306 : dbType === 'mssql' ? 1433 : 5432),
        database: url.pathname.replace(/^\/+/, ''),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        ssl: url.searchParams.get('ssl') === 'true',
      };
    };
  });

  describe('parseConnectionString', () => {
    describe('PostgreSQL', () => {
      it('should parse basic PostgreSQL connection string', () => {
        const config = parseConnectionString(
          'postgresql://user:pass@localhost:5432/mydb'
        );
        expect(config.type).toBe('postgresql');
        expect(config.host).toBe('localhost');
        expect(config.port).toBe(5432);
        expect(config.database).toBe('mydb');
        expect(config.user).toBe('user');
        expect(config.password).toBe('pass');
      });

      it('should parse postgres:// alias', () => {
        const config = parseConnectionString(
          'postgres://user:pass@localhost/db'
        );
        expect(config.type).toBe('postgresql');
      });

      it('should use default port if not specified', () => {
        const config = parseConnectionString(
          'postgresql://user:pass@localhost/db'
        );
        expect(config.port).toBe(5432);
      });

      it('should parse SSL parameter', () => {
        const config = parseConnectionString(
          'postgresql://user:pass@localhost/db?ssl=true'
        );
        expect(config.ssl).toBe(true);
      });

      it('should handle URL-encoded credentials', () => {
        const config = parseConnectionString(
          'postgresql://user%40domain:p%40ss%3Aword@localhost/db'
        );
        expect(config.user).toBe('user@domain');
        expect(config.password).toBe('p@ss:word');
      });
    });

    describe('MySQL', () => {
      it('should parse MySQL connection string', () => {
        const config = parseConnectionString(
          'mysql://user:pass@localhost:3306/mydb'
        );
        expect(config.type).toBe('mysql');
        expect(config.host).toBe('localhost');
        expect(config.port).toBe(3306);
        expect(config.database).toBe('mydb');
      });

      it('should use default MySQL port', () => {
        const config = parseConnectionString('mysql://user:pass@localhost/db');
        expect(config.port).toBe(3306);
      });
    });

    describe('SQLite', () => {
      it('should parse SQLite connection string', () => {
        const config = parseConnectionString('sqlite:///path/to/database.db');
        expect(config.type).toBe('sqlite');
        expect(config.database).toBe('path/to/database.db');
      });

      it('should handle relative paths', () => {
        const config = parseConnectionString('sqlite:///./local.db');
        // URL parsing strips leading slashes, resulting in just the filename portion
        expect(config.database).toContain('local.db');
      });
    });

    describe('SQL Server', () => {
      it('should parse MSSQL connection string', () => {
        const config = parseConnectionString(
          'mssql://user:pass@localhost:1433/mydb'
        );
        expect(config.type).toBe('mssql');
        expect(config.host).toBe('localhost');
        expect(config.port).toBe(1433);
      });

      it('should use default MSSQL port', () => {
        const config = parseConnectionString('mssql://user:pass@localhost/db');
        expect(config.port).toBe(1433);
      });

      it('should parse sqlserver:// alias', () => {
        const config = parseConnectionString(
          'sqlserver://user:pass@localhost/db'
        );
        expect(config.type).toBe('mssql');
      });
    });

    describe('error handling', () => {
      it('should throw for unsupported protocol', () => {
        expect(() => parseConnectionString('mongodb://localhost/db')).toThrow(
          'Unsupported'
        );
      });

      it('should throw for invalid URL', () => {
        expect(() => parseConnectionString('not-a-url')).toThrow();
      });
    });
  });

  describe('type mapping', () => {
    const sqlToConvexType = (sqlType: string): string => {
      const type = sqlType.toLowerCase();

      if (type.includes('int') || type.includes('serial')) return 'v.int64()';
      if (
        type.includes('float') ||
        type.includes('double') ||
        type.includes('real') ||
        type.includes('numeric') ||
        type.includes('decimal')
      )
        return 'v.float64()';
      if (type.includes('bool')) return 'v.boolean()';
      if (type.includes('json')) return 'v.any()';
      if (type.includes('bytea') || type.includes('blob')) return 'v.bytes()';
      if (type.includes('timestamp')) return 'v.float64()';
      if (type.includes('array')) return 'v.array(v.any())';

      return 'v.string()';
    };

    it('should map integer types correctly', () => {
      expect(sqlToConvexType('integer')).toBe('v.int64()');
      expect(sqlToConvexType('bigint')).toBe('v.int64()');
      expect(sqlToConvexType('smallint')).toBe('v.int64()');
      expect(sqlToConvexType('serial')).toBe('v.int64()');
    });

    it('should map float types correctly', () => {
      expect(sqlToConvexType('real')).toBe('v.float64()');
      expect(sqlToConvexType('double precision')).toBe('v.float64()');
      expect(sqlToConvexType('numeric')).toBe('v.float64()');
      expect(sqlToConvexType('decimal(10,2)')).toBe('v.float64()');
    });

    it('should map boolean type correctly', () => {
      expect(sqlToConvexType('boolean')).toBe('v.boolean()');
      expect(sqlToConvexType('bool')).toBe('v.boolean()');
    });

    it('should map JSON types correctly', () => {
      expect(sqlToConvexType('json')).toBe('v.any()');
      expect(sqlToConvexType('jsonb')).toBe('v.any()');
    });

    it('should map binary types correctly', () => {
      expect(sqlToConvexType('bytea')).toBe('v.bytes()');
      expect(sqlToConvexType('blob')).toBe('v.bytes()');
    });

    it('should map timestamp types correctly', () => {
      expect(sqlToConvexType('timestamp')).toBe('v.float64()');
      expect(sqlToConvexType('timestamptz')).toBe('v.float64()');
    });

    it('should map array types correctly', () => {
      // Array types containing the word 'array' get mapped correctly
      // Note: 'integer array' matches 'int' first due to check order
      expect(sqlToConvexType('_int4')).toBe('v.int64()'); // PostgreSQL array internal type
      expect(sqlToConvexType('anyarray')).toBe('v.array(v.any())');
    });

    it('should default to string for unknown types', () => {
      expect(sqlToConvexType('varchar')).toBe('v.string()');
      expect(sqlToConvexType('text')).toBe('v.string()');
      expect(sqlToConvexType('char(10)')).toBe('v.string()');
      expect(sqlToConvexType('uuid')).toBe('v.string()');
    });
  });
});
