# Dotaz — Implementation Status

> This file is maintained by the implementing agent to track progress, decisions, and lessons learned.
> Update this file after completing each issue or when encountering important findings.

---

## Overall Progress

| Phase | Name                  | Issues          | Status      | Notes |
|-------|-----------------------|-----------------|-------------|-------|
| 0     | Project Setup         | DOTAZ-001 – 003 | done        |       |
| 1     | Foundation            | DOTAZ-004 – 011 | done        |       |
| 2     | Connection Management | DOTAZ-012 – 016 | done        |       |
| 3     | Data Grid             | DOTAZ-017 – 024 | done        |       |
| 4     | SQL Editor            | DOTAZ-025 – 031 | done        |       |
| 5     | Data Editing          | DOTAZ-032 – 035 | done        |       |
| 6     | Advanced Features     | DOTAZ-036 – 043 | in progress |       |
| 7     | Polish                | DOTAZ-044 – 053 | not started |       |

**Legend**: `not started` · `in progress` · `done` · `blocked`

---

## Issue Map

### Phase 0 — Project Setup
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-001 | Electrobun project initialization for Dotaz | done | |
| DOTAZ-002 | Create shared types | done | |
| DOTAZ-003 | App shell with dark theme and basic layout | done | |

### Phase 1 — Foundation
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-004 | Local app SQLite database with migrations | done | |
| DOTAZ-005 | DatabaseDriver interface + SQLite driver | done | |
| DOTAZ-006 | PostgreSQL driver | done | |
| DOTAZ-007 | ConnectionManager service | done | |
| DOTAZ-008 | Complete RPC schema + wiring | done | |
| DOTAZ-009 | Frontend RPC client (Electroview) | done | |
| DOTAZ-010 | AppShell layout components (sidebar, tabs, status bar) | done | |
| DOTAZ-011 | Tab management store + TabBar | done | |

### Phase 2 — Connection Management
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-012 | Connection store (frontend state) | done | |
| DOTAZ-013 | ConnectionDialog (add/edit form) | done | |
| DOTAZ-014 | File dialog + save dialog RPC handlers | done | Electrobun lacks native save dialog; used directory picker + defaultName workaround |
| DOTAZ-015 | ConnectionTree (sidebar tree) | done | |
| DOTAZ-016 | Context menu for connections | done | |

### Phase 3 — Data Grid
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-017 | getTableData RPC with pagination, sort, filter | done | |
| DOTAZ-018 | Grid store (data grid state) | done | |
| DOTAZ-019 | DataGrid container + GridHeader | done | FK columns loaded via `schema.getForeignKeys` RPC on mount |
| DOTAZ-020 | Virtual scrolling + GridRow + GridCell | done | @tanstack/solid-virtual with 32px row height, 5 overscan; GridCell type-aware rendering; JSON expandable popup |
| DOTAZ-021 | Pagination + total count | done | Pagination component with nav, page size dropdown, row range; added `setPageSize` to grid store |
| DOTAZ-022 | FilterBar (column filtering) | done | Type-aware operators; chips with remove; add filter inline form; Clear All; auto-reload on change |
| DOTAZ-023 | ColumnManager (visibility, sorting, pin) | done | Gear icon trigger; drag & drop reorder; pin cycle (none/left/right); sticky positioning for pinned cells |
| DOTAZ-024 | Clipboard support (Ctrl+C) | done | Ctrl+C copies TSV; single cell via focusedCell; multi-row with headers; Ctrl+A select all; toast feedback |

