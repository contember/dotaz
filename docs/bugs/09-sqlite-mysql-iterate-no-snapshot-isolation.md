# SQLite/MySQL iterate() uses OFFSET/LIMIT without snapshot isolation

**Severity:** Medium
**Drivers:** SQLite, MySQL
**Files:** `src/backend-shared/drivers/sqlite-driver.ts:295-316`, `src/backend-shared/drivers/mysql-driver.ts:452-475`

## Description

Each batch in `iterate()` is a separate query with no transaction wrapping. Between batches, concurrent modifications can cause inconsistent results:

- Deleted rows shift offsets -> rows are **skipped**
- Inserted rows shift offsets -> rows are **duplicated**

```typescript
async *iterate(sql, params?, batchSize = 1000, signal?, _sessionId?) {
    let offset = 0
    while (true) {
        const pagedSql = `${sql} LIMIT ? OFFSET ?`
        const result = await this.db!.unsafe(pagedSql, [...(params ?? []), batchSize, offset])
        const rows = [...result] as Record<string, unknown>[]
        if (rows.length === 0) break
        yield rows
        if (rows.length < batchSize) break
        offset += batchSize
    }
}
```

The PostgreSQL driver correctly uses a cursor within a REPEATABLE READ transaction for consistent snapshot reads.

## Impact

Exports from SQLite/MySQL may silently produce inconsistent data if the table is modified during export. For SQLite (single-writer, WAL), the window is smaller but the issue still exists.

## Proposed fix

Wrap the iteration in a transaction for snapshot isolation:

```typescript
async *iterate(sql, params?, batchSize = 1000, signal?, _sessionId?) {
    await this.db!.unsafe('BEGIN')
    try {
        let offset = 0
        while (true) {
            // ... same LIMIT/OFFSET logic ...
        }
        await this.db!.unsafe('COMMIT')
    } catch (err) {
        try { await this.db!.unsafe('ROLLBACK') } catch { }
        throw err
    }
}
```

## Triage Result

**Status:** FIXED

Both drivers now wrap `iterate()` in a transaction for snapshot isolation:
- **SQLite:** `BEGIN`/`COMMIT` around the LIMIT/OFFSET loop, with guard against active transactions
- **MySQL:** Reserves a dedicated connection and uses `START TRANSACTION WITH CONSISTENT SNAPSHOT`, with proper connection cleanup in `finally` (matching the PostgreSQL driver's pattern)

Both include early-return safety via `finally` blocks that ensure ROLLBACK and connection release even if the consumer breaks out of the async generator.
