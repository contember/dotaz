# DOTAZ-103: Transaction state notification on reconnect

**Phase**: 14 — Robustness & Tech Debt II
**Type**: fullstack
**Dependencies**: none

## Description

When a database connection drops and auto-reconnect succeeds (`connection-manager.ts:attemptReconnect`), any in-flight transaction is silently lost. The frontend still shows the transaction as active (COMMIT/ROLLBACK buttons visible, pending count in status bar), leading to confusing errors when the user tries to commit.

### Backend changes

After a successful reconnect, check if the old driver had `inTransaction() === true`. If so, emit a new status event (e.g. `transactionLost`) so the frontend can react. The reconnect already creates a fresh driver, so the new driver correctly starts with no transaction — the issue is purely notification.

### Frontend changes

Listen for `transactionLost` events. When received:

1. Reset the editor store's transaction state for that connection
2. Show a warning toast: "Connection was lost and restored. Active transaction was rolled back by the server."

## Files

- `src/backend-shared/services/connection-manager.ts` — in `attemptReconnect()`, check old driver's `inTransaction()` before replacing, emit event if transaction was active
- `src/shared/types/connection.ts` — add `transactionLost` to `ConnectionStatusEvent` or add a new event type
- `src/frontend-shared/stores/editor.ts` — handle `transactionLost` event, reset transaction state
- `src/frontend-shared/stores/ui.ts` — show warning toast on transaction loss

## Acceptance Criteria

- [ ] `attemptReconnect()` checks old driver's `inTransaction()` before creating replacement
- [ ] If old driver had active transaction, a `transactionLost` event is emitted with connectionId
- [ ] Frontend listens for `transactionLost` and resets editor transaction state
- [ ] Warning toast displayed to user explaining the lost transaction
- [ ] No false positives — event only fires when a transaction was genuinely active
- [ ] `bunx tsc --noEmit` passes
- [ ] All tests pass
