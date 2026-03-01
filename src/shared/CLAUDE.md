# Shared Types — `src/shared/types/`

Type definitions shared between backend (`src/bun/`) and frontend (`src/mainview/`).

## Files

| File | Purpose |
|---|---|
| `rpc.ts` | RPC request/response param types + full schema definition |
| `connection.ts` | `ConnectionConfig`, `ConnectionInfo`, `ConnectionState` |
| `database.ts` | `SchemaInfo`, `TableInfo`, `ColumnInfo`, `IndexInfo`, `ForeignKeyInfo`, `DatabaseInfo` |
| `grid.ts` | `GridDataRequest`, `GridDataResponse`, `SortColumn`, `ColumnFilter`, `FilterOperator` |
| `query.ts` | `QueryResult`, `QueryHistoryEntry` |
| `tab.ts` | Tab types (data grid, SQL console, schema viewer) |
| `export.ts` | `ExportOptions`, `ExportResult`, export format definitions |

## Conventions

- Types here are the **single source of truth** for the RPC contract between frontend and backend
- Both sides import from `../../shared/types/...` (relative paths)
- When adding a new RPC method: define param/result types in `rpc.ts`, implement handler in `src/bun/rpc-handlers.ts`, add typed client method in `src/mainview/lib/rpc.ts`
- Keep types minimal — only what's needed for serialization across the RPC boundary
- Use `string` for IDs, ISO strings for dates — values must be JSON-serializable
- Optional `database?: string` parameter on most RPC methods supports multi-database PostgreSQL connections
