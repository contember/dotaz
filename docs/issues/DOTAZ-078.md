# DOTAZ-078: Connection color coding

**Phase**: 11 — Backlog Tier 3
**Type**: fullstack
**Dependencies**: [DOTAZ-013, DOTAZ-015]

## Description

Assign a color to a connection for visual differentiation of environments. Typical usage:

- **Red** — production (caution!)
- **Green** — development
- **Yellow** — staging
- **Blue** — testing

The color appears as:

- Colored bar in status bar
- Colored indicator in connection tree
- Optionally: colored border around the entire window

### Color selection

- Predefined palette (8–12 colors)
- Setting in Connection dialog

## Files

- `src/shared/types/connection.ts` — add `color?: string` to connection config
- `src/frontend-shared/components/connection/ConnectionDialog.tsx` — add color palette picker
- `src/backend-shared/storage/app-db.ts` — persist color setting
- `src/frontend-shared/components/connection/ConnectionTree.tsx` — show color indicator
- `src/frontend-shared/components/layout/StatusBar.tsx` — show colored bar for active connection

## Acceptance Criteria

- [ ] Color picker in Connection dialog (palette of predefined colors)
- [ ] Colored indicator in connection tree
- [ ] Colored bar in status bar for active connection
- [ ] Color persists in app database
- [ ] Default color: none (neutral)
