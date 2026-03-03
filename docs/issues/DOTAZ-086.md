# DOTAZ-086: Frontend architecture cleanup

**Phase**: 8.5 — Tech Debt
**Type**: frontend
**Dependencies**: none

## Description

Several frontend patterns accumulate minor technical debt that should be cleaned up together.

### Magic layout numbers scattered across components

`HEADER_HEIGHT = 34` (DataGrid), `ROW_HEIGHT = 32` (VirtualScroller), `DEFAULT_COLUMN_WIDTH = 150` (GridHeader), `MIN_EDITOR_HEIGHT = 60` (SqlEditor) are hardcoded across 4+ component files. These should be centralized.

### Command registry memory leak

`commands.ts` stores commands in a `Map` (line 13) that is never cleared. If AppShell remounts (e.g., HMR), commands are registered twice.

### Fire-and-forget IndexedDB persistence

`connections.ts` writes to IndexedDB with `.catch(e => console.warn(...))` pattern (lines 145-147, 223, etc.). Silent failures mean users may lose connection configs without knowing.

Changes needed:

1. Centralize layout constants in a shared module (e.g., `src/frontend-shared/lib/layout-constants.ts`) or in CSS custom properties
2. Add `clearCommands()` to command registry, call it on AppShell cleanup
3. Improve IndexedDB error handling — show a toast on persistence failure instead of silent `console.warn`

## Files

- `src/frontend-shared/lib/layout-constants.ts` — new file with centralized constants
- `src/frontend-shared/components/grid/DataGrid.tsx` — import constants
- `src/frontend-shared/components/grid/VirtualScroller.tsx` — import constants
- `src/frontend-shared/components/grid/GridHeader.tsx` — import constants
- `src/frontend-shared/components/editor/SqlEditor.tsx` — import constants
- `src/frontend-shared/lib/commands.ts` — add `clearCommands()`, handle re-registration
- `src/frontend-shared/components/layout/AppShell.tsx` — call `clearCommands()` on cleanup
- `src/frontend-shared/stores/connections.ts` — show toast on IndexedDB persistence failures

## Acceptance Criteria

- [ ] Layout constants defined in one place, imported by all components
- [ ] Command registry cleared on AppShell unmount — no duplicate registrations after HMR
- [ ] IndexedDB write failures show a warning toast to the user
- [ ] No behavioral changes to grid rendering or command execution
- [ ] All existing tests pass
