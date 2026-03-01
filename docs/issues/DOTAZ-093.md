# DOTAZ-093: Advanced Paste into data grid

**Phase**: 12 — DBeaver Parity
**Type**: frontend
**Dependencies**: [DOTAZ-033]

## Description

Paste tabular data from clipboard into multiple grid rows. Supports pasting from spreadsheets, other database tools, or text editors.

### Behavior
- Ctrl+V in the grid detects multi-row clipboard content (tab-delimited or CSV)
- Parses clipboard into rows and columns
- If pasting into existing rows: overwrites cell values starting from selected cell
- If pasting beyond last row: creates new pending INSERT rows
- Each pasted cell becomes a pending change (same as inline editing)

### Parsing
- Auto-detect delimiter (tab first, then comma, then semicolon)
- Handle quoted values (`"value with, comma"`)
- Handle NULL representation: empty string → NULL, "NULL" text → NULL (configurable)
- Handle newlines within quoted values
- Trim whitespace from unquoted values

### Safety
- Preview dialog for large pastes (>50 rows): show row count, column mapping, sample
- Undo: all pasted changes can be reverted via existing pending changes panel

## Files

- `src/frontend-shared/components/grid/DataGrid.tsx` — handle Ctrl+V, parse clipboard
- `src/frontend-shared/components/grid/PastePreviewDialog.tsx` — preview dialog for large pastes
- `src/frontend-shared/components/grid/PastePreviewDialog.css` — dialog styling
- `src/frontend-shared/stores/grid.ts` — batch-create pending changes from parsed data

## Acceptance Criteria

- [ ] Ctrl+V in grid pastes tabular data into cells
- [ ] Auto-detect delimiter (tab, comma, semicolon)
- [ ] Handle quoted values and escaped quotes
- [ ] Pasting beyond last row creates new INSERT rows
- [ ] Each pasted cell tracked as a pending change
- [ ] Preview dialog for pastes >50 rows
- [ ] NULL handling (empty → NULL, configurable)
- [ ] All pasted changes revertible via pending changes panel
