# DOTAZ-081: Extract duplicated frontend utilities

**Phase**: 8.5 — Tech Debt
**Type**: frontend
**Dependencies**: none

## Description

Several utility functions and patterns are duplicated across frontend components and stores.

### Data type helpers (copy-pasted across 2 files)

`isNumericType()`, `isBooleanType()`, `isDateType()`, `isTextType()` are identically defined in both `InlineEditor.tsx` (lines 15-39) and `RowDetailDialog.tsx` (lines 28-53). Bugs fixed in one won't be fixed in the other.

### Tab management boilerplate (repeated in 3 stores)

`getTab()` and `ensureTab()` follow nearly identical patterns in `grid.ts`, `editor.ts`, and `tabs.ts` — each about 10 lines, totaling 20+ lines of duplication.

### AppDb guard (repeated 8+ times in RPC handlers)

`if (!appDb) throw new Error("App database not available")` is repeated at lines 219, 229, 237, and 5+ more locations in `rpc-handlers.ts`.

Changes needed:

1. Create `src/frontend-shared/lib/column-types.ts` with shared `isNumericType`, `isBooleanType`, `isDateType`, `isTextType`
2. Create `src/frontend-shared/lib/tab-store-helpers.ts` with generic `getTab()` / `ensureTab()` utilities
3. Create `requireAppDb()` helper in `rpc-handlers.ts` (or extract to utility)
4. Update all consumers to use the shared utilities

## Files

- `src/frontend-shared/lib/column-types.ts` — new file with data type helpers
- `src/frontend-shared/components/edit/InlineEditor.tsx` — import from column-types
- `src/frontend-shared/components/edit/RowDetailDialog.tsx` — import from column-types
- `src/frontend-shared/lib/tab-store-helpers.ts` — new file with tab utilities
- `src/frontend-shared/stores/grid.ts` — use shared tab helpers
- `src/frontend-shared/stores/editor.ts` — use shared tab helpers
- `src/frontend-shared/stores/tabs.ts` — use shared tab helpers
- `src/backend-shared/rpc/rpc-handlers.ts` — extract and use `requireAppDb()`

## Acceptance Criteria

- [ ] `isNumericType`, `isBooleanType`, `isDateType`, `isTextType` defined in one place only
- [ ] Tab management helpers shared across stores with no duplicated logic
- [ ] `requireAppDb()` used instead of repeated null checks
- [ ] No behavioral changes — all existing tests pass
- [ ] `bunx tsc --noEmit` passes
