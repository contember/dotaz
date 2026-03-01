# DOTAZ-069: Value editor side panel

**Phase**: 10 — Backlog Tier 2
**Type**: frontend
**Dependencies**: [DOTAZ-020, DOTAZ-033]

## Description

Dedicated side panel for viewing and editing the value of the selected cell. Automatically appears when clicking a cell (or via toggle). Useful for:

- **Long text** — display with word-wrap instead of cell truncation
- **JSON data** — formatted JSON with indentation and syntax highlighting
- **XML data** — formatted XML
- **Binary data** — hex view or image preview

### Behavior
- Panel appears on the right side of the grid
- Content updates when navigating between cells
- Edits in the panel propagate back to the grid (pending changes)
- Toggle button for show/hide

## Files

- `src/frontend-shared/components/grid/ValueEditorPanel.tsx` — side panel component with type-aware rendering
- `src/frontend-shared/components/grid/DataGrid.tsx` — integrate panel, toggle button in toolbar
- `src/frontend-shared/stores/grid.ts` — add `valueEditorOpen` state

## Acceptance Criteria

- [ ] Side panel showing value of currently selected cell
- [ ] Automatic update when navigating between cells
- [ ] JSON values displayed with formatting and syntax highlighting
- [ ] Long text displayed with word-wrap
- [ ] Edits in panel create pending changes
- [ ] Toggle button in grid toolbar
- [ ] Keyboard shortcut for toggle
- [ ] Panel remembers width (resizable)
