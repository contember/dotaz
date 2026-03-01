# DOTAZ-068: Data import (CSV/JSON into table)

**Phase**: 10 — Backlog Tier 2
**Type**: fullstack
**Dependencies**: [DOTAZ-032, DOTAZ-014]

## Description

Import data from a file (CSV, JSON) into an existing table. Natural counterpart to the existing export feature.

### Flow
1. User selects target table and clicks "Import"
2. Selects file (CSV or JSON)
3. App shows data preview and column mapping: file columns → table columns
4. User can adjust mapping, skip columns, set default values
5. Clicking "Import" inserts data via batched INSERT statements

### Supported formats
- **CSV**: configurable delimiter (comma, semicolon, tab), header row on/off
- **JSON**: array of objects (`[{col: val}, ...]`)

### Safety
- Import runs in a transaction — rollback on error
- Preview first N rows before actual import
- Show imported row count on completion

## Files

- `src/backend-shared/services/import-service.ts` — ImportService with CSV/JSON parsing, column mapping, batched INSERT
- `src/shared/types/import.ts` — ImportOptions, ColumnMapping types
- `src/shared/types/rpc.ts` — add `import.preview` and `import.importData` RPC endpoints
- `src/backend-shared/rpc/rpc-handlers.ts` — import handlers
- `src/frontend-shared/components/import/ImportDialog.tsx` — import wizard dialog with preview and column mapping

## Acceptance Criteria

- [ ] Import dialog accessible from table context menu
- [ ] Support for CSV and JSON formats
- [ ] Preview of imported data before confirmation
- [ ] Column mapping (file → table) with option to skip columns
- [ ] Configurable CSV delimiter and header row
- [ ] Import in transaction with rollback on error
- [ ] Progress indication for large files
- [ ] Display result (number of imported rows)
