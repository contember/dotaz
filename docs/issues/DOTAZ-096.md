# DOTAZ-096: Driver `iterate()` and `importBatch()` methods

**Phase**: 13 — Robust Streaming Import/Export
**Type**: backend
**Dependencies**: none

## Description

Add two new methods to the `DatabaseDriver` interface for efficient large-dataset operations. Each driver implements them using database-native features internally — consumers have zero driver-type branching.

### `iterate()` — batched async iteration over query results

```typescript
iterate(
  sql: string,
  params?: unknown[],
  batchSize?: number,
  signal?: AbortSignal,
): AsyncIterable<Record<string, unknown>[]>
```

**PostgreSQL implementation**: Server-side cursor in a REPEATABLE READ read-only transaction. Reserves its **own dedicated connection** from the pool via `db.reserve()` (independent of the driver's main transaction state). Cursor lifecycle:

```
[on own reserved connection]
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY
DECLARE dotaz_iter_<unique_id> NO SCROLL CURSOR FOR <sql>
loop:
  FETCH FORWARD <batchSize> FROM dotaz_iter_<unique_id>
  → 0 rows? break
  → yield batch
  → check AbortSignal → if aborted: CLOSE, ROLLBACK, release, throw
CLOSE dotaz_iter_<unique_id>
COMMIT
[release reserved connection]
```

**SQLite implementation**: No cursor support. Internally appends `LIMIT <batchSize> OFFSET <n>` to the SQL, incrementing offset per iteration. Fast for local files.

**MySQL implementation**: LIMIT/OFFSET internally (or server-side cursor if MySQL driver supports it — implementation detail).

### `importBatch()` — bulk insert rows

```typescript
importBatch(
  qualifiedTable: string,
  columns: string[],
  rows: Record<string, unknown>[],
): Promise<number>  // returns affected row count
```

Receives pre-parsed row objects. Internally builds multi-row VALUES INSERT:

```sql
INSERT INTO <table> (<col1>, <col2>) VALUES ($1,$2), ($3,$4), ...
```

Uses driver's `placeholder()` for parameter markers. Future optimization: PG could switch to COPY FROM STDIN if Bun SQL adds support, without changing callers.

## Files

- `src/backend-shared/db/driver.ts` — add `iterate()` and `importBatch()` to `DatabaseDriver` interface
- `src/backend-shared/drivers/postgres-driver.ts` — implement with cursors (own reserved conn) + multi-row VALUES
- `src/backend-shared/drivers/sqlite-driver.ts` — implement with LIMIT/OFFSET + multi-row VALUES
- `src/backend-shared/drivers/mysql-driver.ts` — implement with LIMIT/OFFSET + multi-row VALUES
- `tests/driver-iterate.test.ts` — tests for iterate and importBatch

## Acceptance Criteria

- [ ] `iterate()` on DatabaseDriver interface with sql, params, batchSize, signal
- [ ] PG iterate uses DECLARE CURSOR / FETCH on its own reserved connection
- [ ] PG iterate uses REPEATABLE READ READ ONLY for snapshot consistency
- [ ] SQLite iterate uses LIMIT/OFFSET internally
- [ ] MySQL iterate implemented
- [ ] AbortSignal support: on abort, PG closes cursor + rollback + releases connection
- [ ] `importBatch()` on DatabaseDriver interface
- [ ] All drivers implement importBatch with multi-row VALUES INSERT
- [ ] Tests: iterate yields correct batches, importBatch inserts correctly, abort mid-iteration cleans up
