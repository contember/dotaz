# Dotaz — Implementation Status

> This file is maintained by the implementing agent to track progress, decisions, and lessons learned.
> Update this file after completing each issue or when encountering important findings.

---

## Overall Progress

| Phase | Name                  | Issues          | Status      | Notes |
|-------|-----------------------|-----------------|-------------|-------|
| 0     | Project Setup         | DOTAZ-001 – 003 | done        |       |
| 1     | Foundation            | DOTAZ-004 – 011 | in progress |       |
| 2     | Connection Management | DOTAZ-012 – 016 | not started |       |
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
| DOTAZ-008 | Complete RPC schema + wiring | not started | |
| DOTAZ-009 | Frontend RPC client (Electroview) | not started | |
| DOTAZ-010 | AppShell layout components (sidebar, tabs, status bar) | not started | |
| DOTAZ-011 | Tab management store + TabBar | not started | |

### Phase 2 — Connection Management
| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-012 | Connection store (frontend state) | not started | |
| DOTAZ-013 | ConnectionDialog (add/edit form) | not started | |
| DOTAZ-014 | File dialog + save dialog RPC handlers | not started | |
| DOTAZ-015 | ConnectionTree (sidebar tree) | not started | |
| DOTAZ-016 | Context menu for connections | not started | |

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

---

## Lessons Learned

<!-- Capture insights, gotchas, and patterns discovered during implementation.
     These help avoid repeating mistakes and accelerate future work. -->

### Electrobun / Bun
<!-- Runtime quirks, RPC patterns, build issues, etc. -->

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

*Last updated: 2026-02-28 (DOTAZ-007)*
