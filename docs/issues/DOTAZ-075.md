# DOTAZ-075: Full-text search across database tables

**Phase**: 11 — Backlog Tier 3
**Type**: fullstack
**Dependencies**: [DOTAZ-017, DOTAZ-025]

## Description

Search for a text string across all tables (or selected tables) in a database. Slow, but invaluable when you don't know where data is located.

### Flow
1. User opens "Search in Database" dialog
2. Enters search text
3. Selects scope: entire database, specific schema, or selected tables
4. Starts search
5. Results show: table → column → matching row

### Implementation
- For each table in scope, generate SELECT with WHERE LIKE across text-compatible columns
- Execute queries sequentially (not in parallel, to avoid overloading DB)
- Progress bar with name of currently searched table
- Option to cancel ongoing search
- Limit on results per table

## Files

- `src/backend-shared/services/search-service.ts` — SearchService for cross-table text search
- `src/shared/types/rpc.ts` — add `search.searchDatabase` RPC endpoint with progress messages
- `src/backend-shared/rpc/rpc-handlers.ts` — search handler
- `src/frontend-shared/components/search/DatabaseSearchDialog.tsx` — search dialog with scope selection, progress, results

## Acceptance Criteria

- [ ] Dialog for full-text search with scope selection
- [ ] Searches text-compatible columns in selected tables
- [ ] Results grouped by table → column
- [ ] Progress indication and cancellation
- [ ] Click on result opens table with filtered row
- [ ] Configurable limit on results per table
- [ ] Case-insensitive search
