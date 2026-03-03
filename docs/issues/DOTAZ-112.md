# DOTAZ-112: Session RPC endpoints and adapter wiring

**Phase**: 15 — Session Management
**Type**: backend
**Dependencies**: DOTAZ-110, DOTAZ-111

## Description

Wire session management through the RPC layer. Add session methods to the `RpcAdapter` interface, implement in `BackendAdapter` (using `SessionManager`) and `DemoAdapter` (no-op). Thread `sessionId` through all existing RPC handlers that touch the driver.

### RpcAdapter additions

```typescript
// New session methods
createSession(connectionId: string, database?: string): Promise<SessionInfo>;
destroySession(sessionId: string): Promise<void>;
listSessions(connectionId: string): SessionInfo[];
```

Add `sessionId?: string` to existing adapter methods:

- `executeQuery`, `executeStatements`, `cancelQuery`, `explainQuery`
- `beginTransaction`, `commitTransaction`, `rollbackTransaction`
- `getTransactionLog`, `clearTransactionLog`
- `exportData`, `exportPreview`
- `importData`
- `searchDatabase`
- `getDriver` — so `schema.load` handler can pass sessionId

### New RPC handlers

```typescript
"session.create":  ({ connectionId, database }) => adapter.createSession(connectionId, database)
"session.destroy": ({ sessionId }) => adapter.destroySession(sessionId)
"session.list":    ({ connectionId }) => adapter.listSessions(connectionId)
```

### Existing handlers — thread sessionId

All handlers that currently accept `connectionId` and/or `database` also accept optional `sessionId` and pass it through:

- `query.execute`, `query.explain`, `query.cancel`
- `tx.begin`, `tx.commit`, `tx.rollback`
- `schema.load`
- `transaction.getLog`, `transaction.clearLog`
- `export.exportData`, `export.preview`
- `import.importData`
- `search.searchDatabase`

### BackendAdapter implementation

- Accepts `SessionManager` via constructor options
- Session methods delegate to SessionManager
- All driver-accessing methods thread sessionId: `driver.execute(sql, params, sessionId)`, etc.
- `commitTransaction`/`rollbackTransaction` pass sessionId to txManager and sessionLog

### DemoAdapter implementation

- Session methods are no-ops (single WASM SQLite connection, sessions irrelevant)
- `createSession` returns a dummy SessionInfo
- `destroySession` is a no-op
- `listSessions` returns empty array
- All other methods ignore sessionId

### Backend wiring

- `rpc-handlers.ts` convenience wrapper: create `SessionManager` and pass to `BackendAdapter`
- `backend-desktop/index.ts`: register connection status listener → `sessionManager.handleConnectionLost()` on disconnect/error
- `backend-web/server.ts`: SessionManager is per-WebSocket session (created inside `rpc-handlers.ts`)

### Session change notification

Add backend→frontend message `"session.changed"` emitted on:

- Session created
- Session destroyed
- Connection lost (all sessions for that connection)

## Files

- `src/backend-shared/rpc/adapter.ts` — add session methods + sessionId to interface
- `src/backend-shared/rpc/backend-adapter.ts` — implement session methods, thread sessionId
- `src/backend-shared/rpc/handlers.ts` — add session.* handlers, thread sessionId through existing
- `src/backend-shared/rpc/rpc-handlers.ts` — create SessionManager, pass to BackendAdapter
- `src/frontend-demo/demo-adapter.ts` — no-op session implementation
- `src/backend-desktop/index.ts` — connection status listener for session cleanup
- `src/shared/types/rpc.ts` — add SessionInfo type (if not already in session-manager.ts)

## Acceptance Criteria

- [ ] `session.create`, `session.destroy`, `session.list` RPC handlers work
- [ ] All existing handlers accept and thread optional `sessionId`
- [ ] BackendAdapter delegates session lifecycle to SessionManager
- [ ] DemoAdapter has no-op session methods (no errors in demo mode)
- [ ] Connection loss triggers session cleanup and `session.changed` message
- [ ] `session.changed` message emitted on create/destroy
- [ ] Type check passes (`bunx tsc --noEmit`)
- [ ] All existing tests pass
