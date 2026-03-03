# DOTAZ-058: Reverse FK — display referencing records in row detail

**Phase**: 8 — Gaps
**Type**: fullstack
**Dependencies**: [DOTAZ-034, DOTAZ-038]

## Description

In the RowDetailDialog, display records from tables that reference the current row via foreign keys (FR-FK-03). Currently only forward FK navigation is supported (this row → referenced row). The reverse direction (which rows in other tables reference this row) is missing.

Implementation:

1. Add a `getReferencingForeignKeys(schema, table)` method to DatabaseDriver that finds all FKs pointing TO this table
2. Add corresponding RPC handler
3. In RowDetailDialog, show a "Referenced By" section listing child tables with counts
4. Each child table entry is a link that opens a filtered data grid view on that table

## Files

- `src/bun/db/driver.ts` — add `getReferencingForeignKeys(schema: string, table: string)` to DatabaseDriver interface
- `src/bun/db/postgres-driver.ts` — implement using `information_schema.referential_constraints` + `key_column_usage`
- `src/bun/db/sqlite-driver.ts` — implement by scanning all tables' `PRAGMA foreign_key_list`
- `src/shared/types/rpc.ts` — add `schema.getReferencingForeignKeys` RPC endpoint
- `src/bun/rpc-handlers.ts` — add handler delegating to driver
- `src/mainview/components/edit/RowDetailDialog.tsx` — add "Referenced By" section with child table links and record counts

## Acceptance Criteria

- [ ] RowDetailDialog shows "Referenced By" section with list of child tables
- [ ] Each entry shows: table name, FK column(s), count of referencing records
- [ ] Clicking a child table entry opens a filtered data grid showing only referencing rows
- [ ] Works for both PostgreSQL and SQLite
- [ ] Gracefully handles tables with no reverse FKs (section hidden)
- [ ] Handles composite FKs correctly
