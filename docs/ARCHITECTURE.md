# Dotaz — Architecture

## Overview

Dotaz is a desktop database client built on **Electrobun** (Bun backend + system webview) with a **Solid.js** frontend. It supports PostgreSQL and SQLite, focused on DML operations (viewing, editing, querying data) — no DDL/schema management.

Runs in three modes:

- **Desktop** (Electrobun) — native window with RPC transport, app state in backend SQLite
- **Web** — standalone Bun HTTP/WebSocket server, app state in browser IndexedDB
- **Demo** — browser-only with WASM SQLite, no server needed

---

## Technology Decisions

| Area              | Technology                              | Rationale                                                                                                                                  |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime           | Bun                                     | Native SQLite support, built-in SQL driver, fast startup                                                                                   |
| Desktop framework | Electrobun                              | Bun backend + system webview, low memory footprint                                                                                         |
| Frontend          | Solid.js + Vite                         | Fine-grained reactivity, fast HMR                                                                                                          |
| DB driver         | `Bun.SQL` (`import { SQL } from "bun"`) | Unified API for PostgreSQL and SQLite, tagged template literals, connection pooling, transactions, cancellation. No external dependencies. |
| App state storage | `bun:sqlite`                            | Local SQLite for connections, history, settings, saved views. Stored in `Utils.paths.userData/dotaz.db`                                    |
| Data grid         | `@tanstack/solid-virtual`               | Virtual scrolling for large datasets, Solid.js integration                                                                                 |
| SQL editor        | CodeMirror 6 + `@codemirror/lang-sql`   | Modular, extensible, schema-aware autocomplete                                                                                             |
| Communication     | Pluggable transport                     | Electrobun RPC (desktop), WebSocket (web), inline calls (demo)                                                                             |

---

## Directory Structure

