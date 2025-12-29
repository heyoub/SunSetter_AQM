/**
 * Data Masking
 *
 * Mask sensitive data during migration for privacy/compliance
 */

import * as crypto from 'crypto';

/**
 * Masking strategy for a field
 */
export type MaskingStrategy =
  | 'hash' // SHA-256 hash
  | 'redact' // Replace with [REDACTED]
  | 'email' // Mask email (keep domain)
  | 'phone' // Mask phone (keep last 4)
  | 'name' // Replace with fake name
  | 'number' // Replace with random number in range
  | 'date' // Randomize date within range
  | 'custom'; // Custom function

/**
 * Masking rule for a field
 */
export interface MaskingRule {
  /** Masking strategy */
  strategy: MaskingStrategy;
  /** Custom masking function (for 'custom' strategy) */
  customFn?: (value: unknown) => unknown;
  /** Options for the strategy */
  options?: {
    /** For 'number': min and max range */
    min?: number;
    max?: number;
    /** For 'date': date range */
    dateRange?: { start: Date; end: Date };
    /** For 'redact': replacement text */
    replacement?: string;
  };
}

/**
 * Table masking configuration
 */
export interface TableMaskingConfig {
  /** Table name */
  tableName: string;
  /** Field masking rules */
  fields: Record<string, MaskingRule>;
}

/**
 * Data masking configuration
 */
export interface DataMaskingConfig {
  /** Enable data masking */
  enabled: boolean;
  /** Per-table masking rules */
  tables: TableMaskingConfig[];
  /** Seed for deterministic masking (optional) */
  seed?: string;
}

/**
 * Data masking engine
 */
export class DataMasker {
  private config: DataMaskingConfig;
  private tableRules: Map<string, Record<string, MaskingRule>>;

  constructor(config: DataMaskingConfig) {
    this.config = config;
    this.tableRules = new Map();

    // Index rules by table name
    for (const tableConfig of config.tables) {
      this.tableRules.set(tableConfig.tableName, tableConfig.fields);
    }
  }

  /**
   * Mask a document
   */
  maskDocument(
    tableName: string,
    document: Record<string, unknown>
  ): Record<string, unknown> {
    if (!this.config.enabled) return document;

    const rules = this.tableRules.get(tableName);
    if (!rules) return document;

    const masked = { ...document };

    for (const [field, rule] of Object.entries(rules)) {
      if (field in masked) {
        masked[field] = this.maskValue(masked[field], rule);
      }
    }

    return masked;
  }

  /**
   * Mask multiple documents
   */
  maskDocuments(
    tableName: string,
    documents: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    if (!this.config.enabled) return documents;

    return documents.map((doc) => this.maskDocument(tableName, doc));
  }

  /**
   * Mask a single value based on strategy
   */
  private maskValue(value: unknown, rule: MaskingRule): unknown {
    if (value === null || value === undefined) return value;

    switch (rule.strategy) {
      case 'hash':
        return this.hashValue(String(value));

      case 'redact':
        return rule.options?.replacement || '[REDACTED]';

      case 'email':
        return this.maskEmail(String(value));

      case 'phone':
        return this.maskPhone(String(value));

      case 'name':
        return this.generateFakeName();

      case 'number':
        return this.randomNumber(
          rule.options?.min || 0,
          rule.options?.max || 1000000
        );

      case 'date':
        return this.randomDate(
          rule.options?.dateRange?.start || new Date(2020, 0, 1),
          rule.options?.dateRange?.end || new Date()
        );

      case 'custom':
        return rule.customFn ? rule.customFn(value) : value;

      default:
        return value;
    }
  }

  /**
   * Hash a value using SHA-256
   */
  private hashValue(value: string): string {
    const hash = crypto.createHash('sha256');
    hash.update(value);
    if (this.config.seed) {
      hash.update(this.config.seed);
    }
    return hash.digest('hex');
  }

  /**
   * Mask email address
   */
  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return email;

    const [local, domain] = parts;
    const maskedLocal =
      local.charAt(0) +
      '*'.repeat(Math.max(local.length - 2, 1)) +
      local.charAt(local.length - 1);

    return `${maskedLocal}@${domain}`;
  }

  /**
   * Mask phone number
   */
  private maskPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return phone;

    const last4 = digits.slice(-4);
    const masked = '*'.repeat(digits.length - 4) + last4;

    // Try to preserve formatting
    let result = masked;
    let digitIndex = 0;
    for (let i = 0; i < phone.length; i++) {
      if (/\d/.test(phone[i])) {
        digitIndex++;
      } else {
        result =
          result.slice(0, digitIndex) + phone[i] + result.slice(digitIndex);
      }
    }

    return result;
  }

  /**
   * Generate fake name
   */
  private generateFakeName(): string {
    const firstNames = [
      'John',
      'Jane',
      'Bob',
      'Alice',
      'Charlie',
      'Diana',
      'Eve',
      'Frank',
      'Grace',
      'Henry',
    ];
    const lastNames = [
      'Smith',
      'Johnson',
      'Williams',
      'Brown',
      'Jones',
      'Garcia',
      'Miller',
      'Davis',
      'Rodriguez',
      'Martinez',
    ];

    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];

    return `${first} ${last}`;
  }

  /**
   * Generate random number in range
   */
  private randomNumber(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Generate random date in range
   */
  private randomDate(start: Date, end: Date): Date {
    const startTime = start.getTime();
    const endTime = end.getTime();
    const randomTime = startTime + Math.random() * (endTime - startTime);
    return new Date(randomTime);
  }

  /**
   * Check if masking is enabled for a table
   */
  hasMaskingForTable(tableName: string): boolean {
    return this.tableRules.has(tableName);
  }

  /**
   * Get masking rules for a table
   */
  getMaskingRules(tableName: string): Record<string, MaskingRule> | undefined {
    return this.tableRules.get(tableName);
  }
}

/**
 * Common masking rules for GDPR/CCPA compliance
 */
export const COMMON_MASKING_RULES = {
  /**
   * Mask PII fields
   */
  pii: (): TableMaskingConfig => ({
    tableName: 'users',
    fields: {
      email: { strategy: 'email' },
      phone: { strategy: 'phone' },
      ssn: { strategy: 'hash' },
      name: { strategy: 'name' },
      address: {
        strategy: 'redact',
        options: { replacement: '[ADDRESS REDACTED]' },
      },
      credit_card: {
        strategy: 'redact',
        options: { replacement: '[CARD REDACTED]' },
      },
    },
  }),

  /**
   * Mask financial data
   */
  financial: (): TableMaskingConfig => ({
    tableName: 'transactions',
    fields: {
      amount: {
        strategy: 'number',
        options: { min: 10, max: 1000 },
      },
      account_number: { strategy: 'hash' },
      routing_number: { strategy: 'hash' },
    },
  }),

  /**
   * Mask health data
   */
  health: (): TableMaskingConfig => ({
    tableName: 'patients',
    fields: {
      ssn: { strategy: 'hash' },
      medical_record_number: { strategy: 'hash' },
      diagnosis: {
        strategy: 'redact',
        options: { replacement: '[MEDICAL INFO REDACTED]' },
      },
      medications: {
        strategy: 'redact',
        options: { replacement: '[MEDICAL INFO REDACTED]' },
      },
    },
  }),
};