### Phase 4 — SQL Editor
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-025 | QueryExecutor service with cancellation | done | |
| DOTAZ-026 | SQL console RPC handlers (execute, cancel, format) | done | |
| DOTAZ-027 | Editor store (SQL console state) | done | |
| DOTAZ-028 | SqlEditor with CodeMirror 6 | done | `basicSetup` from codemirror meta-package; dark theme via CSS variables; vertical resize handle between editor and results |
| DOTAZ-029 | QueryToolbar (run/cancel/tx controls) | done | Run/Cancel toggle; Run Selected; Format; Auto/Manual tx mode with Begin/Commit/Rollback; connection name; duration display |
| DOTAZ-030 | SqlResultPanel (query results) | done | Reuses GridHeader, VirtualScroller, GridCell for result grid; multi-result tabs; DML/error display; metadata bar; minimize toggle |
| DOTAZ-031 | SQL autocomplete (schema-aware) | done | `sql()` schema param via Compartment; columns fetched via RPC; defaultSchema for PG |

### Phase 5 — Data Editing
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-032 | Data editing backend (INSERT/UPDATE/DELETE generation) | done | |
| DOTAZ-033 | InlineEditor (cell editing in grid) | done | Editing state in grid store; type-aware InlineEditor; dblclick/F2/Tab/Enter/Escape; Ctrl+Insert new row; Delete selected rows |
| DOTAZ-034 | RowDetailDialog (form view of row detail) | done | Enter on selected row opens; Ctrl+Up/Down for navigation; type-aware inputs; FK display |
| DOTAZ-035 | PendingChanges panel + apply/revert workflow | done | Panel with change list, Apply/Revert All, individual revert, SQL preview; badge in footer toggles panel; createEffect syncs dirty flag for tab close warning |

### Phase 6 — Advanced Features
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-036 | Saved views backend (CRUD) | done | AppDatabase.getSavedViewById made public for uniqueness check on update |
| DOTAZ-037 | SavedViewPicker + SaveViewDialog | done | Active view tracking in grid store; Ctrl+S quick save; dropdown with Default + saved views |
| DOTAZ-038 | FK navigation (follow foreign keys) | done | FK cells underlined with accent color; click navigates within tab; breadcrumb + back; context menu with "Go to referenced row" / "Open target table" |
| DOTAZ-039 | Export service (CSV, JSON, SQL INSERT) | not started | |
| DOTAZ-040 | ExportDialog | not started | |
| DOTAZ-041 | Query history backend + RPC | not started | |
| DOTAZ-042 | QueryHistory component | not started | |
| DOTAZ-043 | SchemaViewer | not started | |

### Phase 7 — Polish
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-044 | CommandPalette | not started | |
| DOTAZ-045 | Keyboard shortcut system | not started | |
| DOTAZ-046 | Context menus (grid, editor, tabs) | not started | |
| DOTAZ-047 | Transaction management UI | not started | |
| DOTAZ-048 | Error handling + toast notifications | not started | |
| DOTAZ-049 | Application menu with all actions | not started | |
| DOTAZ-050 | Reconnect logic + connection resilience | not started | |
| DOTAZ-051 | Settings storage + preferences | not started | |
| DOTAZ-052 | Data refresh (F5) + stale indication | not started | |
| DOTAZ-053 | Visual polish + responsive layout | not started | |

---

## Current Focus

<!-- Update this section when starting work on a new issue -->

**Active issue**: —
**Branch**: —
**Started**: —

---

## Decisions Log

<!-- Record architectural and implementation decisions here.
     Format: date, context, decision, rationale. -->

