/**
 * Check Constraint to Convex Validator Converter
 *
 * Converts simple PostgreSQL check constraints to Convex validators.
 * Supports common patterns like numeric ranges, string length constraints, and value lists.
 */

export interface CheckConstraintConversion {
  /** The original CHECK clause */
  originalConstraint: string;
  /** The converted Convex validator modifier (e.g., ".gte(0).lte(100)") */
  validatorModifier: string | null;
  /** Whether the conversion was successful */
  success: boolean;
  /** Human-readable description of the constraint */
  description: string;
  /** Warning if conversion is partial or not supported */
  warning?: string;
}

/**
 * Convert a PostgreSQL check constraint to a Convex validator modifier
 */
export function convertCheckConstraint(
  checkClause: string,
  columnName: string,
  _dataType: string // Reserved for future type-specific constraint handling
): CheckConstraintConversion {
  // Remove "CHECK" wrapper if present
  let constraint = checkClause.trim();
  if (constraint.toUpperCase().startsWith('CHECK')) {
    constraint = constraint
      .replace(/^CHECK\s*\(/i, '')
      .replace(/\)$/, '')
      .trim();
  }

  // Normalize constraint - remove parentheses if wrapping entire expression
  if (constraint.startsWith('(') && constraint.endsWith(')')) {
    constraint = constraint.slice(1, -1).trim();
  }

  // Pattern 1: Numeric range - (column >= X AND column <= Y)
  const rangePattern = new RegExp(
    `\\(?\\(?(${columnName})\\s*(>=|>)\\s*([\\d.\\-]+)\\s*(?:AND)?\\s*\\)?\\s*\\(?(${columnName})\\s*(<=|<)\\s*([\\d.\\-]+)\\)?\\)?`,
    'i'
  );
  const rangeMatch = constraint.match(rangePattern);
  if (rangeMatch) {
    const [, , gtOp, gtValue, , ltOp, ltValue] = rangeMatch;
    const gteMethod = gtOp === '>=' ? 'gte' : 'gt';
    const lteMethod = ltOp === '<=' ? 'lte' : 'lt';
    return {
      originalConstraint: checkClause,
      validatorModifier: `.${gteMethod}(${gtValue}).${lteMethod}(${ltValue})`,
      success: true,
      description: `Value must be ${gtOp} ${gtValue} and ${ltOp} ${ltValue}`,
    };
  }

  // Pattern 2: Simple greater than/equal - (column >= X)
  const gtePattern = new RegExp(
    `\\(?(${columnName})\\s*(>=|>)\\s*([\\d.\\-]+)\\)?`,
    'i'
  );
  const gteMatch = constraint.match(gtePattern);
  if (gteMatch) {
    const [, , op, value] = gteMatch;
    const method = op === '>=' ? 'gte' : 'gt';
    return {
      originalConstraint: checkClause,
      validatorModifier: `.${method}(${value})`,
      success: true,
      description: `Value must be ${op} ${value}`,
    };
  }

  // Pattern 3: Simple less than/equal - (column <= X)
  const ltePattern = new RegExp(
    `\\(?(${columnName})\\s*(<=|<)\\s*([\\d.\\-]+)\\)?`,
    'i'
  );
  const lteMatch = constraint.match(ltePattern);
  if (lteMatch) {
    const [, , op, value] = lteMatch;
    const method = op === '<=' ? 'lte' : 'lt';
    return {
      originalConstraint: checkClause,
      validatorModifier: `.${method}(${value})`,
      success: true,
      description: `Value must be ${op} ${value}`,
    };
  }

  // Pattern 4: String length - length(column) <= X or char_length(column) <= X
  const lengthPattern = new RegExp(
    `\\(?(?:length|char_length)\\s*\\(\\s*${columnName}\\s*\\)\\s*(<=|<|>=|>)\\s*(\\d+)\\)?`,
    'i'
  );
  const lengthMatch = constraint.match(lengthPattern);
  if (lengthMatch) {
    const [, op, value] = lengthMatch;
    const method =
      op === '<=' ? 'lte' : op === '<' ? 'lt' : op === '>=' ? 'gte' : 'gt';
    return {
      originalConstraint: checkClause,
      validatorModifier: `.${method}(${value})`,
      success: true,
      description: `String length must be ${op} ${value}`,
      warning:
        'Note: Convex validators check string length on the value itself. Ensure this matches your intent.',
    };
  }

  // Pattern 5: IN clause - column IN ('val1', 'val2', 'val3')
  const inPattern = new RegExp(
    `\\(?(${columnName})\\s+IN\\s*\\(\\s*([^)]+)\\s*\\)\\)?`,
    'i'
  );
  const inMatch = constraint.match(inPattern);
  if (inMatch) {
    const [, , values] = inMatch;
    const valueList = values
      .split(',')
      .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
      .filter((v) => v.length > 0);

    if (valueList.length > 0 && valueList.length <= 20) {
      // Only convert if reasonable number of values
      const literals = valueList.map((v) => `v.literal("${v}")`).join(', ');
      return {
        originalConstraint: checkClause,
        validatorModifier: `v.union(${literals})`,
        success: true,
        description: `Value must be one of: ${valueList.join(', ')}`,
        warning:
          'This uses v.union() instead of a validator modifier. Adjust your schema accordingly.',
      };
    }
  }

  // Pattern 6: NOT NULL (redundant with column.isNullable but sometimes in CHECK)
  const notNullPattern = new RegExp(
    `\\(?(${columnName})\\s+IS\\s+NOT\\s+NULL\\)?`,
    'i'
  );
  if (notNullPattern.test(constraint)) {
    return {
      originalConstraint: checkClause,
      validatorModifier: null,
      success: true,
      description: 'Column cannot be NULL (handled by isNullable flag)',
      warning:
        'This constraint is redundant with column nullability. No validator needed.',
    };
  }

  // Pattern 7: Boolean check - column = true/false
  const boolPattern = new RegExp(
    `\\(?(${columnName})\\s*=\\s*(true|false)\\)?`,
    'i'
  );
  const boolMatch = constraint.match(boolPattern);
  if (boolMatch) {
    const [, , value] = boolMatch;
    return {
      originalConstraint: checkClause,
      validatorModifier: `v.literal(${value.toLowerCase()})`,
      success: true,
      description: `Value must be ${value}`,
      warning:
        'This creates a literal validator. Consider if this constraint is needed.',
    };
  }

  // Unsupported constraint
  return {
    originalConstraint: checkClause,
    validatorModifier: null,
    success: false,
    description: 'Complex constraint - manual conversion required',
    warning:
      'This check constraint cannot be automatically converted. Implement validation logic in your Convex mutations.',
  };
}

