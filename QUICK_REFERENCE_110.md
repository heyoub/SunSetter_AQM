# Quick Reference: 110% Features

## New PostgreSQL Extension Types Supported

### Hierarchical Data (ltree)
```sql
-- PostgreSQL
CREATE TABLE categories (
  path ltree  -- e.g., 'Top.Science.Astronomy'
);
```
```typescript
// Convex (auto-mapped)
path: v.string()  // Materialized path format
```

### Key-Value Pairs (hstore)
```sql
-- PostgreSQL
CREATE TABLE products (
  attributes hstore  -- e.g., '"color" => "red", "size" => "large"'
);
```
```typescript
// Convex (auto-mapped)
attributes: v.any()  // Object with string keys
```

### Multidimensional Cubes (cube)
```sql
-- PostgreSQL
CREATE TABLE measurements (
  dimensions cube  -- e.g., '(0,0,0),(1,1,1)'
);
```
```typescript
// Convex (auto-mapped)
dimensions: v.string()  // Serialized cube format
```

### Book Identifiers (isbn/issn)
```sql
-- PostgreSQL
CREATE TABLE books (
  isbn13 isbn13,
  issn issn13
);
```
```typescript
// Convex (auto-mapped)
isbn13: v.string(),
issn: v.string()
```

---

## Auto-Enum Detection (NEW!)

### Before (Manual)
```typescript
// You had to do this:
const typeMapper = new ConvexTypeMapper();
typeMapper.registerEnumMapping('order_status', [
  'pending', 'processing', 'shipped', 'delivered'
]);
```

### After (Automatic)
```typescript
// Now it just works! Enums are auto-detected:
// Console output:
// [Schema Introspector] Auto-detected 1 enum type(s) in schema "public"
//   - order_status: [pending, processing, shipped, delivered]
```

---

## Advanced Table Detection

### Partitioned Tables
```sql
CREATE TABLE orders (
  order_id SERIAL,
  order_date DATE
) PARTITION BY RANGE (order_date);
```

**Output**:
```
WARNING: Table "orders" is a PARTITIONED TABLE (strategy: RANGE, key: order_date).
Convex does not support table partitioning. All partitions will be merged.
```

### Materialized Views
```sql
CREATE MATERIALIZED VIEW sales_summary AS
SELECT customer_id, SUM(total) FROM orders GROUP BY customer_id;
```

**Output**:
```
WARNING: "sales_summary" is a MATERIALIZED VIEW.
This will be migrated as read-only data.
You need to implement refresh logic manually in Convex mutations.
```

### Foreign Tables
```sql
CREATE FOREIGN TABLE remote_users (
  id INTEGER,
  name TEXT
) SERVER mysql_server;
```

**Output**:
```
ERROR: "remote_users" is a FOREIGN TABLE (server: mysql_server).
This table will be SKIPPED. Consider implementing external API calls in Convex.
```

---

## Check Constraint Conversion

### Simple Ranges
```sql
-- PostgreSQL
CHECK (age >= 18 AND age <= 120)
```
```typescript
// Convex (auto-converted)
age: v.number().gte(18).lte(120)
```

### Price Validation
```sql
-- PostgreSQL
CHECK (price > 0)
```
```typescript
// Convex (auto-converted)
price: v.number().gt(0)
```

### String Length
```sql
-- PostgreSQL
CHECK (length(username) <= 50)
```
```typescript
// Convex (auto-converted)
username: v.string().lte(50)
```

### Enum-like IN Clause
```sql
-- PostgreSQL
CHECK (status IN ('active', 'inactive', 'pending'))
```
```typescript
// Convex (auto-converted)
status: v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("pending")
)
```

---

## Index Suggestions

### Automatic Index Generation

After migration, you'll see:
```
Convex Index Suggestions:

  HIGH PRIORITY:
    - userEmail (UNIQUE): [email]
      Reason: Unique constraint - critical for data integrity

    - orderCustomerId: [customer_id]
      Reason: Foreign key to customers - essential for relationship queries

  MEDIUM PRIORITY:
    - orderCreatedAt: [created_at]
      Reason: Timestamp column - commonly used for sorting and filtering
```

### Copy-Paste Ready Code
```typescript
// Suggested indexes for orders
export default defineTable({
  customerId: v.id("customers"),
  createdAt: v.number(),
  status: v.string(),
  // ... other fields
})
  .index("orderCustomerId", ["customerId"])
  .index("orderCreatedAt", ["createdAt"])
  .index("orderStatus", ["status"]);
```

---

## Version Detection

When you connect, you'll see:
```
[PostgreSQL] Connected to Amazon Aurora PostgreSQL 14.6 (PostgreSQL 14.6 on x86_64...)
```

Detects:
- Amazon Aurora PostgreSQL
- Supabase PostgreSQL
- Azure Database for PostgreSQL
- Google Cloud SQL PostgreSQL
- Standard PostgreSQL

---

## Expression Index Warnings

### Before
```sql
CREATE INDEX idx_users_lower_email ON users(LOWER(email));
```
Silent migration → index lost!

### After
```
WARNING: Expression-based index detected: idx_users_lower_email
Convex does not support expression indexes. Consider indexing the base column(s)
or implementing the expression logic in your queries.
```

---

## API Quick Reference