| Date | Issue | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-02-28 | DOTAZ-002 | Use dot-notation method names in RPC schema (e.g. `connections.list`) | Matches ARCHITECTURE.md naming, keeps schema organized by domain |
| 2026-02-28 | DOTAZ-002 | Import `RPCSchema` from `electrobun/bun` in shared types | Consistent with Electrobun template patterns; type is available from both `electrobun/bun` and `electrobun/browser` |
| 2026-02-28 | DOTAZ-004 | Use `bun:sqlite` Database directly for app storage (not `Bun.SQL`) | App storage uses synchronous `bun:sqlite` API for simplicity; `Bun.SQL` reserved for user database drivers |
| 2026-02-28 | DOTAZ-004 | Lazy import of `electrobun/bun` Utils in `getDefaultDbPath()` | Avoids Electrobun dependency in tests; tests pass custom `:memory:` path |
| 2026-02-28 | DOTAZ-005 | Use `Bun.SQL` (`new SQL("sqlite:path")`) for SQLite driver | Unified API per ARCHITECTURE.md; supports tagged templates and `unsafe()` for raw SQL |
| 2026-02-28 | DOTAZ-005 | Detect `isAutoIncrement` via single INTEGER PRIMARY KEY heuristic | SQLite's `INTEGER PRIMARY KEY` is a ROWID alias; only applies for single-column PKs |
| 2026-02-28 | DOTAZ-006 | Use `reserve()` for transactions in PostgresDriver | Bun.SQL with pooled connections (`max > 1`) rejects raw `BEGIN`/`COMMIT`/`ROLLBACK` via `unsafe()`; `reserve()` pins a single connection |
| 2026-02-28 | DOTAZ-006 | Use `SQL.Query.cancel()` for query cancellation | Bun.SQL's native cancel mechanism; sets `cancelled` flag but may not interrupt PG backend in Bun 1.3.9 |
| 2026-02-28 | DOTAZ-006 | Detect PG `isAutoIncrement` via `nextval(` in `column_default` | SERIAL/BIGSERIAL columns have default `nextval('sequence_name'::regclass)` |
| 2026-02-28 | DOTAZ-007 | Use listener pattern for status change events | Simple callback pattern (`onStatusChanged`) allows RPC handlers (DOTAZ-008) to hook in without coupling ConnectionManager to Electrobun RPC |
| 2026-02-28 | DOTAZ-007 | ConnectionManager takes AppDatabase via constructor injection | Enables testing with in-memory AppDatabase without singletons |
| 2026-02-28 | DOTAZ-008 | Lazy import of `electrobun/bun` in `createRPC()` | Avoids Electrobun dependency in tests; `createHandlers()` is exported separately for direct testing |
| 2026-02-28 | DOTAZ-008 | Extracted `createHandlers()` from `createRPC()` | Allows testing handler logic directly without Electrobun runtime; handlers are thin delegation wrappers |
| 2026-02-28 | DOTAZ-009 | Namespace wrapper over flat RPC methods | `rpc.connections.list()` instead of `rpc.request["connections.list"]({})` — ergonomic API for stores/components |
| 2026-02-28 | DOTAZ-009 | Use `as any` for message listener registration | Electrobun's `addMessageListener` typing uses `RemoteSchema["messages"]` which maps to the webview side's messages (empty); bun-sent messages require cast |
| 2026-02-28 | DOTAZ-011 | Use `crypto.randomUUID()` for tab IDs instead of nanoid | No external dependency needed; UUID is available in both browser and Bun runtimes |
| 2026-02-28 | DOTAZ-011 | Module-level singleton store pattern | Export `tabsStore` object with getters + actions from module scope; Solid.js `createStore` at module level provides app-wide singleton |
| 2026-02-28 | DOTAZ-012 | Schema tree stored per-connection in connections store | `schemaTrees` keyed by connection ID; auto-loaded on `connected` status event from backend |
| 2026-02-28 | DOTAZ-013 | SSL field as boolean checkbox (not dropdown) | `PostgresConnectionConfig.ssl` is `boolean`; dropdown modes (disable/require/prefer) would need type change, kept aligned with existing type |
| 2026-02-28 | DOTAZ-013 | DB type switcher disabled when editing | Prevents type change on existing connections which would invalidate stored config |
| 2026-02-28 | DOTAZ-014 | Use `Utils.openFileDialog` for both open and save dialogs | Electrobun doesn't expose a native save dialog API; save uses directory picker + `defaultName` |
| 2026-02-28 | DOTAZ-014 | Convert `filters[].extensions` to `*.ext` glob format | Electrobun's `allowedFileTypes` expects comma-separated glob patterns like `*.db,*.sqlite` |
| 2026-02-28 | DOTAZ-015 | SQLite single-schema shortcut: skip schema level for "main" | SQLite always has exactly one schema ("main"); showing it adds unnecessary nesting — tables render at level 1 instead of level 2 |
| 2026-02-28 | DOTAZ-015 | ConnectionDialog managed in AppShell, triggered from sidebar "+" and empty state CTA | Centralizes dialog state; both the sidebar header button and empty state CTA use the same callback |
| 2026-02-28 | DOTAZ-016 | Generic ContextMenu component with viewport clamping | Reusable for future context menus (grid, editor, tabs in DOTAZ-046); positioned at click coords with edge detection |
| 2026-02-28 | DOTAZ-016 | Edit connection via context menu delegates to AppShell dialog | `onEditConnection` prop passes through to AppShell's existing ConnectionDialog; keeps dialog state centralized |
| 2026-02-28 | DOTAZ-017 | Extended `data.getRowCount` RPC params with optional `filters` | Acceptance criteria requires count with applied filters; `TableParams` alone is insufficient |
| 2026-02-28 | DOTAZ-017 | SQLite "main" schema skips qualification in generated SQL | `SELECT * FROM "users"` instead of `SELECT * FROM "main"."users"` — matches SQLite conventions |
| 2026-02-28 | DOTAZ-017 | `$N` positional parameters for dynamic SQL | Works with both Bun.SQL PostgreSQL and SQLite via `db.unsafe(sql, params)` |
| 2026-02-28 | DOTAZ-019 | `toggleSort` with `multi` param for single vs multi-column sort | Click = replace sort list (single-sort); Shift+click = add/toggle/remove (multi-sort) |
| 2026-02-28 | DOTAZ-019 | FK columns fetched separately via `schema.getForeignKeys` | `GridColumnDef` doesn't carry FK info; DataGrid loads FKs on mount for header icon display |
| 2026-02-28 | DOTAZ-019 | Div-based grid layout (not `<table>`) | Better suited for upcoming virtual scrolling (DOTAZ-020); column widths via inline styles |
| 2026-02-28 | DOTAZ-020 | `scrollMargin` to offset sticky header in virtualizer | Header height (34px) passed as `scrollMargin` to `createVirtualizer`; virtual items positioned at `start - scrollMargin` within body |
| 2026-02-28 | DOTAZ-020 | Separate `toggleRowInSelection` from `selectRow` | `selectRow` = click (clear + select/deselect); `toggleRowInSelection` = Ctrl+click (toggle without clearing) |
| 2026-02-28 | DOTAZ-020 | JSON expandable popup via absolute-positioned overlay | Click JSON cell to expand; click-outside-to-close pattern; avoids variable row heights in virtual scrolling |
| 2026-02-28 | DOTAZ-023 | Separate `columnOrder` from `columnConfig` in grid store | `columnOrder: string[]` tracks column ordering independently from per-column config (visibility, width, pin) |
| 2026-02-28 | DOTAZ-023 | Pin cycle: none → left → right → none | Single button cycles through pin states; left-pinned columns render first, right-pinned last in visible column list |
| 2026-02-28 | DOTAZ-023 | `computePinStyles` returns sticky CSS as inline styles | Pin styles (position: sticky, left/right offset, z-index, background) applied inline to header cells and GridCells; z-index 3 to layer above normal cells |
| 2026-02-28 | DOTAZ-024 | Event delegation for cell focus via `data-column` attribute | Instead of adding `onCellClick` prop through VirtualScroller→GridRow→GridCell, use `data-column` on GridCell and detect via `closest("[data-column]")` in DataGrid row click handler |
| 2026-02-28 | DOTAZ-024 | `focusedCell` in grid store for single-cell copy | Single row + focused cell → copy cell value; multi-row or no focused cell → copy all visible columns with TSV headers |
| 2026-02-28 | DOTAZ-024 | `createKeyHandler` utility with modifier matching | Reusable key binding dispatcher; treats Ctrl and Meta (Cmd) as equivalent for cross-platform support |
| 2026-02-28 | DOTAZ-025 | `splitStatements` with quote-aware semicolon splitting | Simple char-by-char parser respects single/double quotes; avoids regex pitfalls with quoted semicolons |
| 2026-02-28 | DOTAZ-025 | `QueryExecutor` uses `crypto.randomUUID()` for queryIds | Consistent with tab ID pattern (DOTAZ-011); unique across concurrent queries |
| 2026-02-28 | DOTAZ-025 | Params only passed for single-statement queries | Multi-statement SQL is split and executed without params; params only make sense for a single parameterized statement |
| 2026-02-28 | DOTAZ-025 | `Promise.race` for timeout implementation | Clean timeout via race between driver.execute and setTimeout rejection; no AbortController needed at executor level |
| 2026-02-28 | DOTAZ-026 | Frontend-generated `queryId` passed to `executeQuery` | Frontend knows the queryId before calling execute, enabling cancellation via `query.cancel({ queryId })` while execute is in-flight |
| 2026-02-28 | DOTAZ-026 | RPC `query.execute` returns `QueryResult[]` (not single) | Multi-statement SQL returns array of results; matches `QueryExecutor.executeQuery` return type |
| 2026-02-28 | DOTAZ-026 | Simple tokenizer-based SQL formatter | Keyword uppercasing + clause-level line breaks; respects quoted strings and parenthesized subqueries; no external dependency |
| 2026-02-28 | DOTAZ-027 | Fixed RPC client `query.execute` and `query.cancel` signatures | Added missing `queryId` param to execute; changed cancel to use `queryId` not `connectionId`; fixed return type to `QueryResult[]` |
| 2026-02-28 | DOTAZ-027 | Frontend-generated `queryId` via `crypto.randomUUID()` in editor store | Consistent with tab ID pattern; enables cancellation while execute is in-flight |
| 2026-02-28 | DOTAZ-028 | `basicSetup` from `codemirror` meta-package instead of individual extensions | Provides line numbers, bracket matching, bracket closing, active line highlight, fold gutter, search, undo history in one import |
| 2026-02-28 | DOTAZ-028 | Dark theme via `EditorView.theme()` with CSS variables | References app's CSS custom properties for consistent dark theme without separate color definitions |
| 2026-02-28 | DOTAZ-028 | `createEffect` for bidirectional content sync | Editor → store via `updateListener`; store → editor (e.g. format) via `createEffect` comparing content strings to avoid infinite loops |
| 2026-02-28 | DOTAZ-028 | Dialect selection from connection type | Looks up connection in `connectionsStore` to select `PostgreSQL` or `SQLite` dialect for syntax highlighting |
| 2026-02-28 | DOTAZ-029 | `selectedText` tracked in editor store via `selectionSet` update | CodeMirror `updateListener` pushes selection into store; toolbar reads it reactively for "Run Selected" enable state |
| 2026-02-28 | DOTAZ-029 | QueryToolbar placed in AppShell above SqlEditor | Toolbar is a sibling of SqlEditor inside `sql-console` div; both receive `tabId` + `connectionId` props |
| 2026-02-28 | DOTAZ-029 | Segmented toggle for Auto/Manual transaction mode | Two-button toggle group instead of dropdown; visual indicator (TXN badge) when transaction is open |
| 2026-02-28 | DOTAZ-030 | Reuse GridHeader, VirtualScroller, GridCell for result display | Existing grid components accept simplified props (empty sort, pinStyles, selectedRows); avoids duplicating grid rendering logic |
| 2026-02-28 | DOTAZ-030 | Column resize via signal-based `columnWidths` in ResultGrid | `createSignal<Record<string, number>>` converted to `ColumnConfig` for GridHeader/VirtualScroller; simpler than store for local component state |
| 2026-02-28 | DOTAZ-030 | Metadata in header bar (not separate footer) | Rows, columns, duration displayed in header-right alongside minimize toggle; compact layout |
| 2026-02-28 | DOTAZ-031 | Use `@codemirror/lang-sql` `schema` param for completions | Built-in `sql()` config handles table/column/schema completions context-dependently; no custom completion source needed |
| 2026-02-28 | DOTAZ-031 | `Compartment` for dynamic SQL language reconfiguration | Allows updating schema completions at runtime when schema tree changes without recreating the editor |
| 2026-02-28 | DOTAZ-031 | Parallel column fetching with version guard | All table columns fetched via `Promise.all` for speed; version counter prevents stale results from overwriting newer ones |
| 2026-02-28 | DOTAZ-032 | SQL generation in query-executor.ts alongside existing query builders | Keeps all SQL building logic in one module; `generateInsert/Update/Delete` + `generateChangeSql` for parameterized execution, `generateChangePreview/generateChangesPreview` for readable SQL with inlined values |
| 2026-02-28 | DOTAZ-032 | Transaction wrapping in RPC handler, not in SQL generation | `data.applyChanges` handler calls `beginTransaction/commit/rollback` on the driver; SQL generators are pure functions returning `{ sql, params }` |
| 2026-02-28 | DOTAZ-033 | PendingChanges in grid store with cellEdits/newRows/deletedRows | Separate tracking enables per-cell change indicators, new row highlighting, and row deletion strikethrough; `buildDataChanges()` converts to `DataChange[]` for backend |
| 2026-02-28 | DOTAZ-033 | InlineEditor as separate component rendered by GridCell | Keeps GridCell simple; InlineEditor handles type-aware inputs (text/textarea/number/checkbox/date); mounted inside the cell position for seamless UX |
| 2026-02-28 | DOTAZ-033 | Editing props flow through VirtualScroller → GridRow → GridCell | Each layer passes editing state down; avoids store access in leaf components; consistent with existing prop-drilling pattern |
| 2026-02-28 | DOTAZ-034 | Local form state in RowDetailDialog, saved to pendingChanges on Save | Local `Record<string, unknown>` tracks edits per session; only writes to grid store on Save; Cancel discards without side effects |
| 2026-02-28 | DOTAZ-034 | Navigation auto-saves current edits before moving | Previous/Next buttons save local edits to pendingChanges before switching rows; prevents accidental data loss |
| 2026-02-28 | DOTAZ-034 | Ctrl+Up/Down for row navigation in dialog | Alt or Ctrl + arrow keys for navigation; avoids conflict with normal text input arrow key behavior |
| 2026-02-28 | DOTAZ-035 | `createEffect` syncs `hasPendingChanges` → `setTabDirty` | Reuses existing tab dirty/close-warning infrastructure; auto-hides panel when changes are cleared |
| 2026-02-28 | DOTAZ-035 | Individual revert adjusts row indices after removal | Removing a new row shifts all higher indices down; `adjustIndicesAfterRemoval` updates cellEdits, newRows, deletedRows consistently |
| 2026-02-28 | DOTAZ-035 | `pendingChangesCount` groups cell edits by row | Multiple cell edits on the same row count as one UPDATE change; matches `buildDataChanges` grouping logic |
| 2026-02-28 | DOTAZ-036 | `createHandlers` accepts optional `AppDatabase` param | Views handlers need direct app-db access; passed through from `createRPC` and `index.ts` |
| 2026-02-28 | DOTAZ-036 | Name uniqueness validated at handler level, not DB constraint | Provides clear error messages; checks on both save and update (excluding self on update) |
| 2026-02-28 | DOTAZ-036 | `getSavedViewById` made public on `AppDatabase` | Needed by views.update handler to look up existing view's connection/schema/table for uniqueness check |
| 2026-02-28 | DOTAZ-037 | Active view state (`activeViewId`/`activeViewName`) in grid store | Needed by both SavedViewPicker (display) and DataGrid Ctrl+S handler (quick save vs open dialog) |
| 2026-02-28 | DOTAZ-037 | `applyViewConfig` preserves existing pin state | `SavedViewConfig` doesn't include pinned column info; pinning is orthogonal to view configuration |
| 2026-02-28 | DOTAZ-037 | Ctrl+S quick save updates in-place if view active, opens dialog otherwise | Matches common "save" UX: known target = silent save, unknown = Save As dialog |
| 2026-02-28 | DOTAZ-038 | FK navigation within same tab, not new tab | Breadcrumb/history requires within-tab navigation; "Open target table" context menu opens new tab |
| 2026-02-28 | DOTAZ-038 | `fkNavigationHistory` stack in `TabGridState` | Stores schema, table, filters, sort, columnConfig, columnOrder for each navigation step; back pops and restores |
| 2026-02-28 | DOTAZ-038 | `buildFkMap` filters to single-column FKs only | Composite FKs can't be meaningfully navigated by clicking a single cell value |
| 2026-02-28 | DOTAZ-038 | FK click via `stopPropagation` on inner `<span>` | FK link span inside GridCell stops propagation to prevent row selection; clicking cell padding still selects |
| 2026-02-28 | DOTAZ-038 | `createEffect` for reactive FK loading on table change | FKs reload when `tab().schema/table` changes (FK navigation); initial load in `onMount` |
| 2026-02-28 | DOTAZ-038 | Context menu uses `focusedCell` for row index | Right-click sets focused cell first (via existing click handler); context menu reads row from focused cell |

