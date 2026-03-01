# DOTAZ-062: Aggregate view for cell selection

**Phase**: 9 — Backlog Tier 1
**Type**: fullstack
**Dependencies**: [DOTAZ-024]

## Description

When the user selects a range of cells in the data grid, display a panel with aggregated values: SUM, COUNT, AVG, MIN, MAX. The panel appears at the bottom of the grid or as a floating popup. Saves writing `SELECT COUNT(*), SUM(x)...` queries for quick overview.

Aggregation is computed client-side over the currently displayed data. For numeric columns show all aggregates, for text columns show COUNT and COUNT DISTINCT only.

## Files

- `src/frontend-shared/components/grid/AggregatePanel.tsx` — floating panel component showing aggregated values
- `src/frontend-shared/components/grid/DataGrid.tsx` — integrate AggregatePanel, pass selected cell data
- `src/frontend-shared/stores/grid.ts` — track cell-level selection for aggregation

## Acceptance Criteria

- [ ] Selecting multiple cells in a column shows aggregation panel
- [ ] Numeric columns: SUM, COUNT, AVG, MIN, MAX
- [ ] Text columns: COUNT, COUNT DISTINCT, MIN (lexicographic), MAX
- [ ] Panel hides when selection is cleared
- [ ] Works with multi-row selection (Shift+Click, Ctrl+Click)
- [ ] Values are formatted by type (numbers with thousand separators, dates)
