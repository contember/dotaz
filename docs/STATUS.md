# Dotaz — Implementation Status

## Completed Phases (v1)

All initial implementation phases (DOTAZ-001 through DOTAZ-053) are complete.

| Phase | Name                  | Issues          | Summary |
|-------|-----------------------|-----------------|---------|
| 0     | Project Setup         | DOTAZ-001 – 003 | Electrobun init, shared types, app shell with dark theme |
| 1     | Foundation            | DOTAZ-004 – 011 | App SQLite DB, database drivers (SQLite + PostgreSQL), ConnectionManager, RPC schema, frontend RPC client, layout components, tab management |
| 2     | Connection Management | DOTAZ-012 – 016 | Connection store, connection dialog, file/save dialogs, connection tree, context menus |
| 3     | Data Grid             | DOTAZ-017 – 024 | Table data RPC with pagination/sort/filter, grid store, virtual scrolling, pagination, filter bar, column manager, clipboard |
| 4     | SQL Editor            | DOTAZ-025 – 031 | Query executor with cancellation, SQL console RPC, editor store, CodeMirror 6 editor, query toolbar, result panel, schema-aware autocomplete |
| 5     | Data Editing          | DOTAZ-032 – 035 | INSERT/UPDATE/DELETE generation, inline cell editing, row detail dialog, pending changes panel |
| 6     | Advanced Features     | DOTAZ-036 – 043 | Saved views, FK navigation, export (CSV/JSON/SQL), query history, schema viewer |
| 7     | Polish                | DOTAZ-044 – 053 | Command palette, keyboard shortcuts, context menus, transaction management, error handling/toasts, application menu, reconnect logic, settings, data refresh, visual polish |

---

## Phase 8 — PRD Gaps

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-054 | SSL mode for PostgreSQL connections | done | SSLMode type, dropdown UI, driver sslmode param, migration v2 |
| DOTAZ-055 | Quick full-text search in data grid | done | Server-side CAST(col AS TEXT) ILIKE/LIKE across all columns, debounced 300ms input, AND with column filters |
| DOTAZ-056 | Run current SQL statement at cursor position | done | getStatementAtCursor returns range, CodeMirror flash highlight, Ctrl+Shift+Enter shortcut, toolbar button |
| DOTAZ-057 | SQL error position highlighting | done | ErrorPosition type, PG position + SQLite offset parsing, result panel display, CodeMirror underline decoration |
| DOTAZ-058 | Reverse FK — display referencing records in row detail | done | ReferencingForeignKeyInfo type, driver implementations (PG/SQLite/MySQL/WASM), RPC endpoint, Referenced By section in RowDetailDialog with counts and navigation |
| DOTAZ-059 | CSV export encoding configuration | done | CsvEncoding type, encoding dropdown + BOM toggle in ExportDialog, backend encoder for UTF-8/ISO-8859-1/Windows-1252 |
| DOTAZ-060 | Query history time range filtering | done | Date range inputs (from/to), preset quick filters (Today/7d/30d), AND with existing filters |
| DOTAZ-061 | Encrypt connection passwords in local storage | done | AES-256-GCM with machine-derived key (HKDF from hostname+username), transparent migration, plaintext fallback |

---

## Phase 8.5 — Tech Debt

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-080 | Fix type safety at RPC boundary | done | Typed RPC handler params, driver introspection rows, result counts, transport layer |
| DOTAZ-081 | Extract duplicated frontend utilities | done | column-types.ts, tab-store-helpers.ts, requireAppDb() |
| DOTAZ-082 | Standardize error handling with domain error types | not started | Error hierarchy with codes, consistent handling across layers |
| DOTAZ-083 | Driver-aware query placeholder generation | not started | Fix fragile MySQL `$N` → `?` regex conversion |
| DOTAZ-084 | Improve shared domain model type safety | not started | DataChange discriminated union, DatabaseDataType enum |
| DOTAZ-085 | AppDatabase transaction wrapping and storage improvements | not started | Atomic restores, history pruning, typed settings, pool limits |
| DOTAZ-086 | Frontend architecture cleanup | not started | Centralize layout constants, fix command registry leak, IndexedDB error handling |

---

## Phase 9 — Backlog Tier 1 (Quick Wins)

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-062 | Aggregate view for cell selection | not started | SUM, COUNT, AVG, MIN, MAX over selected cells |
| DOTAZ-063 | Quick value shortcuts during cell editing | not started | n→NULL, t→true, f→false, d→DEFAULT |
| DOTAZ-064 | Warning for DELETE/UPDATE without WHERE clause | not started | Confirmation dialog for destructive SQL |
| DOTAZ-065 | Read-only mode per connection | not started | Disable editing, warn on DML |
| DOTAZ-066 | Transpose view for data grid | not started | Rows↔columns for wide tables |

---

## Phase 10 — Backlog Tier 2 (Medium Effort)

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-067 | EXPLAIN plan visualization | not started | Tree view of execution plan |
| DOTAZ-068 | Data import (CSV/JSON into table) | not started | Counterpart to export |
| DOTAZ-069 | Value editor side panel | not started | JSON/text/binary editor panel |
| DOTAZ-070 | Additional export formats (Markdown, SQL UPDATE, HTML) | not started | Extend existing export |
| DOTAZ-071 | Data comparison (side-by-side diff) | not started | Compare tables/query results |

---

## Phase 11 — Backlog Tier 3 (Nice-to-have)

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-072 | JOIN autocompletion with FK awareness | not started | Auto-complete JOIN ON from FK |
| DOTAZ-073 | Pin result tabs in SQL console | not started | Preserve results across queries |
| DOTAZ-074 | SQL query bookmarks | not started | Save favorite queries |
| DOTAZ-075 | Full-text search across database tables | not started | Search text in all tables |
| DOTAZ-076 | Grid heatmaps for numeric columns | not started | Color scales for data visualization |
| DOTAZ-077 | Multiple cursors in SQL editor | not started | Multi-cursor via CodeMirror |
| DOTAZ-078 | Connection color coding | not started | Color connections by environment |
| DOTAZ-079 | Editable query results | not started | Edit cells in SELECT results |

---

## Phase 12 — DBeaver Parity

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-087 | SSH tunnel for PostgreSQL connections | not started | SSH port forwarding via bastion host |
| DOTAZ-088 | Navigator search/filter in connection tree | not started | Filter tables/views by name |
| DOTAZ-089 | Advanced Copy with configurable format | not started | Ctrl+Shift+C — delimiter, headers, format |
| DOTAZ-090 | Transaction log and pending transaction viewer | not started | Session statement log + uncommitted TX warning |
| DOTAZ-091 | Query navigation in SQL editor | not started | Alt+Up/Down between SQL statements |
| DOTAZ-092 | Data format profiles | not started | Global date/number/NULL display settings |
| DOTAZ-093 | Advanced Paste into data grid | not started | Multi-row paste with delimiter detection |
| DOTAZ-094 | AI SQL generation from natural language | not started | LLM-powered SQL with schema context |
| DOTAZ-095 | Workspace persistence (tabs, editor state, layout) | not started | Restore open tabs, SQL content, layout after restart |

---

*Last updated: 2026-03-01 — DOTAZ-081 done*

