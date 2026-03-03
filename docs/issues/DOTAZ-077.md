# DOTAZ-077: Multiple cursors in SQL editor

**Phase**: 11 — Backlog Tier 3
**Type**: frontend
**Dependencies**: [DOTAZ-028]

## Description

Enable multiple cursors support in the CodeMirror editor. CodeMirror 6 supports this natively — just enable the appropriate extension.

### Operations

- **Alt+Click** — add another cursor
- **Ctrl+D** — select next occurrence of current word
- **Alt+Shift+I** — cursor at end of each selected line
- **Column selection** — Alt+Shift+Drag for block selection

## Files

- `src/frontend-shared/components/editor/SqlEditor.tsx` — enable CodeMirror multi-cursor extensions

## Acceptance Criteria

- [ ] Alt+Click adds cursor at clicked position
- [ ] Ctrl+D selects next occurrence of current word
- [ ] Typing with multiple cursors edits all positions simultaneously
- [ ] Escape cancels extra cursors and returns to one
