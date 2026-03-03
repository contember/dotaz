# Dotaz — Product Requirements Document

## 1. Product Vision

**Dotaz** is a desktop database client focused on working with data. It offers a modern alternative to DataGrip with an emphasis on clean UX, speed, and efficiency in viewing, editing, and querying data.

The application **is not** a schema management tool (DDL) — it focuses exclusively on DML operations and read-only viewing of database structure.

## 2. Target Audience

Developers (backend/fullstack) who need quick, reliable, and clear access to data in databases during development and debugging.

## 3. Platform and Technology

- **Desktop app** built on **Electrobun** (Bun backend + system webview)
- Frontend: framework of choice (React/Solid/Vue + Vite)
- Communication frontend ↔ backend via Electrobun RPC

## 4. Supported Databases (v1)

| Database   | Connection                       |
| ---------- | -------------------------------- |
| PostgreSQL | Connection string / host+port+db |
| SQLite     | Path to file                     |

Architecture must account for extensibility to other databases (MySQL, MariaDB, ClickHouse, etc.).

---

## 5. Information Architecture and Layout

### 5.1 Overall Layout (DataGrip-like, modernized)

```
┌──────────────────────────────────────────────────────┐
│  Menu bar                                            │
├────────────┬─────────────────────────────────────────┤
│            │  Tabs (tables, SQL console, views...)   │
│  Sidebar   ├─────────────────────────────────────────┤
│  (tree)    │                                         │
│            │  Main panel                            │
│  Connections│  (data grid / SQL editor / detail)    │
│  > Schemas │                                         │
│  > Tables  │                                         │
│            │                                         │
│            ├─────────────────────────────────────────┤
│            │  Status bar (connection, tx mode, rows)  │
└────────────┴─────────────────────────────────────────┘
```

### 5.2 Sidebar — Connection Tree

- Hierarchical structure: **Connection → Schema → Tables**
- Icons distinguishing database type (PG vs SQLite)
- Context menu at individual levels (open data, new console, schema viewer)
- Connection status visually indicated (connected/disconnected)
- Ability to have multiple connections open simultaneously

### 5.3 Main Panel — Tab System

Tabs for different types of content:

- **Data grid** — viewing and editing data of a specific table
- **SQL console** — writing and executing SQL queries
- **Schema viewer** — read-only view of table structure
- **Saved view** — stored view (filter + sort + columns)

---

## 6. Functional Requirements

### 6.1 Connection Management

**FR-CONN-01**: Create New Connection

- Form with fields depending on database type
- PostgreSQL: host, port, database, username, password, SSL mode
- SQLite: path to file (with native file picker dialog)
- Connection naming
- Test connection button

**FR-CONN-02**: Save and Manage Connections

- List of saved connections in sidebar
- Editing and deletion of existing connections
- Connection duplication

**FR-CONN-03**: Simultaneous Connections

- Multiple connections open simultaneously
- Each tab is bound to a specific connection
- Clear visual indication of which connection a tab belongs to

**FR-CONN-04**: Reconnect

- Automatic reconnect attempt on connection failure
- Manual reconnect button
- Clear connection status (connected / connecting / error)

---

### 6.2 Data Viewing (Data Grid)

**FR-GRID-01**: Display Table Data

- Table grid with rows and columns
- Lazy loading / pagination of large tables
- Display of total row count
- Indication of data type for columns

**FR-GRID-02**: Sorting

- Click on column header for ASC/DESC sorting
- Multi-column sort (Shift+click)
- Visual indication of active sort

**FR-GRID-03**: Filtering

- Filtering by columns
- Supported operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, `IS NULL`, `IS NOT NULL`, `IN`
- Combination of multiple filters (AND)
- Text filter bar for quick full-text search in displayed data

**FR-GRID-04**: Column Management

- Hide/show columns
- Change column width (drag)
- Change column order (drag & drop)
- Pin columns (pin left/right)

**FR-GRID-05**: Cells and Values

- Display NULL values in distinct style
- Truncation of long text with ability to expand
- Display JSON/JSONB values with formatting
- Copy cell value (Ctrl+C)

