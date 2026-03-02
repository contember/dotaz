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
| DOTAZ-082 | Standardize error handling with domain error types | done | DatabaseError hierarchy with codes, driver error mapping, RPC errorCode propagation, frontend friendlyErrorMessage using codes, silent catches → console.debug |
| DOTAZ-083 | Driver-aware query placeholder generation | done | `placeholder()` on SqlDialect/DatabaseDriver, builders use it, MySQL regex removed |
| DOTAZ-084 | Improve shared domain model type safety | done | DataChange discriminated union (InsertChange/UpdateChange/DeleteChange), DatabaseDataType enum with driver mappings, SavedViewConfig reuses SortColumn/ColumnFilter, centralized column-types.ts |
| DOTAZ-085 | AppDatabase transaction wrapping and storage improvements | done | transaction() method, migratePasswords wrapped, auto history pruning, getNumberSetting/getBooleanSetting, maxActiveDatabases pool limit |
| DOTAZ-086 | Frontend architecture cleanup | done | layout-constants.ts, commandRegistry.clear() on cleanup, storage write failures → warning toasts |

---

## Phase 9 — Backlog Tier 1 (Quick Wins)

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-062 | Aggregate view for cell selection | done | SUM, COUNT, AVG, MIN, MAX over selected cells; panel shows when 2+ rows selected |
| DOTAZ-063 | Quick value shortcuts during cell editing | done | SQL_DEFAULT sentinel, Ctrl+N/T/F/D shortcuts, single-key when empty for non-text columns |
| DOTAZ-064 | Warning for DELETE/UPDATE without WHERE clause | done | detectDestructiveWithoutWhere() strips literals/comments, editor store intercepts execution, DestructiveQueryDialog with session suppress |
| DOTAZ-065 | Read-only mode per connection | done | readOnly on ConnectionInfo, migration v3, grid/editor guards, lock icon, status bar badge, runtime toggle |
| DOTAZ-066 | Transpose view for data grid | done | TransposedGrid component, toolbar toggle, Ctrl+Shift+T shortcut, inline editing support |

---

## Phase 10 — Backlog Tier 2 (Medium Effort)

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-067 | EXPLAIN plan visualization | done | ExplainNode tree type, PG JSON + SQLite EXPLAIN QUERY PLAN parsing, query.explain RPC, ExplainPanel with tree/raw toggle, Ctrl+E/Ctrl+Shift+E shortcuts, cost-colored nodes |
| DOTAZ-068 | Data import (CSV/JSON into table) | done | ImportService (CSV/JSON parsing, batched INSERT), import.preview + import.importData RPC, ImportDialog with file picker, column mapping, preview, transaction rollback, context menu + toolbar integration |
| DOTAZ-069 | Value editor side panel | done | ValueEditorPanel with JSON formatting, word-wrap, resizable, Ctrl+Shift+E toggle |
| DOTAZ-070 | Additional export formats (Markdown, SQL UPDATE, HTML) | done | Markdown/SQL UPDATE/HTML/XML formatters in export-service, ExportFormat type extended, ExportDialog updated with all formats |
| DOTAZ-071 | Data comparison (side-by-side diff) | done | ComparisonDialog (source selection, key columns, column mapping), ComparisonView (side-by-side diff grid, status filter, color-coded rows), comparison-service with auto column mapping, cross-connection support |

---

## Phase 11 — Backlog Tier 3 (Nice-to-have)

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| DOTAZ-072 | JOIN autocompletion with FK awareness | done | Custom CompletionSource: parses FROM/JOIN tables, looks up FK data, suggests tables with ON clause; supports all JOIN types, aliases, multi-FK |
| DOTAZ-073 | Pin result tabs in SQL console | done | PinnedResultSet type, pin/unpin/setActiveResultView actions, pinned tab UI with pin icon and close button, visual distinction via accent color |
| DOTAZ-074 | SQL query bookmarks | done | QueryBookmark type, migration v4, bookmarks.* RPC endpoints, BookmarksDialog with search/create/edit/delete, Ctrl+D shortcut, toolbar button, context menu entry |
| DOTAZ-075 | Full-text search across database tables | done | SearchService with sequential LIKE queries, DatabaseSearchDialog with scope selection, grouped results, click-to-navigate with quickSearch, command palette + context menu |
| DOTAZ-076 | Grid heatmaps for numeric columns | done | HeatmapMode type (sequential/diverging), heatmapColumns in grid store, computeHeatmapStats/computeHeatmapColor, column header context menu entries, works in normal + transposed view |
| DOTAZ-077 | Multiple cursors in SQL editor | done | Alt+Click adds cursor, Ctrl+D selectNextOccurrence via searchKeymap, keyboard manager defaultPrevented guard |
| DOTAZ-078 | Connection color coding | done | 10-color palette in ConnectionDialog, colored left border in tree, 3px colored top border in status bar, migration v5 adds color column, tests for persistence |
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

*Last updated: 2026-03-02 — DOTAZ-078 done*

