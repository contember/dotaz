# DOTAZ-083: Driver-aware query placeholder generation

**Phase**: 8.5 — Tech Debt
**Type**: backend
**Dependencies**: none

## Description

All query builders in `query-executor.ts` hardcode PostgreSQL-style `$N` placeholders. The MySQL driver then converts `$N` → `?` via simple regex (`/\$\d+/g`) at execution time (mysql-driver.ts:18-19). This is fragile — the regex will incorrectly replace `$1` if it appears inside a SQL string literal.

The correct fix is generating the right placeholder format from the start rather than post-processing.

Changes needed:
1. Add `placeholder(index: number): string` method to `DatabaseDriver` interface
   - PostgreSQL/SQLite: returns `$${index}`
   - MySQL: returns `?`
2. Update all query builder functions in `query-executor.ts` to accept a placeholder generator
3. Remove the regex replacement in `mysql-driver.ts`
4. Add tests for MySQL queries containing `$` in string literals

## Files

- `src/backend-shared/db/driver.ts` — add `placeholder(index: number): string` to interface
- `src/backend-shared/drivers/postgres-driver.ts` — implement `placeholder()` returning `$N`
- `src/backend-shared/drivers/sqlite-driver.ts` — implement `placeholder()` returning `$N`
- `src/backend-shared/drivers/mysql-driver.ts` — implement `placeholder()` returning `?`, remove regex conversion
- `src/backend-shared/services/query-executor.ts` — pass placeholder generator to all build* functions

## Acceptance Criteria

- [ ] `placeholder()` method on DatabaseDriver interface
- [ ] Query builders use driver's placeholder method instead of hardcoded `$N`
- [ ] MySQL driver no longer does regex replacement on SQL strings
- [ ] Test: MySQL query with `'costs $100'` string literal works correctly
- [ ] All existing tests pass across all 3 drivers