### PostgreSQL Adapter

```typescript
// Detect advanced features
const features = await adapter.detectAdvancedTableFeatures(schema, table);
// Returns: { isPartitioned, isMaterializedView, isForeignTable, warnings }

// Get PostgreSQL version
const version = await adapter.getPostgreSQLVersion();
// Returns: { version, fullVersion, majorVersion, minorVersion, name }

// Get enum types
const enums = await adapter.getEnumTypes(schema);
// Returns: [{ enumName, enumValues, description }]
```

### Check Constraint Converter

```typescript
import { convertCheckConstraint } from './convex/check-constraint-converter';

const result = convertCheckConstraint(
  'CHECK (age >= 18 AND age <= 120)',
  'age',
  'integer'
);
// Returns: {
//   originalConstraint: 'CHECK (...)',
//   validatorModifier: '.gte(18).lte(120)',
//   success: true,
//   description: 'Value must be >= 18 and <= 120'
// }
```

### Index Suggestion Generator

```typescript
import {
  generateConvexIndexSuggestions,
  formatIndexSuggestions,
  generateConvexIndexCode
} from './convex/index-suggestion-generator';

const suggestions = generateConvexIndexSuggestions(table);
console.log(formatIndexSuggestions(suggestions));

const code = generateConvexIndexCode(suggestions, table.tableName);
// Ready-to-paste Convex schema code
```

---

## Migration Workflow (110%)

### 1. Connect
```typescript
const adapter = createPostgreSQLAdapter(config);
await adapter.connect();
// Logs: [PostgreSQL] Connected to Amazon Aurora PostgreSQL 14.6
```

### 2. Introspect
```typescript
const schema = await introspector.introspectSchema('public');
// Auto-detects enums, logs warnings for advanced features
```

### 3. Review Warnings
Check console for:
- ⚠️ Partitioned table warnings
- ⚠️ Materialized view warnings
- ❌ Foreign table errors
- ⚠️ Expression index warnings

### 4. Generate Schema
```typescript
const suggestions = generateConvexIndexSuggestions(table);
const indexCode = generateConvexIndexCode(suggestions, table.tableName);
// Copy-paste into your schema.ts
```

### 5. Apply Constraint Validators
```typescript
const constraints = convertColumnCheckConstraints(
  'age',
  'integer',
  table.checkConstraints
);
// Apply to your validators
```

### 6. Migrate
```typescript
await migrationEngine.migrate();
// With confidence that all features are handled!
```

---

## Common Patterns

### Pattern 1: User Table with Email
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE CHECK (length(email) <= 255),
  age INTEGER CHECK (age >= 18),
  status user_status  -- ENUM
);
CREATE INDEX idx_users_email ON users(email);
```

**Auto-generated Convex schema**:
```typescript
export default defineTable({
  email: v.string().lte(255),
  age: v.number().gte(18),
  status: v.union(
    v.literal("active"),
    v.literal("inactive")
  )
})
  .index("userEmail", ["email"]);
```

### Pattern 2: Orders with Foreign Key
```sql
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  created_at TIMESTAMP,
  status order_status
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_created ON orders(created_at);
```

**Auto-generated Convex schema**:
```typescript
export default defineTable({
  customerId: v.id("customers"),
  createdAt: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("shipped"),
    v.literal("delivered")
  )
})
  .index("orderCustomerId", ["customerId"])
  .index("orderCreatedAt", ["createdAt"]);
```

### Pattern 3: Products with ltree Categories
```sql
CREATE EXTENSION ltree;
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT,
  category_path ltree,
  attributes hstore
);
```

**Auto-generated Convex schema**:
```typescript
export default defineTable({
  name: v.string(),
  categoryPath: v.string(),  // Materialized path
  attributes: v.any()         // Key-value object
});
```

---

## Troubleshooting

### Q: Enum not auto-detected?
**A**: Check that the enum is in the correct schema:
```sql
SELECT n.nspname, t.typname
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE t.typtype = 'e';
```

### Q: Partitioned table warning?
**A**: Expected behavior. Review your partition strategy and ensure all partitions are accessible.

### Q: Materialized view refresh logic?
**A**: Create a Convex scheduled function:
```typescript
export const refreshSalesSummary = internalMutation({
  handler: async (ctx) => {
    // Implement refresh logic here
  }
});
```

### Q: Foreign table skipped?
**A**: Create a Convex action to query the external source:
```typescript
export const getRemoteUsers = action({
  handler: async (ctx) => {
    // Query external API/database
  }
});
```

---

## Performance Tips

1. **Index High-Priority Suggestions First**: Focus on foreign keys and unique constraints
2. **Review Medium-Priority Suggestions**: Timestamp and status columns often need indexes
3. **Skip Low-Priority Suggestions**: Hash/GIN/GiST index conversions may not be necessary
4. **Test Query Performance**: Use Convex dashboard to monitor query times
5. **Add Indexes Incrementally**: Don't add all suggestions at once—test each one

---

## Support

For complex migrations or custom requirements:
- Check the full enhancement documentation: `ENHANCEMENTS_110_PERCENT.md`
- Review source code with inline comments
- Test with a staging database first
- Use Convex dashboard for performance monitoring

---

**You're now equipped to migrate ANY PostgreSQL database to Convex at 110%!** 🚀
