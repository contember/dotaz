# DOTAZ-091: Query navigation in SQL editor

**Phase**: 12 — DBeaver Parity
**Type**: frontend
**Dependencies**: [DOTAZ-029]

## Description

Add keyboard shortcuts to jump between SQL statements in the editor. When a script contains multiple statements separated by semicolons, Alt+Up/Down moves the cursor to the previous/next statement.

### Behavior

- Alt+Down: move cursor to the beginning of the next SQL statement
- Alt+Up: move cursor to the beginning of the previous SQL statement
- Statement boundaries detected by semicolon delimiters (same logic as "Run at cursor")
- Cursor lands at the first non-whitespace character of the target statement
- At first/last statement, the shortcut is a no-op (no wrapping)
- Works with both single-line and multi-line statements

## Files

- `src/frontend-shared/components/editor/SqlEditor.tsx` — add CodeMirror keybindings for Alt+Up/Down
- `src/frontend-shared/components/editor/sql-utils.ts` — statement boundary detection (reuse from DOTAZ-056 if available)

## Acceptance Criteria

- [ ] Alt+Down jumps to next SQL statement
- [ ] Alt+Up jumps to previous SQL statement
- [ ] Statement boundaries detected by semicolons
- [ ] Cursor positioned at start of target statement
- [ ] Works with multi-line statements
- [ ] No-op at first/last statement boundaries
- [ ] Works alongside existing editor keybindings without conflicts
