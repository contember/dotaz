# DOTAZ-095: Workspace persistence (tabs, editor state, layout)

**Phase**: 12 — DBeaver Parity
**Type**: fullstack
**Dependencies**: []

## Description

Persist and restore the user's workspace across application restarts. Currently all session state (open tabs, SQL editor content, grid position, sidebar layout) is lost on every restart — the user must manually reopen connections, navigate to tables, and rewrite queries each time.

### What to Persist

**Tabs (critical)**
- List of open tabs with their type (table, query, schema)
- Tab order and which tab is active
- Per-tab metadata: connection ID, schema, table/database
- Dirty flag awareness — warn or auto-save unsaved changes

**SQL Editor State (critical)**
- Editor content per query tab (the SQL text)
- Cursor position and selection
- Transaction mode setting (auto-commit vs manual) per tab

**Grid State (nice-to-have, lower priority)**
- Current page / scroll position per table tab
- Active sort and filter (if not already bound to a saved view)
- Column widths and order

**Layout (nice-to-have)**
- Sidebar width and collapsed state
- Active connection in sidebar

### Storage

- **Desktop mode**: Store in app SQLite database (`dotaz.db`) — new `workspace` table. Backend owns persistence, frontend calls RPC to save/load.
- **Stateless/web mode**: Store **only in IndexedDB** in the user's browser. Workspace is per-user/per-browser — the server is shared and stateless, so workspace state must NOT go through `storage.restore()` or touch the backend at all. Frontend reads/writes IndexedDB directly on init and on change.
- **Demo mode**: No persistence needed (ephemeral by design)

### Restore Flow

1. On app startup, after connections load, read persisted workspace
2. Reopen tabs in saved order, set active tab
3. Restore editor content for query tabs
4. For table tabs, trigger data fetch with persisted sort/filter/page
5. Restore layout (sidebar width)
6. Handle stale references gracefully — if a persisted tab references a deleted connection or dropped table, show an error state in the tab rather than crashing

### Multi-Tab Behavior (Web Mode)

In desktop mode only one window exists, so no conflict. In web mode the user may open the app in multiple browser tabs.

**Decision: last-write-wins.** Each browser tab saves its workspace independently to IndexedDB. Whichever tab writes last (on close or on change) determines the restored state on next load. No cross-tab sync via BroadcastChannel or leader election — the complexity is not worth it for v1. Users typically work in a single tab; if they use multiple, each operates as an independent session.

### Edge Cases

- Connection no longer exists → show disconnected tab, let user close or reconnect
- Table/schema was dropped → show error in tab, allow close
- Large editor content → cap at reasonable size (e.g. 1 MB per tab)

## Files

- `src/backend-shared/storage/app-db.ts` — workspace table schema, save/load operations
- `src/shared/types/rpc.ts` — `workspace.save`, `workspace.load` RPC endpoints
- `src/shared/types/workspace.ts` — WorkspaceState, TabState, EditorState types
- `src/frontend-shared/stores/tabs.ts` — persist on tab open/close/reorder, restore on init
- `src/frontend-shared/stores/editor.ts` — persist editor content on change (debounced)
- `src/frontend-shared/stores/grid.ts` — persist grid state (sort, filter, page)
- `src/frontend-shared/components/layout/AppShell.tsx` — restore workspace in `onMount()`
- `src/frontend-shared/lib/browser-storage.ts` — IndexedDB workspace store (stateless mode)

## Acceptance Criteria

- [ ] Open tabs restored after app restart (type, connection, schema, table)
- [ ] Active tab restored
- [ ] SQL editor content restored for query tabs
- [ ] Tab order preserved
- [ ] Stale tab references (deleted connection/table) handled gracefully
- [ ] Workspace saved automatically (debounced, not on every keystroke)
- [ ] Works in desktop mode (SQLite storage)
- [ ] Works in stateless/web mode (IndexedDB only, no backend involvement)
- [ ] Sidebar layout (width, collapsed) restored
- [ ] No noticeable startup delay from workspace restore
