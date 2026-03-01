# DOTAZ-084: Improve shared domain model type safety

**Phase**: 8.5 — Tech Debt
**Type**: fullstack
**Dependencies**: none

## Description

Several shared types are too loose, allowing invalid states that are only caught at runtime.

### DataChange is not a discriminated union
`DataChange` has optional `primaryKeys` and `values` fields regardless of `type`. An INSERT without `values` or a DELETE without `primaryKeys` compiles fine but fails at runtime.

### ColumnInfo.dataType is untyped string
`dataType: string` forces frontend to use ad-hoc string matching (`isNumericType()` etc.) without compile-time validation. A `DatabaseDataType` enum would centralize type classification.

### SavedViewConfig duplicates sort/filter types
`SavedViewConfig` defines sort and filter inline instead of reusing existing `SortColumn` and `ColumnFilter` types from `grid.ts`.

Changes needed:
1. Convert `DataChange` to discriminated union: `InsertChange` (requires `values`), `UpdateChange` (requires `primaryKeys` + `values`), `DeleteChange` (requires `primaryKeys`)
2. Create `DatabaseDataType` enum and use it in `ColumnInfo.dataType` and `QueryResultColumn.dataType`
3. Update `SavedViewConfig` to reuse `SortColumn` and `ColumnFilter` types
4. Update all consumers to handle the narrowed types

## Files

- `src/shared/types/rpc.ts` — discriminated union for `DataChange`, update `SavedViewConfig`
- `src/shared/types/database.ts` — add `DatabaseDataType` enum, update `ColumnInfo`
- `src/shared/types/query.ts` — update `QueryResultColumn.dataType`
- `src/backend-shared/drivers/postgres-driver.ts` — map PostgreSQL types to `DatabaseDataType`
- `src/backend-shared/drivers/sqlite-driver.ts` — map SQLite types to `DatabaseDataType`
- `src/backend-shared/drivers/mysql-driver.ts` — map MySQL types to `DatabaseDataType`
- `src/backend-shared/services/query-executor.ts` — update DataChange handling for union type
- `src/frontend-shared/stores/grid.ts` — update SavedView usage
- `src/frontend-shared/components/edit/InlineEditor.tsx` — use `DatabaseDataType` enum
- `src/frontend-shared/components/edit/RowDetailDialog.tsx` — use `DatabaseDataType` enum

## Acceptance Criteria

- [ ] `DataChange` is a discriminated union — TypeScript enforces required fields per change type
- [ ] `DatabaseDataType` enum used in `ColumnInfo` and `QueryResultColumn`
- [ ] All 3 drivers map their native types to `DatabaseDataType`
- [ ] `SavedViewConfig` reuses `SortColumn` and `ColumnFilter` types
- [ ] `bunx tsc --noEmit` passes
- [ ] All existing tests pass