**FR-GRID-06**: Row Selection

- Click = select row
- Ctrl+click = add to selection
- Shift+click = range select
- Select all (Ctrl+A)

---

### 6.3 Saved Views

**FR-VIEW-01**: Create View

- Save current grid state as named view
- Saved parameters: visible columns, column order, widths, sorting, filters

**FR-VIEW-02**: View Scope

- Views are bound to a specific table within a connection
- List of views available in the data grid panel

**FR-VIEW-03**: View Management

- Rename, edit, and delete view
- Switch between views within one table
- Default view (no filters) always available

**FR-VIEW-04**: Quick Switch

- Dropdown / list of views in data grid header
- Quick switching between saved views

---

### 6.4 Data Editing

**FR-EDIT-01**: Inline Editing (in grid)

- Double-click on cell → edit value directly in grid
- Tab/Enter to move to next cell
- Escape to cancel editing
- Visual indication of changed (not yet committed) cells

**FR-EDIT-02**: Form Detail

- Open row in detailed form (keyboard shortcut or context menu)
- Display all columns in vertical form
- Suitable for tables with many columns or long text values
- Edit values in form

**FR-EDIT-03**: Add Row

- Button / shortcut to add new row
- New row appears in grid (inline) or as form
- Validation of NOT NULL and other constraints before submission

**FR-EDIT-04**: Delete Row

- Delete selected rows (with confirmation dialog)
- Multi-select delete

**FR-EDIT-05**: Change Overview (pending changes)

- Before commit/apply: display list of all pending changes (INSERT, UPDATE, DELETE)
- Diff view: old vs. new value
- Ability to revert individual changes before commit

**FR-EDIT-06**: NULL Handling

- Explicit ability to set value to NULL (not empty string)
- Distinction between empty string and NULL in editing

---

### 6.5 SQL Editor / Console

**FR-SQL-01**: SQL Console

- Console bound to specific connection (DataGrip style)
- Multiple consoles open simultaneously (as tabs)
- Console naming

**FR-SQL-02**: Editor

- Syntax highlighting for SQL
- Autocomplete: tables, columns, SQL keywords, functions
- Autocomplete contextually dependent on current connection and schema
- SQL formatting (pretty print)
- Multi-statement support (separated by semicolon)

**FR-SQL-03**: Running Queries

- Run entire console content (Ctrl+Enter or button)
- Run selected text (selection + Ctrl+Enter)
- Run current statement (cursor is in statement)
- Indication of running query with option to cancel

**FR-SQL-04**: Results

- Display results in data grid below editor
- Multiple result sets (if multiple SELECT statements)
- Display number of affected rows for DML
- Display query duration
- Error messages with error position

**FR-SQL-05**: Console Transaction Mode

- Toggle in console header: **Auto-commit** / **Manual**
- Auto-commit: each statement is automatically committed
- Manual: explicit BEGIN/COMMIT/ROLLBACK
- Visual indication that console is in open transaction
- Warning when closing console with open transaction

---

### 6.6 Transactions

**FR-TX-01**: Transaction Modes

- Per-console setting: auto-commit or manual transactions
- Default mode configurable in settings

**FR-TX-02**: Manual Transactions

- BEGIN automatically on first DML (or explicitly)
- COMMIT / ROLLBACK buttons in UI
- Keyboard shortcuts for commit/rollback
- Visual indication of open transaction (colored status bar)

**FR-TX-03**: Transactions When Editing Data in Grid

- In manual mode: editing in grid accumulates as pending changes
- Apply = send SQL statements within transaction
- Commit = confirm transaction
- Rollback = discard all changes

**FR-TX-04**: Data Loss Protection

- Warning when closing tab with uncommitted transaction
- Warning when disconnecting with open transactions
- Warning when closing application with open transactions

---

### 6.7 Data Export

**FR-EXP-01**: Export Formats

- CSV (with configurable delimiter and encoding)
- JSON (array of objects)
- SQL INSERT statements

**FR-EXP-02**: Export Scope

