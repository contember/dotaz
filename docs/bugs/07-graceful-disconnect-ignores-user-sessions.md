# gracefulDisconnect() only rolls back DEFAULT_SESSION, ignores user sessions

**Severity:** Medium
**Files:** `src/backend-shared/services/connection-manager.ts:571-598`

## Description

`gracefulDisconnect()` only checks and rolls back the `DEFAULT_SESSION` transaction, and only cancels the pool-level active query. User-created sessions with active transactions or in-flight queries are not handled.

```typescript
private async gracefulDisconnect(connectionId: string): Promise<void> {
    for (const [dbName, driver] of driverMap) {
        if (driver.inTransaction()) {     // checks DEFAULT_SESSION only
            await driver.rollback()       // rolls back DEFAULT_SESSION only
        }
        await driver.cancel()             // cancels poolActiveQuery only
        await driver.disconnect()
    }
}
```

The subsequent `driver.disconnect()` does handle session rollbacks internally, but active queries on sessions are never cancelled before the connection is torn down.

## Impact

When the user manually disconnects, in-flight queries on sessions may continue running on the server until the TCP connection is fully closed, potentially holding locks.

## Proposed fix

Cancel and rollback all sessions before disconnect:

```typescript
private async gracefulDisconnect(connectionId: string): Promise<void> {
    for (const [dbName, driver] of driverMap) {
        // Cancel and rollback all sessions
        for (const sid of driver.getSessionIds()) {
            try { await driver.cancel(sid) } catch { }
            if (driver.inTransaction(sid)) {
                try { await driver.rollback(sid) } catch { }
            }
        }
        // Also handle default session
        if (driver.inTransaction()) {
            try { await driver.rollback() } catch { }
        }
        try { await driver.cancel() } catch { }
        await driver.disconnect()
    }
}
```

## Resolution

**Status:** FIXED (commit 4e15d6c)

`gracefulDisconnect()` now iterates `driver.getSessionIds()` before handling the default session, calling `cancel(sid)` and `rollback(sid)` on each user session. This ensures in-flight queries on sessions are cancelled immediately on disconnect rather than lingering until TCP close.
