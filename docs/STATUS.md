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
| 3     | Data Grid             | DOTAZ-017 – 024 | not started |       |
| 4     | SQL Editor            | DOTAZ-025 – 031 | not started |       |
| 5     | Data Editing          | DOTAZ-032 – 035 | not started |       |
| 6     | Advanced Features     | DOTAZ-036 – 043 | not started |       |
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
| DOTAZ-017 | getTableData RPC with pagination, sort, filter | not started | |
| DOTAZ-018 | Grid store (data grid state) | not started | |
| DOTAZ-019 | DataGrid container + GridHeader | not started | |
| DOTAZ-020 | Virtual scrolling + GridRow + GridCell | not started | |
| DOTAZ-021 | Pagination + total count | not started | |
| DOTAZ-022 | FilterBar (column filtering) | not started | |
| DOTAZ-023 | ColumnManager (visibility, sorting, pin) | not started | |
| DOTAZ-024 | Clipboard support (Ctrl+C) | not started | |

### Phase 4 — SQL Editor
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-025 | QueryExecutor service with cancellation | not started | |
| DOTAZ-026 | SQL console RPC handlers (execute, cancel, format) | not started | |
| DOTAZ-027 | Editor store (SQL console state) | not started | |
| DOTAZ-028 | SqlEditor with CodeMirror 6 | not started | |
| DOTAZ-029 | QueryToolbar (run/cancel/tx controls) | not started | |
| DOTAZ-030 | SqlResultPanel (query results) | not started | |
| DOTAZ-031 | SQL autocomplete (schema-aware) | not started | |

### Phase 5 — Data Editing
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-032 | Data editing backend (INSERT/UPDATE/DELETE generation) | not started | |
| DOTAZ-033 | InlineEditor (cell editing in grid) | not started | |
| DOTAZ-034 | RowDetailDialog (form view of row detail) | not started | |
| DOTAZ-035 | PendingChanges panel + apply/revert workflow | not started | |

### Phase 6 — Advanced Features
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-036 | Saved views backend (CRUD) | not started | |
| DOTAZ-037 | SavedViewPicker + SaveViewDialog | not started | |
| DOTAZ-038 | FK navigation (follow foreign keys) | not started | |
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

*Last updated: 2026-02-28 (DOTAZ-016)*
