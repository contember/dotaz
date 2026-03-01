# DOTAZ-089: Advanced Copy with configurable format

**Phase**: 12 — DBeaver Parity
**Type**: frontend
**Dependencies**: [DOTAZ-024]

## Description

Add an Advanced Copy option (Ctrl+Shift+C) that opens a dialog for configuring the clipboard output format when copying cells from the data grid.

### Options
- **Delimiter**: Tab (default), Comma, Semicolon, Pipe, custom
- **Include column headers**: yes/no (default: yes)
- **Include row numbers**: yes/no (default: no)
- **Value format**: As displayed, Raw (no formatting), Quoted (SQL-style quoting)
- **NULL representation**: empty string, "NULL", "\N", custom

### Behavior
- Regular Ctrl+C keeps current behavior (tab-delimited, no headers)
- Ctrl+Shift+C opens the Advanced Copy dialog with preview
- Dialog shows live preview of first few rows in chosen format
- Last used settings are remembered for the session

## Files

- `src/frontend-shared/components/grid/AdvancedCopyDialog.tsx` — dialog with format options and preview
- `src/frontend-shared/components/grid/AdvancedCopyDialog.css` — dialog styling
- `src/frontend-shared/components/grid/DataGrid.tsx` — wire Ctrl+Shift+C shortcut
- `src/frontend-shared/stores/grid.ts` — advanced copy logic with format options

## Acceptance Criteria

- [ ] Ctrl+Shift+C opens Advanced Copy dialog
- [ ] Configurable delimiter (tab, comma, semicolon, pipe, custom)
- [ ] Toggle for including column headers
- [ ] Toggle for including row numbers
- [ ] Value format options (as displayed, raw, quoted)
- [ ] NULL representation option
- [ ] Live preview of formatted output in dialog
- [ ] Copy button copies formatted data to clipboard
- [ ] Settings remembered within session
- [ ] Also accessible via context menu "Advanced Copy..."
