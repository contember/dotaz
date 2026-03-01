# DOTAZ-060: Query history time range filtering

**Phase**: 8 — Gaps
**Type**: fullstack
**Dependencies**: [DOTAZ-041, DOTAZ-042]

## Description

Add time range filtering to the query history dialog (FR-HIST-02). Currently history can be searched by text and filtered by connection, but there is no way to filter by date/time range.

Add date range inputs (from/to) to the QueryHistory dialog header. Pass the date range to the backend `history.list` RPC and filter in the SQL query.

## Files

- `src/shared/types/rpc.ts` — add `startDate?: string` and `endDate?: string` to `HistoryListParams`
- `src/backend-shared/storage/app-db.ts` — extend `listHistory()` SQL to filter by `executed_at` date range
- `src/frontend-shared/components/history/QueryHistory.tsx` — add date range inputs (from/to) to filter area

## Acceptance Criteria

- [ ] Date range inputs (from/to) in QueryHistory dialog
- [ ] Filtering by date range works correctly (inclusive)
- [ ] Date range combines with existing search text and connection filters (AND)
- [ ] Clearing date range shows all history again
- [ ] Date inputs use native date picker (`<input type="date">`)
- [ ] Preset quick filters: Today, Last 7 days, Last 30 days