/**
 * Extract all check constraints for a column and convert them
 */
export function convertColumnCheckConstraints(
  columnName: string,
  dataType: string,
  checkConstraints: Array<{ checkClause: string; constraintName: string }>
): CheckConstraintConversion[] {
  const conversions: CheckConstraintConversion[] = [];

  for (const constraint of checkConstraints) {
    // Filter to constraints that reference this column
    if (
      constraint.checkClause.toLowerCase().includes(columnName.toLowerCase())
    ) {
      const conversion = convertCheckConstraint(
        constraint.checkClause,
        columnName,
        dataType
      );
      conversions.push(conversion);
    }
  }

  return conversions;
}

/**
 * Apply check constraint validators to a base validator
 */
export function applyCheckConstraintValidators(
  baseValidator: string,
  conversions: CheckConstraintConversion[]
): string {
  let result = baseValidator;

  for (const conversion of conversions) {
    if (conversion.success && conversion.validatorModifier) {
      // Skip if it's a v.union() or v.literal() replacement
      if (
        conversion.validatorModifier.startsWith('v.union') ||
        conversion.validatorModifier.startsWith('v.literal')
      ) {
        // Replace entire validator
        result = conversion.validatorModifier;
      } else {
        // Append as modifier
        result += conversion.validatorModifier;
      }
    }
  }

  return result;
}
