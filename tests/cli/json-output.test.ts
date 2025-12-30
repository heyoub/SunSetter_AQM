/**
 * Tests for JSON Output Handler
 */

import {
  createSuccessOutput,
  createErrorOutput,
  JsonOutput,
} from '../../src/cli/output/json-output';

describe('JSON Output Handler', () => {
  describe('createSuccessOutput', () => {
    it('should create basic success output', () => {
      const output = createSuccessOutput('test-operation', { result: 'ok' });

      expect(output.success).toBe(true);
      expect(output.operation).toBe('test-operation');
      expect(output.data).toEqual({ result: 'ok' });
      expect(output.timestamp).toBeDefined();
      expect(output.error).toBeUndefined();
    });

    it('should include duration when provided', () => {
      const output = createSuccessOutput(
        'test',
        { value: 1 },
        { durationMs: 500 }
      );

      expect(output.durationMs).toBe(500);
    });

    it('should include warnings when provided', () => {
      const output = createSuccessOutput(
        'test',
        {},
        {
          warnings: ['Warning 1', 'Warning 2'],
        }
      );

      expect(output.warnings).toEqual(['Warning 1', 'Warning 2']);
    });

    it('should include metadata when provided', () => {
      const output = createSuccessOutput(
        'test',
        {},
        {
          metadata: { key: 'value', count: 5 },
        }
      );

      expect(output.metadata).toEqual({ key: 'value', count: 5 });
    });

    it('should have valid ISO timestamp', () => {
      const output = createSuccessOutput('test', {});
      const date = new Date(output.timestamp);
      expect(date.toISOString()).toBe(output.timestamp);
    });
  });

  describe('createErrorOutput', () => {
    it('should create error output from Error object', () => {
      const error = new Error('Something went wrong');
      const output = createErrorOutput('failed-operation', error);

      expect(output.success).toBe(false);
      expect(output.operation).toBe('failed-operation');
      expect(output.error?.message).toBe('Something went wrong');
      expect(output.error?.code).toBe('ERR_UNKNOWN');
    });

    it('should create error output from error object with code', () => {
      const error = { code: 'ERR_CONNECTION', message: 'Connection refused' };
      const output = createErrorOutput('connect', error);

      expect(output.error?.code).toBe('ERR_CONNECTION');
      expect(output.error?.message).toBe('Connection refused');
    });

    it('should include error details when provided', () => {
      const error = {
        code: 'ERR_VALIDATION',
        message: 'Validation failed',
        details: { field: 'email', reason: 'invalid format' },
      };
      const output = createErrorOutput('validate', error);

      expect(output.error?.details).toEqual({
        field: 'email',
        reason: 'invalid format',
      });
    });

    it('should include duration and warnings', () => {
      const output = createErrorOutput('test', new Error('fail'), {
        durationMs: 100,
        warnings: ['Warning before failure'],
      });

      expect(output.durationMs).toBe(100);
      expect(output.warnings).toEqual(['Warning before failure']);
    });

    it('should handle Error with custom code property', () => {
      const error = new Error('Custom error') as Error & { code: string };
      error.code = 'ERR_CUSTOM';
      const output = createErrorOutput('test', error);

      expect(output.error?.code).toBe('ERR_CUSTOM');
    });
  });

  describe('output structure', () => {
    it('should be valid JSON', () => {
      const output = createSuccessOutput('test', {
        nested: { value: [1, 2, 3] },
        date: new Date().toISOString(),
      });

      const json = JSON.stringify(output);
      const parsed = JSON.parse(json) as JsonOutput;

      expect(parsed.success).toBe(true);
      expect(parsed.operation).toBe('test');
    });

    it('should handle complex data types', () => {
      const output = createSuccessOutput('migrate', {
        tables: ['users', 'orders'],
        rowCounts: { users: 1000, orders: 5000 },
        stats: {
          duration: 30000,
          bytesTransferred: 1024 * 1024,
        },
      });

      expect(output.data).toBeDefined();
      expect((output.data as Record<string, unknown>).tables).toHaveLength(2);
    });

    it('should handle null and undefined in data', () => {
      const output = createSuccessOutput('test', {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        zero: 0,
        false: false,
      });

      const json = JSON.stringify(output);
      const parsed = JSON.parse(json) as JsonOutput<Record<string, unknown>>;

      expect(parsed.data?.nullValue).toBeNull();
      expect(parsed.data?.undefinedValue).toBeUndefined();
      expect(parsed.data?.emptyString).toBe('');
      expect(parsed.data?.zero).toBe(0);
      expect(parsed.data?.false).toBe(false);
    });
  });
});
