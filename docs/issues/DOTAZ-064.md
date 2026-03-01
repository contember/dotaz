# DOTAZ-064: Warning for DELETE/UPDATE without WHERE clause

**Phase**: 9 — Backlog Tier 1
**Type**: fullstack
**Dependencies**: [DOTAZ-025, DOTAZ-029]

## Description

Before executing a DELETE or UPDATE SQL statement that lacks a WHERE clause, show a confirmation dialog warning the user that all rows in the table will be affected.

Detection uses simple parsing: look for `DELETE FROM` or `UPDATE ... SET` without a subsequent `WHERE`. Does not need to be 100% accurate (no need to handle subqueries), but should cover 95% of common cases.

## Files

- `src/backend-shared/services/query-executor.ts` — add `detectDestructiveWithoutWhere(sql)` utility
- `src/shared/types/rpc.ts` — add warning info to query execute response or new RPC for pre-check
- `src/frontend-shared/stores/editor.ts` — intercept execution, show confirmation if destructive
- `src/frontend-shared/components/editor/DestructiveQueryDialog.tsx` — confirmation dialog component

## Acceptance Criteria

- [ ] DELETE without WHERE shows warning dialog before execution
- [ ] UPDATE without WHERE shows warning dialog before execution
- [ ] Dialog shows the SQL statement and warning about affected rows
- [ ] User can confirm execution or cancel
- [ ] Optional: "Don't show again for this session" checkbox
- [ ] Does not block statements with WHERE clause
