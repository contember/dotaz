# DOTAZ-088: Navigator search/filter in connection tree

**Phase**: 12 — DBeaver Parity
**Type**: frontend
**Dependencies**: [DOTAZ-015]

## Description

Add a search/filter input above the connection tree sidebar. Typing filters visible tables, views, and other objects by name — essential for databases with dozens or hundreds of tables.

### Behavior
- Search input always visible at the top of the sidebar connection tree
- Filters as you type (debounced, ~150ms)
- Matches against table/view names (case-insensitive, substring match)
- Non-matching nodes are hidden, matching nodes stay expanded
- Parent nodes (schema, connection) stay visible if any child matches
- Clear button (×) to reset filter
- Empty filter shows everything (default state)

## Files

- `src/frontend-shared/components/connection/ConnectionTree.tsx` — add filter input, filter logic
- `src/frontend-shared/components/connection/ConnectionTree.css` — search input styling
- `src/frontend-shared/components/layout/Sidebar.tsx` — ensure search input fits in sidebar layout

## Acceptance Criteria

- [ ] Search input at the top of connection tree
- [ ] Filters tables/views by name as user types
- [ ] Case-insensitive substring matching
- [ ] Parent nodes remain visible when children match
- [ ] Clear button to reset filter
- [ ] Debounced filtering (~150ms)
- [ ] Keyboard shortcut to focus search (Ctrl+F when sidebar focused or similar)
- [ ] Empty state when no results match
