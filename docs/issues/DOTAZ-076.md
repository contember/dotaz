# DOTAZ-076: Grid heatmaps for numeric columns

**Phase**: 11 — Backlog Tier 3
**Type**: frontend
**Dependencies**: [DOTAZ-020]

## Description

Color scales on numeric columns in the data grid for quick visual analysis of data distribution. User enables heatmap per column or for the entire table.

### Modes
- **Sequential** — light to dark (for values from min to max)
- **Diverging** — blue through white to red (for values with neutral center)

### Behavior
- Cell background color based on relative value within the column
- Min/max computed from currently displayed data
- Toggle in column header context menu
- NULL values are not colored

## Files

- `src/frontend-shared/components/grid/GridCell.tsx` — apply heatmap background color
- `src/frontend-shared/stores/grid.ts` — add `heatmapColumns` state with mode per column
- `src/frontend-shared/components/grid/DataGrid.tsx` — compute min/max for heatmap columns

## Acceptance Criteria

- [ ] Context menu on column header: "Apply Heatmap"
- [ ] Support Sequential color scale
- [ ] Support Diverging color scale
- [ ] Colors computed from min/max of currently displayed data
- [ ] NULL values have no heatmap color
- [ ] Works only on numeric columns
- [ ] Toggle to enable/disable per column
