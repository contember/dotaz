# iterate() starts transactions invisible to txActive tracking

**Severity**: High

## Description

All three drivers' `iterate()` methods open a transaction on a session's connection without setting `txActive`. This makes the transaction invisible to health checks, transaction guards, and the `hadTransaction` reporting on connection loss.

## Code path

`src/backend-shared/drivers/postgres-driver.ts:677-728`, `sqlite-driver.ts:295-326`, `mysql-driver.ts:453-490`

```typescript
// postgres-driver.ts:694-695
const conn = session ? session.conn : await this.db!.reserve()
await conn.unsafe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
// session.txActive is never set to true
```

## Scenarios

### Scenario 1: Incorrect hadTransaction reporting

During iteration (between yields), the health check fires. `performHealthCheck` in `connection-manager.ts:452-458` checks `driver.inTransaction(sid)` for all sessions and sees `false`. If the connection then drops, `hadTransaction` is reported as `false`, and the frontend is told no transaction was lost — but the iterate's snapshot transaction was active.

### Scenario 2: Concurrent transaction start (PostgreSQL/MySQL)

Between yields, another async task calls `beginTransaction(sessionId)` on the same session. The driver checks `session.txActive` (false), allows it, and sends `BEGIN` to a connection that already has an active transaction. PostgreSQL would warn but continue (nested BEGIN is a warning), MySQL would implicitly commit the iterate's transaction, silently breaking snapshot isolation.

### Scenario 3: Concurrent execution (SQLite)

Between yields of `iterate()`, another code path calls `execute()` on the same driver. Since SQLite has a single connection and `txActive` is false, nothing prevents `beginTransaction()` from being called, which would fail with "cannot start a transaction within a transaction" — or worse, the concurrent execute runs inside iterate's transaction, and if iterate subsequently does ROLLBACK on error, the concurrent write is silently lost.

## Impact

Silent snapshot isolation breakage, incorrect transaction loss reporting, potential data loss on SQLite.

## Suggested fix

Set `txActive = true` for the session (or an equivalent flag like `iterating`) before BEGIN, and reset it in the finally block. For the `ownConn` path this is less critical since the connection is private.

## Resolution

Fixed by setting `txActive = true` before BEGIN and resetting it in the finally block in all three drivers:

- **PostgreSQL/MySQL**: `session.txActive = true` before BEGIN, `session.txActive = false` in finally (only when using a session, not for owned connections)
- **SQLite**: `this.txActive = true` + `this.txOwnerSession = sessionId` before BEGIN, both reset in finally

The finally block guarantees the flag is always reset regardless of commit, rollback, or error. The fix only applies to session-bound iterations — owned connections (`ownConn`) are private and released in finally, so tracking is unnecessary.