```
dotaz/
  electrobun.config.ts          # Electrobun build configuration
  vite.config.ts                # Vite configuration for frontend
  tsconfig.json                 # TypeScript configuration
  package.json                  # Dependencies and scripts
  PRD.md                        # Product Requirements Document
  docs/
    ARCHITECTURE.md             # This document
    issues/                     # Issue files
  src/
    shared/                     # Pure types + browser-safe utilities (no backend concepts)
      types/
        rpc.ts                  # RPC schema definition (request/response types)
        connection.ts           # Connection types (PG, SQLite configuration)
        database.ts             # Database metadata types (schema, tables, columns)
        grid.ts                 # Grid types (pagination, sort, filter)
        query.ts                # Query types (execute, result, history)
        tab.ts                  # Tab types (data grid, SQL console, schema viewer)
        export.ts               # Export types (CSV, JSON, SQL formats)
    backend-shared/             # Backend logic: drivers, services, storage, RPC handlers
      db/
        driver.ts               # DatabaseDriver interface (abstraction)
      drivers/
        postgres-driver.ts      # PostgreSQL implementation (Bun.SQL)
        sqlite-driver.ts        # SQLite implementation (Bun.SQL)
        mysql-driver.ts         # MySQL implementation
      services/
        connection-manager.ts   # Connection management (connect/disconnect/pool)
        query-executor.ts       # Running queries with cancellation
        export-service.ts       # Data export (CSV, JSON, SQL INSERT)
        transaction-manager.ts  # Transaction management (begin/commit/rollback)
        encryption.ts           # Password encryption for stored connections
      storage/
        app-db.ts               # Local SQLite for app data
        migrations.ts           # Schema migrations for app DB
      rpc/
        rpc-handlers.ts         # RPC handler implementation
        adapter.ts              # RPC adapter
        backend-adapter.ts      # Backend RPC adapter
        handlers.ts             # Handler definitions
    backend-types/              # Type-only re-exports for frontend (import type from backend-shared)
    backend-desktop/            # Electrobun backend entry point
      index.ts                  # Entry point: window, menu, RPC setup
    backend-web/                # HTTP/WebSocket server entry point
      server.ts                 # Bun.serve() with WebSocket RPC
    frontend-shared/            # Solid.js UI: components, stores, lib
      App.tsx                   # Root component
      styles/global.css         # Global styles, dark theme, CSS variables
      lib/
        rpc.ts                  # Frontend RPC client
        keyboard.ts             # Keyboard shortcut system
        commands.ts             # Command registry for command palette
        transport/              # Transport abstraction (lazy proxy)
          index.ts              # setTransport() + getTransport()
          types.ts              # RpcTransport interface
        storage/                # App state storage abstraction
          index.ts              # setStorage() + getStorage()
          indexeddb.ts           # IndexedDB implementation (web mode)
          rpc.ts                # RPC-backed implementation (desktop mode)
      stores/
        connections.ts          # Connection store (list, state, active)
        tabs.ts                 # Tab store (open tabs, active tab)
        grid.ts                 # Grid store (data, pagination, sort, filter, selection)
        editor.ts               # Editor store (SQL content, results, tx state)
        ui.ts                   # UI store (sidebar width, dialogs, toasts)
      components/
        layout/
          AppShell.tsx          # Main layout (sidebar + content + status bar)
          Sidebar.tsx           # Left panel with connections tree
          TabBar.tsx            # Tab bar above main panel
          StatusBar.tsx         # Bottom status bar
          Resizer.tsx           # Resize handle for sidebar/panels
        connection/
          ConnectionDialog.tsx  # Form for add/edit connection
          ConnectionTree.tsx    # Tree structure of connections
          ConnectionTreeItem.tsx # Individual tree item
        grid/
          DataGrid.tsx          # Data grid container
          GridHeader.tsx        # Header with sorting and column resizing
          GridRow.tsx           # Grid row
          GridCell.tsx          # Grid cell (render by type)
          VirtualScroller.tsx   # Virtual scrolling wrapper
          FilterBar.tsx         # Panel for column filtering
          ColumnManager.tsx     # Column visibility and order management
          Pagination.tsx        # Pagination + total count
        editor/
          SqlEditor.tsx         # CodeMirror 6 SQL editor
          SqlResultPanel.tsx    # Panel with query results
          QueryToolbar.tsx      # Toolbar (run, cancel, tx controls)
        schema/
          SchemaViewer.tsx      # Read-only view of table structure
          ColumnList.tsx        # List of columns with types and constraints
          IndexList.tsx         # List of indexes
        edit/
          InlineEditor.tsx      # Cell editing in grid
          RowDetailDialog.tsx   # Form detail of row
          PendingChanges.tsx    # Panel of pending changes with apply/revert
        common/
          CommandPalette.tsx    # Ctrl+Shift+P command palette
          ContextMenu.tsx       # Context menu
          Dialog.tsx            # Modal dialog
          Dropdown.tsx          # Dropdown / select
          Toast.tsx             # Toast notifications
          Icon.tsx              # Icons (SVG)
        views/
          SavedViewPicker.tsx   # Dropdown for selecting saved view
          SaveViewDialog.tsx    # Dialog for saving view
        history/
          QueryHistory.tsx      # Panel of query history
        export/
          ExportDialog.tsx      # Export dialog (format, preview, saving)
    frontend-desktop/           # Desktop entry: setTransport(electrobun) + setStorage(rpc)
      index.html                # HTML entry point
      main.tsx                  # Solid.js render entry
      transport.ts              # Electrobun RPC transport
    frontend-web/               # Web entry: setTransport(websocket) + setStorage(indexeddb)
      index.html
      main.tsx
      transport.ts              # WebSocket transport
    frontend-demo/              # Demo entry: setTransport(inline) + setStorage(rpc), WASM SQLite
      index.html
      main.tsx
      transport.ts              # Inline transport (direct function calls)
      wasm-sqlite-driver.ts     # WASM SQLite driver for browser
```

---

## Architecture

### Layering

```
┌─────────────────────────────────────────────┐
│  Frontend (Solid.js in webview/browser)      │
│  ├─ Components (UI)                         │
│  ├─ Stores (reactive state)                 │
│  └─ Lib (RPC client, keyboard, commands)    │
├──────────── Transport (pluggable) ──────────┤
│  Electrobun RPC │ WebSocket │ Inline calls  │
├─────────────────────────────────────────────┤
│  Backend (Bun process / WASM in demo)       │
│  ├─ RPC Handlers (entry point)              │
│  ├─ Services (business logic)               │
│  ├─ DB Drivers (database abstraction)       │
│  └─ Storage (local app data)                │
└─────────────────────────────────────────────┘
```

### Transport & Storage — Registration Pattern

Entry points register concrete implementations via `setTransport()` / `setStorage()`. Shared code accesses them through lazy proxies — no Vite swap plugins, no build-time module resolution tricks.

```typescript
// frontend-desktop/main.tsx
setTransport(createElectrobunTransport())
setStorage(new RpcAppStateStorage())
render(() => <App />, document.getElementById('app')!)
```

### Dependency Graph (no cycles)

```
shared               ← no deps
backend-shared       ← shared
backend-types        ← backend-shared (import type only)
frontend-shared      ← shared + backend-types (import type only)
frontend-desktop     ← frontend-shared
frontend-web         ← frontend-shared
frontend-demo        ← frontend-shared + backend-shared (runtime — createHandlers/RpcAdapter)
backend-desktop      ← backend-shared
backend-web          ← backend-shared
```

