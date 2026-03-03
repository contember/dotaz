# Shared Code — `src/shared/`

Pure types and browser-safe utilities shared across all layers. No backend concepts, no side effects.

## Structure

```
src/shared/
  types/           ← Domain types shared across all layers
  sql/             ← SQL building (dialect interface, query builders, statement splitting)
```

## Types (`src/shared/types/`)

| File            | Purpose                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `rpc.ts`        | Domain types: `SavedView`, `DataChange`, `HistoryListParams`, `SavedViewConfig`, dialog params |
| `connection.ts` | `ConnectionConfig`, `ConnectionInfo`, `ConnectionState`                                        |
| `database.ts`   | `SchemaInfo`, `TableInfo`, `ColumnInfo`, `IndexInfo`, `ForeignKeyInfo`, `SchemaData`           |
| `grid.ts`       | `GridDataRequest`, `GridDataResponse`, `SortColumn`, `ColumnFilter`, `FilterOperator`          |
| `query.ts`      | `QueryResult`, `QueryHistoryEntry`                                                             |
| `tab.ts`        | Tab types (data grid, SQL console, schema viewer)                                              |
| `export.ts`     | `ExportOptions`, `ExportResult`, export format definitions                                     |

### Adding a new RPC method

1. Add handler in `src/backend-shared/rpc/handlers.ts` inside `createHandlers()` — use key format `"namespace.method"`
2. If the handler needs backend-specific logic, add the method to `RpcAdapter` in `src/backend-shared/rpc/adapter.ts`
3. Implement the method in `BackendAdapter` (`src/backend-shared/rpc/backend-adapter.ts`) and `DemoAdapter` (`src/frontend-demo/demo-adapter.ts`)
4. Add param types to `src/shared/types/rpc.ts` if needed
5. The frontend client (`src/frontend-shared/lib/rpc.ts`) automatically picks up new methods via the Proxy — no manual wiring needed

## SQL Building (`src/shared/sql/`)

| File            | Purpose                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| `dialect.ts`    | `SqlDialect` interface — `quoteIdentifier()`, `qualifyTable()`            |
| `dialects.ts`   | `PostgresDialect`, `SqliteDialect`, `MysqlDialect` implementations        |
| `builders.ts`   | `buildSelectQuery()`, `buildCountQuery()`, `generateChangeSql()`, etc.    |
| `statements.ts` | `splitStatements()`, `parseErrorPosition()` — zero-dependency SQL parsing |

## Conventions

- Types here are the **single source of truth** for the RPC contract between frontend and backend
- Both sides import from `../../shared/...` (relative paths)
- Keep types minimal — only what's needed for serialization across the RPC boundary
- Use `string` for IDs, ISO strings for dates — values must be JSON-serializable
- Optional `database?: string` parameter on most RPC methods supports multi-database PostgreSQL connections
- **No side effects** — this package must be safe to import from any environment
