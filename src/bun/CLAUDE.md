# Backend — `src/bun/`

Bun process handling database connections, query execution, and local app storage.

## Architecture

```
rpc-handlers.ts          ← RPC entry point, delegates to services
├── services/
│   ├── connection-manager.ts   ← Connection lifecycle (connect/disconnect/pool)
│   ├── query-executor.ts       ← Query execution, cancellation, SQL building
│   ├── transaction-manager.ts  ← Begin/commit/rollback
│   ├── export-service.ts       ← Export to CSV, JSON, SQL INSERT
│   ├── sql-formatter.ts        ← SQL formatting
│   └── encryption.ts           ← Password encryption (web mode)
├── db/
│   ├── driver.ts               ← DatabaseDriver interface (abstraction)
│   ├── postgres-driver.ts      ← PostgreSQL via Bun.SQL
│   └── sqlite-driver.ts        ← SQLite via Bun.SQL
├── storage/
│   ├── app-db.ts               ← Local SQLite for app data (connections, history, settings, views)
│   └── migrations.ts           ← Schema migrations for app DB
├── server.ts                   ← Web mode: HTTP + WebSocket server
└── index.ts                    ← Desktop mode: Electrobun window, menu, RPC setup
```

## Key Patterns

### DatabaseDriver interface (`db/driver.ts`)

All database operations go through this abstraction. Both PostgreSQL and SQLite implement the same interface:

- `execute(sql, params)` — query execution with parameterized queries
- `cancel()` — query cancellation
- `getSchemas()`, `getTables()`, `getColumns()`, `getIndexes()`, `getForeignKeys()`, `getPrimaryKey()` — schema introspection
- `beginTransaction()`, `commit()`, `rollback()` — transaction management
- `quoteIdentifier(name)` — safe identifier quoting

Both drivers use **`Bun.SQL`** with tagged template literals (`import { SQL } from "bun"`).

### RPC Handlers (`rpc-handlers.ts`)

Single `createHandlers()` function that takes dependencies (ConnectionManager, QueryExecutor, AppDatabase) and returns a flat map of `"namespace.method"` → handler function. Used by both desktop (Electrobun) and web (WebSocket) modes.

### Multi-database support

PostgreSQL connections support multiple databases. The `database` parameter is optional in most RPC methods — when provided, the operation targets that specific database's connection.

### Connection Manager (`services/connection-manager.ts`)

Manages the lifecycle of database connections. Each connection has a unique ID. Supports:
- Creating/updating/deleting saved connections (persisted in app DB)
- Connecting/disconnecting (creates/destroys DatabaseDriver instances)
- Per-database sub-connections for PostgreSQL

### App Storage (`storage/app-db.ts`)

Local SQLite database at `Utils.paths.userData/dotaz.db` (desktop) or `:memory:` (web) storing:
- Saved connections
- Query history
- Saved views (column config, sort, filters)
- Settings (key-value pairs)

In web mode, the in-memory app-db is ephemeral per session — the frontend stores persistent app state in IndexedDB and passes encrypted config on connect.

Migrations are in `storage/migrations.ts`.

## Web Server Mode (`server.ts`)

Standalone Bun HTTP/WebSocket server for running without Electrobun:
- `bun run dev:web` — starts server on port 4200 (or `DOTAZ_PORT`)
- Each WebSocket connection gets its own isolated session (in-memory AppDatabase, ConnectionManager, handlers)
- Serves the Vite-built frontend from `dist/`
- Frontend passes `encryptedConfig` on connect; backend decrypts and registers in the session's in-memory app-db

Environment variables:
- `DOTAZ_PORT` — server port (default 4200)
- `DOTAZ_ENCRYPTION_KEY` — required; used to encrypt/decrypt connection passwords stored in the browser

## Conventions

- Always use **`Bun.SQL`** for database operations, never raw `bun:sqlite` (except for app-db which uses `bun:sqlite` for local storage)
- Always use **parameterized queries** — no string concatenation for user-provided values
- Use `SQL.id()` for identifier quoting in Bun.SQL tagged templates
- Services are stateless functions or classes instantiated per-session
- Errors should propagate naturally — RPC layer handles serialization to frontend
