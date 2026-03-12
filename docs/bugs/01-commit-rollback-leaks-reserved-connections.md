# commit()/rollback() failure leaks reserved connections

**Severity:** Critical
**Drivers:** PostgreSQL, MySQL
**Files:** `src/backend-shared/drivers/postgres-driver.ts:615-641`, `src/backend-shared/drivers/mysql-driver.ts:521-547`

## Description

When `commit()` or `rollback()` throws (network error, serialization failure), the reserved connection for `DEFAULT_SESSION` is never released back to the pool and never cleaned up from `this.sessions`.

```typescript
async commit(sessionId?: string): Promise<void> {
    const id = sessionId ?? DEFAULT_SESSION
    const session = this.sessions.get(id)
    if (!session) throw new Error('No active transaction')
    await session.conn.unsafe('COMMIT')   // if this throws...
    session.txActive = false              // never reached
    if (id === DEFAULT_SESSION) {
        session.conn.release()            // never reached — connection LEAKED
        this.sessions.delete(DEFAULT_SESSION)
    }
}
```

## Scenario

1. User issues COMMIT
2. Connection drops mid-COMMIT (or PostgreSQL returns serialization failure `40001`)
3. The reserved connection is never released back to the pool
4. `DEFAULT_SESSION` entry persists with `txActive: true`
5. Subsequent `beginTransaction()` without sessionId sees `DEFAULT_SESSION` exists via `resolveSession()` — new queries route to the leaked/broken connection
6. The caller cannot call `rollback()` because the connection may be dead
7. The connection is permanently leaked from the pool

## Proposed fix

Use `try/finally` to guarantee cleanup:

```typescript
async commit(sessionId?: string): Promise<void> {
    const id = sessionId ?? DEFAULT_SESSION
    const session = this.sessions.get(id)
    if (!session) throw new Error('No active transaction')
    try {
        await session.conn.unsafe('COMMIT')
    } catch (err) {
        try { await session.conn.unsafe('ROLLBACK') } catch { }
        throw err
    } finally {
        session.txActive = false
        if (id === DEFAULT_SESSION) {
            session.conn.release()
            this.sessions.delete(DEFAULT_SESSION)
        }
    }
}
```

## Triage Result

**Status:** FIXED

Code confirmed: `commit()` and `rollback()` have no try/finally. If `COMMIT` or `ROLLBACK` SQL throws (network error, serialization failure), `session.conn.release()` and `this.sessions.delete()` are never reached. The connection is permanently leaked from the pool.

## Resolution

Both `commit()` and `rollback()` in PostgreSQL and MySQL drivers wrapped with try/catch/finally:

- **`commit()`**: on failure, attempts `ROLLBACK` (swallows errors), re-throws original error. `finally` block always sets `txActive = false` and releases the DEFAULT_SESSION connection.
- **`rollback()`**: try/finally ensures cleanup regardless of whether `ROLLBACK` SQL succeeds.

Regression test added in `tests/postgres-driver-session.test.ts` — uses a deferred unique constraint to force `COMMIT` to fail, then verifies the session is cleaned up and the driver remains usable.
