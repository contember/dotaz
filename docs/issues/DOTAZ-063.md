# DOTAZ-063: Quick value shortcuts during cell editing

**Phase**: 9 — Backlog Tier 1
**Type**: frontend
**Dependencies**: [DOTAZ-033, DOTAZ-034]

## Description

Add single-key shortcuts for common values during cell editing in the grid:

- `n` → NULL (for nullable columns)
- `t` → true (for boolean columns)
- `f` → false (for boolean columns)
- `d` → DEFAULT (insert column default value)

Shortcuts only activate when the cell is empty or via a modifier key (e.g., Ctrl+key) to avoid conflict with normal text input.

## Files

- `src/frontend-shared/components/edit/InlineEditor.tsx` — add shortcut handling for quick values
- `src/frontend-shared/components/edit/RowDetailDialog.tsx` — same shortcuts in form editing

## Acceptance Criteria

- [ ] Quick value shortcuts work in cell editing mode for NULL, true, false, DEFAULT
- [ ] Shortcuts do not conflict with normal text input
- [ ] Visual indication of special value set (NULL, DEFAULT visually distinct from regular text)
- [ ] Works in both inline editing and Row Detail dialog
