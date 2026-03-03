# DOTAZ-113: Frontend session management and UI

**Phase**: 15 — Session Management
**Type**: frontend
**Dependencies**: DOTAZ-112

## Description

Add session management to the frontend: a session store for tab↔session bindings, auto-pin logic, editor/grid store integration, and UI elements for pinning/unpinning sessions.

### Session store (new)

**File:** `src/frontend-shared/stores/session.ts`

Manages tab↔session bindings (frontend-only concern). Backend doesn't know about tabs.

```typescript
State:
  sessions: Record<sessionId, SessionInfo>
  tabSessions: Record<tabId, sessionId>

Actions:
  pinSession(connectionId, tabId, database?)    // rpc.session.create, bind tab
  unpinSession(tabId)                           // unbind, destroy if last tab
  shareSession(sessionId, tabId)                // bind another tab to existing session
  getSessionForTab(tabId): string | undefined
  isTabPinned(tabId): boolean
  listSessionsForConnection(connectionId): SessionInfo[]
  handleTabClosed(tabId)                        // unbind, destroy if no more tabs
```

**Auto-pin logic:** Before executing a query, check SQL against `autoPin` setting:

- `"on-begin"`: auto-pin if SQL contains `BEGIN` or `START TRANSACTION`
- `"on-set-session"`: also auto-pin on `SET` (not `SET LOCAL`), `CREATE TEMP/TEMPORARY`
- `"never"`: never auto-pin

**Auto-unpin logic:** After commit/rollback, check `autoUnpin` setting:

- `"on-commit"`: auto-unpin (destroy session) after COMMIT or ROLLBACK
- `"never"`: keep session pinned

Listen to `session.changed` backend message for external session destruction (e.g., connection lost).

### Editor store integration

**File:** `src/frontend-shared/stores/editor.ts`

- Add `sessionId: string | null` to `TabEditorState`
- `runQuery()`: resolve sessionId from session store, pass to `rpc.query.execute()`
- Before `runQuery()`: call auto-pin check
- `beginTransaction()`: pass sessionId to `rpc.tx.begin()`
- `commitTransaction()` / `rollbackTransaction()`: pass sessionId, handle auto-unpin
- `explainQuery()`: pass sessionId
- Add `pinSession(tabId)` / `unpinSession(tabId)` convenience actions

### Grid store integration

**File:** `src/frontend-shared/stores/grid.ts`

- Add `sessionId: string | null` to `TabGridState`
- Data fetching (`rpc.query.execute` with built SQL): pass sessionId
- Apply changes (`rpc.query.execute` with statements): pass sessionId

### UI elements

- **Pin/unpin button** in `QueryToolbar.tsx` — toggle icon button next to tx mode, shows pin icon when unpinned, filled pin when pinned
- **Session indicator** in `StatusBar.tsx` — shows "Pool" or "Session N" for active tab
- **Session selector dropdown** — when clicking pinned indicator, show dropdown with existing sessions to share, or "New session" option
- **Tab visual indicator** — subtle badge/icon on pinned tabs in `TabBar.tsx`
- **Settings entries** — add `defaultConnectionMode`, `autoPin`, `autoUnpin` to settings dialog

### Default behavior per setting

- `defaultConnectionMode: "pool"` — new tabs use pool, user pins manually
- `defaultConnectionMode: "pinned-per-tab"` — each new tab auto-creates a pinned session on first query
- `defaultConnectionMode: "single-session"` — one session per connection, all tabs share it

## Files

- `src/frontend-shared/stores/session.ts` — new store
- `src/frontend-shared/stores/editor.ts` — add sessionId, pin/unpin actions
- `src/frontend-shared/stores/grid.ts` — add sessionId
- `src/frontend-shared/lib/rpc.ts` — add `onSessionChanged` message listener
- `src/frontend-shared/components/editor/QueryToolbar.tsx` — pin/unpin button
- `src/frontend-shared/components/layout/StatusBar.tsx` — session indicator
- `src/frontend-shared/components/layout/TabBar.tsx` — pinned tab badge (optional)

## Acceptance Criteria

- [ ] Session store tracks tab↔session bindings
- [ ] Pin button creates session via RPC, binds to tab, shows indicator
- [ ] Unpin button destroys session (if last tab), clears binding
- [ ] Editor queries pass sessionId through to RPC
- [ ] Grid data fetching passes sessionId through to RPC
- [ ] Auto-pin detects BEGIN/SET and creates session automatically
- [ ] Auto-unpin destroys session after commit/rollback (when configured)
- [ ] Tab close triggers session cleanup
- [ ] Connection loss clears frontend session state
- [ ] Session sharing between tabs works (console + data view on same session)
- [ ] Status bar shows current session mode (Pool / Session N)
- [ ] Settings control default behavior (pool / pinned-per-tab / single-session)
- [ ] Demo mode works without errors (no-op sessions)
