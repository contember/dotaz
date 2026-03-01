# Shared Code — `src/shared/`

Code shared between backend (`src/bun/`), frontend (`src/mainview/`), and browser demo (`src/browser/`).

## Structure

```
src/shared/
  types/           ← Domain types shared across all layers
  sql/             ← SQL building (dialect interface, query builders, statement splitting)
  rpc/             ← RPC layer (adapter interface, unified handlers, type inference)
```

## Types (`src/shared/types/`)

| File | Purpose |
|---|---|
| `rpc.ts` | RPC param/result types, `DotazRPC` Electrobun schema, domain types (`SavedView`, `DataChange`) |
| `connection.ts` | `ConnectionConfig`, `ConnectionInfo`, `ConnectionState` |
| `database.ts` | `SchemaInfo`, `TableInfo`, `ColumnInfo`, `IndexInfo`, `ForeignKeyInfo`, `SchemaData` |
| `grid.ts` | `GridDataRequest`, `GridDataResponse`, `SortColumn`, `ColumnFilter`, `FilterOperator` |
| `query.ts` | `QueryResult`, `QueryHistoryEntry` |
| `tab.ts` | Tab types (data grid, SQL console, schema viewer) |
| `export.ts` | `ExportOptions`, `ExportResult`, export format definitions |

## RPC Layer (`src/shared/rpc/`)

| File | Purpose |
|---|---|
| `adapter.ts` | `RpcAdapter` interface — abstracts backend vs demo implementations |
| `handlers.ts` | `createHandlers(adapter)` — single handler definition for all modes |
| `types.ts` | `HandlerMap`, `NamespacedRpcClient` — types inferred from handlers (tRPC-style) |

### Adding a new RPC method

1. Add handler in `src/shared/rpc/handlers.ts` inside `createHandlers()` — use key format `"namespace.method"`
2. If the handler needs backend-specific logic, add the method to `RpcAdapter` in `adapter.ts`
3. Implement the method in `BackendAdapter` (`src/bun/rpc/backend-adapter.ts`) and `DemoAdapter` (`src/browser/demo-adapter.ts`)
4. Add param types to `src/shared/types/rpc.ts` if needed
5. The frontend client (`src/mainview/lib/rpc.ts`) automatically picks up new methods via the Proxy — no manual wiring needed
6. Update `DotazRPC` in `src/shared/types/rpc.ts` for Electrobun desktop mode

## SQL Building (`src/shared/sql/`)

| File | Purpose |
|---|---|
| `dialect.ts` | `SqlDialect` interface — `quoteIdentifier()`, `qualifyTable()` |
| `dialects.ts` | `PostgresDialect`, `SqliteDialect`, `MysqlDialect` implementations |
| `builders.ts` | `buildSelectQuery()`, `buildCountQuery()`, `generateChangeSql()`, etc. |
| `statements.ts` | `splitStatements()`, `parseErrorPosition()` — zero-dependency SQL parsing |

## Conventions

- Types here are the **single source of truth** for the RPC contract between frontend and backend
- Both sides import from `../../shared/...` (relative paths)
- Keep types minimal — only what's needed for serialization across the RPC boundary
- Use `string` for IDs, ISO strings for dates — values must be JSON-serializable
- Optional `database?: string` parameter on most RPC methods supports multi-database PostgreSQL connections
