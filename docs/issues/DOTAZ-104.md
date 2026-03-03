# DOTAZ-104: Parameterize LIMIT/OFFSET in driver iterate()

**Phase**: 14 — Robustness & Tech Debt II
**Type**: backend
**Dependencies**: none

## Description

SQLite and MySQL `iterate()` methods build paginated SQL by string-interpolating `batchSize` and `offset`:

```typescript
// sqlite-driver.ts:297
const pagedSql = `${sql} LIMIT ${batchSize} OFFSET ${offset}`
```

While these values are internally controlled numbers (not user input), this violates the project's strict "parameterized queries always" convention. Use placeholder parameters instead.

### Implementation

Append `LIMIT ? OFFSET ?` (SQLite/MySQL use `?` placeholders) and spread the additional params alongside the user-provided params array:

```typescript
const pagedSql = `${sql} LIMIT ? OFFSET ?`
const allParams = [...(params ?? []), batchSize, offset]
const result = await this.db!.unsafe(pagedSql, allParams)
```

## Files

- `src/backend-shared/drivers/sqlite-driver.ts` — parameterize LIMIT/OFFSET in `iterate()`
- `src/backend-shared/drivers/mysql-driver.ts` — parameterize LIMIT/OFFSET in `iterate()`
- `tests/driver-iterate.test.ts` — verify iterate still works correctly after the change

## Acceptance Criteria

- [ ] SQLite `iterate()` uses `LIMIT ? OFFSET ?` with params instead of interpolation
- [ ] MySQL `iterate()` uses `LIMIT ? OFFSET ?` with params instead of interpolation
- [ ] Existing iterate tests pass unchanged
- [ ] `bunx tsc --noEmit` passes
- [ ] All tests pass