### Data Flow

1. **User action** → Solid.js component
2. Component calls **store** action
3. Store calls **RPC** method via transport (Electrobun RPC / WebSocket / inline)
4. RPC handler delegates to **service**
5. Service uses **driver** for DB communication
6. Result is returned the same way back

### Example: Opening a Table

```
User clicks on table in sidebar
  → ConnectionTree.tsx emits event
  → tabs store creates new tab (type: "data-grid")
  → grid store calls RPC `getTableData({ connectionId, table, page: 1 })`
  → rpc-handlers.ts → query-executor.ts → postgres-driver.ts
  → SQL: SELECT * FROM "table" LIMIT 100 OFFSET 0
  → result is returned to grid store
  → DataGrid.tsx renders data
```

---

## RPC Schema

RPC schema is defined in `src/shared/types/rpc.ts` and shared between backend and frontend. Type-safety is ensured via `backend-types` (type-only re-exports).

### Main RPC Methods

#### Connection Management

| Method                      | Direction | Description                   |
| --------------------------- | --------- | ----------------------------- |
| `connections.list`          | FE→BE     | List of saved connections     |
| `connections.create`        | FE→BE     | Create new connection         |
| `connections.update`        | FE→BE     | Edit connection               |
| `connections.delete`        | FE→BE     | Delete connection             |
| `connections.test`          | FE→BE     | Test connection               |
| `connections.connect`       | FE→BE     | Connect to DB                 |
| `connections.disconnect`    | FE→BE     | Disconnect from DB            |
| `connections.statusChanged` | BE→FE     | Notification of status change |

#### Schema

| Method                  | Direction | Description                        |
| ----------------------- | --------- | ---------------------------------- |
| `schema.getSchemas`     | FE→BE     | List of schemas                    |
| `schema.getTables`      | FE→BE     | List of tables in schema           |
| `schema.getColumns`     | FE→BE     | Table columns (types, constraints) |
| `schema.getIndexes`     | FE→BE     | Table indexes                      |
| `schema.getForeignKeys` | FE→BE     | FK constraints                     |

#### Data Grid

| Method                | Direction | Description                              |
| --------------------- | --------- | ---------------------------------------- |
| `data.getTableData`   | FE→BE     | Table data with pagination, sort, filter |
| `data.getRowCount`    | FE→BE     | Total row count                          |
| `data.getColumnStats` | FE→BE     | Column statistics (for filtering)        |

#### Data Editing

| Method              | Direction | Description                                  |
| ------------------- | --------- | -------------------------------------------- |
| `data.applyChanges` | FE→BE     | Apply pending changes (INSERT/UPDATE/DELETE) |
| `data.generateSql`  | FE→BE     | Generate SQL for pending changes (preview)   |

#### Query Execution

| Method          | Direction | Description          |
| --------------- | --------- | -------------------- |
| `query.execute` | FE→BE     | Execute SQL query    |
| `query.cancel`  | FE→BE     | Cancel running query |
| `query.format`  | FE→BE     | Format SQL           |

#### Transactions

| Method        | Direction | Description          |
| ------------- | --------- | -------------------- |
| `tx.begin`    | FE→BE     | Begin transaction    |
| `tx.commit`   | FE→BE     | Commit transaction   |
| `tx.rollback` | FE→BE     | Rollback transaction |
| `tx.status`   | FE→BE     | Transaction status   |

#### Export

| Method              | Direction | Description                   |
| ------------------- | --------- | ----------------------------- |
| `export.exportData` | FE→BE     | Export data to file           |
| `export.preview`    | FE→BE     | Export preview (first N rows) |

#### History

| Method          | Direction | Description           |
| --------------- | --------- | --------------------- |
| `history.list`  | FE→BE     | List of query history |
| `history.clear` | FE→BE     | Clear history         |

#### Saved Views

| Method         | Direction | Description                   |
| -------------- | --------- | ----------------------------- |
| `views.list`   | FE→BE     | List of saved views for table |
| `views.save`   | FE→BE     | Save view                     |
| `views.update` | FE→BE     | Edit view                     |
| `views.delete` | FE→BE     | Delete view                   |

#### System

| Method                  | Direction | Description                    |
| ----------------------- | --------- | ------------------------------ |
| `system.showOpenDialog` | FE→BE     | Open native file picker dialog |
| `system.showSaveDialog` | FE→BE     | Open native save dialog        |
| `settings.get`          | FE→BE     | Load settings                  |
| `settings.set`          | FE→BE     | Save settings                  |

---

## DatabaseDriver Interface

Abstraction for database operations. Each driver implements the same interface.

