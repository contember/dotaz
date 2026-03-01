# DOTAZ-090: Transaction log and pending transaction viewer

**Phase**: 12 — DBeaver Parity
**Type**: fullstack
**Dependencies**: [DOTAZ-047]

## Description

Combined feature: a transaction log panel showing all executed statements in the current session, plus awareness of uncommitted transactions with warnings before closing.

### Transaction Log
- Panel (tab in bottom area or sidebar) listing all statements executed in the session
- Each entry: SQL text (truncated), timestamp, duration, row count, status (success/error)
- Filterable by status (success/error) and searchable
- Click on entry to see full SQL and error details

### Pending Transaction Awareness
- When in manual commit mode and there are uncommitted changes:
  - Visual indicator in status bar (e.g. "TX: 3 pending statements")
  - Warning dialog when closing tab/window/disconnecting: "You have uncommitted changes. Commit, Rollback, or Cancel?"
- Track statements since last BEGIN/COMMIT/ROLLBACK

### Architecture
- Backend tracks executed statements per connection in memory (not persisted — session-only)
- New RPC endpoint to fetch transaction log
- Frontend subscribes to updates or polls on tab focus

## Files

- `src/backend-shared/services/query-executor.ts` — track executed statements in session log
- `src/shared/types/rpc.ts` — add `transaction.getLog` RPC endpoint
- `src/backend-shared/rpc/rpc-handlers.ts` — transaction log handler
- `src/frontend-shared/components/editor/TransactionLog.tsx` — log panel component
- `src/frontend-shared/components/editor/TransactionLog.css` — panel styling
- `src/frontend-shared/components/layout/StatusBar.tsx` — pending TX indicator
- `src/frontend-shared/stores/editor.ts` — transaction log state

## Acceptance Criteria

- [ ] Transaction log panel showing executed statements for current connection
- [ ] Each entry shows: SQL preview, timestamp, duration, row count, status
- [ ] Click entry to see full SQL text
- [ ] Filter by success/error status
- [ ] Search within log entries
- [ ] Pending TX indicator in status bar (manual commit mode)
- [ ] Warning dialog on close/disconnect with uncommitted changes
- [ ] Warning offers: Commit, Rollback, Cancel
- [ ] Log is per-session (not persisted across restarts)
