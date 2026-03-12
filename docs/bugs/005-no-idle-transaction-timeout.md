# No idle transaction timeout — permanent connection leak

**Severity**: Medium

## Description

There is no mechanism to detect or reclaim sessions with idle open transactions. A user can call `beginTransaction()` on a session and never commit or rollback, holding a reserved database connection indefinitely.

## Code path

`src/backend-shared/services/session-manager.ts` has no timeout logic. `src/backend-shared/services/connection-manager.ts` health checks only run `SELECT 1` on the default driver (line 449), not on individual sessions.

## Scenario

1. User opens 8 sessions (max)
2. Begins transactions on all of them
3. Walks away
4. Each session holds a reserved database connection indefinitely
5. The Bun SQL pool has no available connections for new operations
6. Health checks pass because they use the shared pool, not reserved connections

## Impact

Resource exhaustion. The pool runs out of connections, blocking all new queries until the application is restarted.

## Suggested fix

Add a configurable idle transaction timeout. Periodically check session `txActive` timestamps and auto-rollback + release sessions that exceed the threshold.

## Resolution

Added idle transaction timeout to `SessionManager`:

- New setting `idleTransactionTimeoutMs` (default 5 minutes / 300 000 ms, `0` disables).
- `SessionManager` runs a 30-second interval check that polls `driver.inTransaction(sessionId)` for every active session.
- On first observation of an active transaction the timestamp is recorded in a `txFirstSeen` map.
- When elapsed time exceeds the configured timeout the transaction is auto-rolled back via `driver.rollback(sessionId)`.
- Tracking is cleaned up on normal commit/rollback, `destroySession()`, and `handleConnectionLost()`.
- `dispose()` method added to stop the timer.

**Files changed:**

- `src/backend-shared/storage/app-db.ts` — added `idleTransactionTimeoutMs` default setting
- `src/backend-shared/services/session-manager.ts` — idle check timer + `txFirstSeen` tracking + `dispose()`
- `tests/session-manager.test.ts` — 6 new tests covering auto-rollback, no false-positive rollback, cleanup paths, and disable via `0`
