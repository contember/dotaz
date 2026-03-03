# DOTAZ-066: Transpose view for data grid

**Phase**: 9 — Backlog Tier 1
**Type**: frontend
**Dependencies**: [DOTAZ-020]

## Description

Add a toggle in the grid toolbar for transposing the display: rows become columns and columns become rows. Essential for tables with many columns (50+) where horizontal scrolling is impractical.

In transposed mode:

- Each original table row = one column
- Column names are in the first column (as row headers)
- Arrow key navigation works rotated
- Can be combined with existing sorting and filtering

## Files

- `src/frontend-shared/stores/grid.ts` — add `transposed` state to TabGridState
- `src/frontend-shared/components/grid/DataGrid.tsx` — add transpose toggle button to toolbar
- `src/frontend-shared/components/grid/TransposedGrid.tsx` — transposed grid rendering component
- `src/frontend-shared/components/grid/GridCell.tsx` — support transposed cell rendering

## Acceptance Criteria

- [ ] Toggle button in grid toolbar to switch transpose mode
- [ ] Columns display as rows and rows as columns
- [ ] Column names form the first column (row headers)
- [ ] Inline editing works in transposed mode
- [ ] Switching back preserves state (sort, filters)
- [ ] Keyboard shortcut for toggle