```typescript
interface DatabaseDriver {
	// Lifecycle
	connect(config: ConnectionConfig): Promise<void>
	disconnect(): Promise<void>
	isConnected(): boolean

	// Query execution
	execute(sql: string, params?: unknown[]): Promise<QueryResult>
	cancel(): Promise<void>

	// Schema introspection
	getSchemas(): Promise<SchemaInfo[]>
	getTables(schema: string): Promise<TableInfo[]>
	getColumns(schema: string, table: string): Promise<ColumnInfo[]>
	getIndexes(schema: string, table: string): Promise<IndexInfo[]>
	getForeignKeys(schema: string, table: string): Promise<ForeignKeyInfo[]>
	getPrimaryKey(schema: string, table: string): Promise<string[]>

	// Transactions
	beginTransaction(): Promise<void>
	commit(): Promise<void>
	rollback(): Promise<void>
	inTransaction(): boolean

	// Metadata
	getDriverType(): 'postgresql' | 'sqlite'
	quoteIdentifier(name: string): string
}
```

### PostgreSQL Driver (`postgres-driver.ts`)

Uses `Bun.SQL` with tagged template literals:

```typescript
import { SQL } from 'bun'

const db = new SQL({ url: connectionString })
const results = await db`SELECT * FROM ${SQL.id(table)} LIMIT ${limit}`
```

Properties:

- Connection pooling (built-in in Bun.SQL)
- Query cancellation via `AbortController`
- Schema introspection via `information_schema` and `pg_catalog`
- Transaction support

### SQLite Driver (`sqlite-driver.ts`)

Uses `Bun.SQL` with unified API:

```typescript
import { SQL } from 'bun'

const db = new SQL({ url: `sqlite:${filePath}` })
const results = await db`SELECT * FROM ${SQL.id(table)} LIMIT ${limit}`
```

Properties:

- Direct file access
- Schema introspection via `sqlite_master` and `PRAGMA` commands
- Simple transaction model

---

## Local App Storage

Application data (connections, history, settings, saved views) are stored in a local SQLite database:

**Path**: `Utils.paths.userData/dotaz.db`

### Schema

```sql
-- Saved connections
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('postgresql', 'sqlite')),
  config TEXT NOT NULL,  -- JSON: host, port, database, ...
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Query history
CREATE TABLE query_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  sql TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'error')),
  duration_ms INTEGER,
  row_count INTEGER,
  error_message TEXT,
  executed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

-- Saved views
CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,  -- JSON: columns, sort, filters, widths
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

-- Settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Schema version for migrations
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Frontend State Management

Application state is managed via Solid.js stores with `createStore` / `createSignal`.

### Stores

| Store         | Responsibility                                                                 |
| ------------- | ------------------------------------------------------------------------------ |
| `connections` | List of connections, connection state, active connection                       |
| `tabs`        | Open tabs, active tab, tab metadata                                            |
| `grid`        | Grid data: rows, columns, pagination, sort, filter, selection, pending changes |
| `editor`      | SQL console: editor content, results, tx state, running state                  |
| `ui`          | UI state: sidebar width, dialogs, toasts, command palette                      |

### Reactive Flow

```
User action → Store update → Automatic re-render (Solid.js fine-grained reactivity)
                           → Side-effect (RPC call, if needed)
```

---

## Security

- Connection strings and passwords: currently stored in local SQLite (encryption in future version)
- No telemetry or data transmission
- SQL parameters always via parameterized queries (SQL injection prevention)
- Frontend has no direct DB access — everything via RPC

---

## Implementation Phases

| Phase | Name                  | Issues          | Description                                           |
| ----- | --------------------- | --------------- | ----------------------------------------------------- |
| 0     | Project Setup         | DOTAZ-001 – 003 | Project initialization, shared types, app shell       |
| 1     | Foundation            | DOTAZ-004 – 011 | App DB, drivers, connection manager, RPC, layout      |
| 2     | Connection Management | DOTAZ-012 – 016 | Connection UI (dialog, tree, context menu)            |
| 3     | Data Grid             | DOTAZ-017 – 024 | Data grid with virtual scrolling, filters, pagination |
| 4     | SQL Editor            | DOTAZ-025 – 031 | Query executor, CodeMirror editor, autocomplete       |
| 5     | Data Editing          | DOTAZ-032 – 035 | Inline editing, row detail, pending changes           |
| 6     | Advanced Features     | DOTAZ-036 – 043 | Saved views, FK navigation, export, history, schema   |
| 7     | Polish                | DOTAZ-044 – 053 | Command palette, shortcuts, error handling, UI polish |

The dependency graph is acyclic. Each phase builds on the previous ones.