- Export entire table
- Export current view (with applied filters)
- Export SQL query result
- Export selected rows

**FR-EXP-03**: Export Workflow

- Button in grid toolbar
- Select format → preview (first N rows) → save file (native save dialog)

---

### 6.8 FK Navigation and Relationships

**FR-FK-01**: FK Indication

- Columns with FK visually distinguished in grid (icon/color)
- Tooltip with information about target table and column

**FR-FK-02**: FK Navigation

- Click on FK value → navigate to referenced row in target table
- Open in new tab or in-place navigation
- Breadcrumb / back navigation

**FR-FK-03**: Related Data

- From row detail: display records from tables that reference this row (reverse FK)
- Link to open filtered view on child table

---

### 6.9 Query History

**FR-HIST-01**: Automatic Logging

- Every executed query is saved to history
- Metadata: timestamp, connection, duration, number of results/affected rows, success/error

**FR-HIST-02**: View History

- Searchable list of query history
- Filtering by connection
- Filtering by time range

**FR-HIST-03**: Actions from History

- Re-run query from history
- Copy query to console
- Copy query to clipboard

---

### 6.10 Schema Viewer (read-only)

**FR-SCHEMA-01**: Display Table Structure

- List of columns: name, data type, nullable, default, comment
- Primary key indication
- FK constraints with links to target tables

**FR-SCHEMA-02**: Indexes

- List of table indexes: name, columns, type (unique, btree, etc.)

**FR-SCHEMA-03**: Navigation

- From schema viewer: link to table data grid
- From FK: link to schema of target table

---

## 7. Controls and UX

### 7.1 Keyboard Shortcuts

| Action             | Shortcut          |
| ------------------ | ----------------- |
| Command palette    | Ctrl+Shift+P      |
| New SQL console    | Ctrl+N            |
| Run query          | Ctrl+Enter        |
| Commit transaction | Ctrl+Shift+Enter  |
| Rollback           | Ctrl+Shift+R      |
| Save view          | Ctrl+S            |
| Close tab          | Ctrl+W            |
| Switch tabs        | Ctrl+Tab          |
| Search in sidebar  | Ctrl+Shift+F      |
| Open row form      | Enter (on row)    |
| Inline editing     | F2 / double-click |
| Delete row         | Delete            |
| Refresh data       | F5                |

### 7.2 Command Palette

- Ctrl+Shift+P opens command palette
- Fuzzy search over all available commands
- Display keyboard shortcut for each command
- Recent commands at top

### 7.3 Context Menu

- Right-click on cell: copy, edit, set NULL, filter by value
- Right-click on row: open detail, delete, duplicate
- Right-click on column: sort, filter, hide, show schema
- Right-click in sidebar: open data, new console, schema viewer

---

## 8. Non-Functional Requirements

**NFR-01**: Performance

- Data grid must scroll smoothly with 10,000+ rows
- Autocomplete must respond within 100 ms
- Open table with data within 500 ms (for tables up to 100k rows)

**NFR-02**: Stability

- One connection crash must not affect others
- Graceful error handling from database (display error message, not crash)

**NFR-03**: Extensibility

- Database driver architecture must allow adding new DB type without affecting core logic
- Abstract layer for database operations (query, metadata, schema info)

**NFR-04**: Security

- Connection strings and passwords stored securely (not plaintext)
- No telemetry or data transmission

---

## 9. Out of Scope (v1)

- Schema management (CREATE, ALTER, DROP tables)
- Stored procedures / functions editor
- Data import (CSV → table)
- Visual query builder (drag & drop)
- ER diagram / schema visualization
- Collaboration / connection sharing
- Cloud sync settings
- Support for other DBs (MySQL, MongoDB, etc.) — coming in later versions
- Specifics of configuration storage (handled by Electrobun / implementation detail)

---

## 10. Success Metrics

- Application is usable as a daily replacement for DataGrip for working with PostgreSQL and SQLite
- Time from launch to first query < 3 seconds
- Editing workflow (edit → commit) is smooth and error-free
- Export works reliably for tables up to 1M rows