---

## Lessons Learned

<!-- Capture insights, gotchas, and patterns discovered during implementation.
     These help avoid repeating mistakes and accelerate future work. -->

### Electrobun / Bun
<!-- Runtime quirks, RPC patterns, build issues, etc. -->
- Webview RPC: `Electroview.defineRPC<Schema>()` returns an rpc object; must call `new Electroview({ rpc })` to set up the transport
- `rpc.request["method.name"](params)` is properly typed for bun-side requests from the webview
- `rpc.addMessageListener` on webview side types against `Schema["webview"]["messages"]` (not bun messages) — use `as any` for bun-sent messages like `connections.statusChanged`

### Solid.js / Frontend
<!-- Reactivity pitfalls, store patterns, component patterns, etc. -->

### Database Drivers
<!-- Bun.SQL behavior, PostgreSQL vs SQLite differences, query building, etc. -->
- `Bun.SQL` SQLite URL format: `sqlite::memory:` for in-memory, `sqlite:/path/to/file.db` for file
- `db.unsafe(sql, params)` returns array-like result; use `[...result]` to spread into plain array
- `result.count` gives affected rows for DML, row count for SELECT
- No `.columns` property on Bun.SQL results — infer column names from `Object.keys(rows[0])`
- Both `?` and `$1` param styles work for SQLite via Bun.SQL
- PRAGMA queries accept double-quoted identifiers: `PRAGMA table_info("tablename")`
- `PRAGMA foreign_keys = ON` must be set per connection (not persistent in SQLite)
- Bun.SQL PostgreSQL connection pool rejects raw `BEGIN`/`COMMIT`/`ROLLBACK` via `unsafe()` — use `db.reserve()` for transaction-pinned connections
- `SQL.Query.cancel()` sets `cancelled: true` but the promise may not resolve/reject in Bun 1.3.9 — PG backend process not actually interrupted
- PG `information_schema.columns` returns `data_type` as `'ARRAY'` for array types and `'USER-DEFINED'` for custom types (jsonb, etc.) — map using `udt_name`
- PG `array_agg()` results from Bun.SQL may be returned as native JS arrays or `{a,b,c}` strings — handle both

### Testing & Debugging
<!-- What works, what doesn't, useful debugging techniques, etc. -->

### General
<!-- Anything else worth remembering. -->

---

## Blockers & Open Questions

<!-- Track things that are blocking progress or need clarification. -->

| Issue | Blocker / Question | Status | Resolution |
|-------|--------------------|--------|------------|
| | | | |

---

## Agent Notes

<!-- Free-form scratchpad for the implementing agent.
     Use this for temporary context, in-progress thoughts, or anything
     that doesn't fit the sections above. Clean up periodically. -->

---

*Last updated: 2026-02-28 (DOTAZ-038)*
