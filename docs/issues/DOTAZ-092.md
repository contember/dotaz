# DOTAZ-092: Data format profiles

**Phase**: 12 — DBeaver Parity
**Type**: fullstack
**Dependencies**: [DOTAZ-017]

## Description

Global settings for how data values are displayed in the grid. Configurable format profiles for dates, numbers, and special values.

### Configurable Formats
- **Date/Time**: display format (e.g. `YYYY-MM-DD HH:mm:ss`, `DD.MM.YYYY`, ISO 8601)
- **Numbers**: decimal separator (dot/comma), thousands separator (space/comma/dot/none), decimal places
- **NULL display**: how NULL values appear in the grid (empty, "NULL", "∅", custom text + styling)
- **Boolean display**: true/false, 1/0, yes/no, checkmark/cross
- **Binary display**: hex, base64, "(binary N bytes)"

### Architecture
- Settings stored in app database (global, not per-connection)
- Settings dialog accessible from app menu or status bar
- Grid cells read format settings from a shared store
- Changes apply immediately to all open grids

## Files

- `src/bun/services/app-database.ts` — store format settings
- `src/shared/types/settings.ts` — format profile type definitions
- `src/mainview/components/common/FormatSettingsDialog.tsx` — settings dialog
- `src/mainview/components/common/FormatSettingsDialog.css` — dialog styling
- `src/mainview/stores/settings.ts` — format settings store
- `src/mainview/components/grid/GridCell.tsx` — apply format settings to cell rendering

## Acceptance Criteria

- [ ] Settings dialog for data format configuration
- [ ] Configurable date/time display format
- [ ] Configurable number format (decimal separator, thousands, precision)
- [ ] Configurable NULL display text and styling
- [ ] Configurable boolean display format
- [ ] Settings persist in app database
- [ ] Changes apply immediately to all open grids
- [ ] Sensible defaults (ISO dates, dot decimal, "NULL" text)
