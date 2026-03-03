# DOTAZ-071: Data comparison (side-by-side diff)

**Phase**: 10 — Backlog Tier 2
**Type**: fullstack
**Dependencies**: [DOTAZ-017, DOTAZ-025]

## Description

Compare data between two tables or two query results. Display differences side-by-side with color highlighting.

### Use cases

- Compare same table on two different databases (staging vs. production)
- Compare two tables in same database
- Compare two query results

### Display

- Side-by-side grid with color-highlighted differences
- Rows only on left (red), only on right (green), differing values (yellow)
- Column mapping (automatic by name, manual adjustment)
- Statistics: count of matching, added, removed, changed rows

### Matching

- Match rows by PK or user-selected key columns
- Tolerance parameter: how many columns may differ

## Files

- `src/backend-shared/services/comparison-service.ts` — ComparisonService for fetching and diffing data
- `src/shared/types/comparison.ts` — ComparisonResult, DiffRow types
- `src/shared/types/rpc.ts` — add `data.compare` RPC endpoint
- `src/backend-shared/rpc/rpc-handlers.ts` — comparison handler
- `src/frontend-shared/components/comparison/ComparisonDialog.tsx` — source selection dialog
- `src/frontend-shared/components/comparison/ComparisonView.tsx` — side-by-side diff grid

## Acceptance Criteria

- [ ] Dialog for selecting two data sources to compare
- [ ] Automatic column mapping by column names
- [ ] Side-by-side display with color-coded differences
- [ ] Statistics of differences (matching, added, removed, changed)
- [ ] Matching by PK or user-selected columns
- [ ] Works across connections (different databases)
