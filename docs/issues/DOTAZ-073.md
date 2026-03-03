# DOTAZ-073: Pin result tabs in SQL console

**Phase**: 11 — Backlog Tier 3
**Type**: frontend
**Dependencies**: [DOTAZ-030]

## Description

Allow pinning a result tab so it is not overwritten when running the next query. Currently a new query overwrites the result in the active tab. A pinned tab is preserved and the new query opens a new result tab.

### Behavior

- Pin icon on result tab
- Pinned tab cannot be overwritten automatically
- New query creates a new result tab (if current is pinned)
- Unpinning restores normal behavior

## Files

- `src/frontend-shared/stores/editor.ts` — add `pinnedResults` tracking per tab
- `src/frontend-shared/components/editor/SqlResultPanel.tsx` — add pin icon, manage pinned state

## Acceptance Criteria

- [ ] Pin icon on result tabs
- [ ] Pinned tab is not overwritten by new query
- [ ] New query creates new tab when current is pinned
- [ ] Unpinning works by clicking pin icon
- [ ] Visual distinction for pinned tab
