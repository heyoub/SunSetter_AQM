/**
 * Tests for Check Constraint Converter
 */

import {
  convertCheckConstraint,
  convertColumnCheckConstraints,
  applyCheckConstraintValidators,
} from '../../src/convex/check-constraint-converter';

describe('Check Constraint Converter', () => {
  describe('convertCheckConstraint', () => {
    describe('numeric range constraints', () => {
      it('should convert >= AND <= range', () => {
        const result = convertCheckConstraint(
          'CHECK (price >= 0 AND price <= 1000)',
          'price',
          'numeric'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('.gte(0).lte(1000)');
      });

      it('should convert > AND < range', () => {
        const result = convertCheckConstraint(
          'CHECK (age > 0 AND age < 150)',
          'age',
          'integer'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('.gt(0).lt(150)');
      });

      it('should handle integer types', () => {
        const result = convertCheckConstraint(
          'CHECK (quantity >= 0 AND quantity <= 999)',
          'quantity',
          'integer'
        );
        expect(result.success).toBe(true);
        expect(result.description).toContain('integer');
      });

      it('should handle numeric types', () => {
        const result = convertCheckConstraint(
          'CHECK (amount >= 0 AND amount <= 10000)',
          'amount',
          'numeric'
        );
        expect(result.success).toBe(true);
        expect(result.description).toContain('numeric');
      });
    });

    describe('single comparison constraints', () => {
      it('should convert >= constraint', () => {
        const result = convertCheckConstraint(
          'CHECK (age >= 18)',
          'age',
          'integer'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('.gte(18)');
      });

      it('should convert > constraint', () => {
        const result = convertCheckConstraint(
          'CHECK (price > 0)',
          'price',
          'decimal'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('.gt(0)');
      });

      it('should convert <= constraint', () => {
        const result = convertCheckConstraint(
          'CHECK (rating <= 5)',
          'rating',
          'integer'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('.lte(5)');
      });

      it('should convert < constraint', () => {
        const result = convertCheckConstraint(
          'CHECK (count < 100)',
          'count',
          'integer'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('.lt(100)');
      });
    });

    describe('string length constraints', () => {
      it('should convert length() <= constraint', () => {
        const result = convertCheckConstraint(
          'CHECK (length(name) <= 255)',
          'name',
          'varchar'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('.lte(255)');
        expect(result.description).toContain('characters');
      });

      it('should convert char_length() <= constraint', () => {
        const result = convertCheckConstraint(
          'CHECK (char_length(description) <= 1000)',
          'description',
          'text'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('.lte(1000)');
      });

      it('should convert length() >= constraint', () => {
        const result = convertCheckConstraint(
          'CHECK (length(password) >= 8)',
          'password',
          'varchar'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('.gte(8)');
      });
    });

    describe('IN clause constraints', () => {
      it('should convert string IN clause', () => {
        const result = convertCheckConstraint(
          "CHECK (status IN ('pending', 'active', 'completed'))",
          'status',
          'varchar'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toContain('v.union');
        expect(result.validatorModifier).toContain('v.literal("pending")');
        expect(result.validatorModifier).toContain('v.literal("active")');
        expect(result.validatorModifier).toContain('v.literal("completed")');
      });

      it('should convert integer IN clause', () => {
        const result = convertCheckConstraint(
          'CHECK (priority IN (1, 2, 3, 4, 5))',
          'priority',
          'integer'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toContain('v.union');
        expect(result.validatorModifier).toContain('v.literal(1)');
        expect(result.validatorModifier).toContain('v.literal(5)');
        expect(result.description).toContain('integers');
      });
    });

    describe('NOT NULL constraints', () => {
      it('should handle IS NOT NULL', () => {
        const result = convertCheckConstraint(
          'CHECK (name IS NOT NULL)',
          'name',
          'varchar'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBeNull();
        expect(result.warning).toContain('redundant');
      });
    });

    describe('boolean constraints', () => {
      it('should convert = true constraint', () => {
        const result = convertCheckConstraint(
          'CHECK (is_active = true)',
          'is_active',
          'boolean'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('v.literal(true)');
      });

      it('should convert = false constraint', () => {
        const result = convertCheckConstraint(
          'CHECK (is_deleted = false)',
          'is_deleted',
          'boolean'
        );
        expect(result.success).toBe(true);
        expect(result.validatorModifier).toBe('v.literal(false)');
      });
    });

    describe('unsupported constraints', () => {
      it('should return failure for complex constraints', () => {
        const result = convertCheckConstraint(
          'CHECK (start_date < end_date)',
          'start_date',
          'timestamp'
        );
        expect(result.success).toBe(false);
        expect(result.validatorModifier).toBeNull();
        expect(result.warning).toContain('cannot be automatically converted');
      });

      it('should return failure for regex constraints', () => {
        const result = convertCheckConstraint(
          "CHECK (email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}$')",
          'email',
          'varchar'
        );
        expect(result.success).toBe(false);
      });
    });
  });

  describe('convertColumnCheckConstraints', () => {
    it('should filter and convert constraints for specific column', () => {
      const constraints = [
        { checkClause: 'CHECK (price >= 0)', constraintName: 'price_positive' },
        {
          checkClause: 'CHECK (quantity >= 0)',
          constraintName: 'qty_positive',
        },
        { checkClause: 'CHECK (price <= 10000)', constraintName: 'price_max' },
      ];

      const conversions = convertColumnCheckConstraints(
        'price',
        'numeric',
        constraints
      );
      expect(conversions).toHaveLength(2);
      expect(
        conversions.every((c) => c.originalConstraint.includes('price'))
      ).toBe(true);
    });

    it('should return empty array for no matching constraints', () => {
      const constraints = [
        {
          checkClause: 'CHECK (quantity >= 0)',
          constraintName: 'qty_positive',
        },
      ];

      const conversions = convertColumnCheckConstraints(
        'price',
        'numeric',
        constraints
      );
      expect(conversions).toHaveLength(0);
    });
  });

  describe('applyCheckConstraintValidators', () => {
    it('should append modifiers to base validator', () => {
      const conversions = [
        {
          originalConstraint: 'CHECK (age >= 0)',
          validatorModifier: '.gte(0)',
          success: true,
          description: 'Value must be >= 0',
        },
        {
          originalConstraint: 'CHECK (age <= 150)',
          validatorModifier: '.lte(150)',
          success: true,
          description: 'Value must be <= 150',
        },
      ];

      const result = applyCheckConstraintValidators('v.int64()', conversions);
      expect(result).toBe('v.int64().gte(0).lte(150)');
    });

    it('should replace validator for union types', () => {
      const conversions = [
        {
          originalConstraint: "CHECK (status IN ('a', 'b'))",
          validatorModifier: 'v.union(v.literal("a"), v.literal("b"))',
          success: true,
          description: 'Value must be one of: a, b',
        },
      ];

      const result = applyCheckConstraintValidators('v.string()', conversions);
      expect(result).toBe('v.union(v.literal("a"), v.literal("b"))');
    });

    it('should skip failed conversions', () => {
      const conversions = [
        {
          originalConstraint: 'CHECK (complex)',
          validatorModifier: null,
          success: false,
          description: 'Complex constraint',
        },
      ];

      const result = applyCheckConstraintValidators('v.string()', conversions);
      expect(result).toBe('v.string()');
    });
  });
});
