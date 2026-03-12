# Query timeout leaves orphaned server-side queries

**Severity:** High
**Files:** `src/backend-shared/services/query-executor.ts:347-388`

## Description

When a query timeout fires, `Promise.race` resolves with the timeout error, but the actual database query continues running on the server. The `finally` block clears the JS timer but never calls `driver.cancel()`.

```typescript
const result = await Promise.race([
    driver.execute(sql, params, sessionId),
    timeoutPromise,   // wins the race on timeout
])
// ...
} finally {
    cancelTimeout()   // clears the JS timer, but driver.cancel() is NEVER called
}
```

## Scenario

1. User runs `SELECT pg_sleep(300)` with a 30s timeout
2. After 30s, the timeout promise rejects — caller gets an error
3. The actual query continues executing on PostgreSQL for another 270 seconds
4. The query holds connections, locks, and server resources
5. If on a session, the session's connection is still busy — subsequent queries on the same session block behind the still-running query

## Proposed fix

Call `driver.cancel()` when the timeout fires:

```typescript
} catch (err) {
    // If timeout, cancel the actual server-side query
    if (effectiveSessionId !== undefined) {
        try { await driver.cancel(effectiveSessionId) } catch { }
    } else {
        try { await driver.cancel() } catch { }
    }
    // ...
}
```

## Triage Result

**Status:** FIXED

Code confirmed: `Promise.race()` catches timeout, `finally` only calls `cancelTimeout()` (clears JS timer). `driver.cancel()` is never called. The `cancelQuery()` method (line 195) does call `driver.cancel()` but it's only invoked via explicit user cancellation, not on timeout. Orphaned queries hold connections and locks.

## Resolution

Added a `fired` flag to `createTimeout()` so `executeSingle()` can detect when the timeout triggered. In the catch block, when `timeout.fired` is true, `driver.cancel()` is now called (with or without sessionId) to stop the server-side query. This prevents orphaned queries from holding connections and locks after a JS-side timeout.

Two regression tests added in `tests/query-executor.test.ts`:
- Verifies `driver.cancel()` is called on timeout (no session)
- Verifies `driver.cancel(sessionId)` is called on timeout with a session
