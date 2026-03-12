# Pool connections returned without session state reset

**Severity**: Medium

## Description

When a reserved connection is returned to the pool via `conn.release()`, there is no `DISCARD ALL`, `RESET`, or equivalent cleanup. Session-level state survives and can leak to the next pool user.

## Code path

`src/backend-shared/drivers/postgres-driver.ts:629`, `postgres-driver.ts:725`, `mysql-driver.ts:549`

Leaked state includes:
- `SET` variables (`search_path`, `statement_timeout`, `work_mem`, `role`)
- Temporary tables
- `LISTEN` subscriptions
- Advisory locks
- Prepared statements (if any were created via raw SQL)

## Scenario

1. QueryExecutor sets `search_path` on an ephemeral session
2. The search_path restore fails (caught and swallowed at `query-executor.ts:178-181`)
3. The session is released — dirty connection returns to pool
4. The next pool user gets a connection with a wrong `search_path`

```typescript
// query-executor.ts:178-181
try {
    await driver.execute(`SET search_path TO ${savedSearchPath}`, undefined, effectiveSessionId)
} catch { /* best effort */ }  // failure = dirty connection returns to pool
```

## Impact

Subsequent queries on the polluted connection may operate on the wrong schema, see unexpected temporary tables, or hold advisory locks that block other operations.

## Suggested fix

Run `DISCARD ALL` (PostgreSQL) or `RESET` equivalent before releasing reserved connections back to the pool, especially for ephemeral sessions.

## Resolution

Added session state cleanup before every `conn.release()` call in both drivers:

**PostgreSQL** (`postgres-driver.ts`): `DISCARD ALL` is executed before releasing in `disconnect()`, `releaseSession()`, and `iterate()` (owned connections). This resets all session-level state — `search_path`, SET variables, temp tables, LISTEN subscriptions, advisory locks, and prepared statements.

**MySQL** (`mysql-driver.ts`): `UNLOCK TABLES` is executed at the same three locations. MySQL lacks a single equivalent to `DISCARD ALL`; `UNLOCK TABLES` covers the most critical leak (table locks). Other session state (SET variables, user-defined variables) has no blanket reset command in MySQL.

All cleanup calls are wrapped in try-catch (best effort) so a broken connection does not prevent the release.
