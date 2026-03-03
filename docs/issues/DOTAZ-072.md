# DOTAZ-072: JOIN autocompletion with FK awareness

**Phase**: 11 — Backlog Tier 3
**Type**: frontend
**Dependencies**: [DOTAZ-031, DOTAZ-038]

## Description

When writing a JOIN clause in the SQL editor, automatically suggest the complete JOIN condition based on foreign key relationships. For example:

User types `SELECT * FROM orders JOIN` and autocomplete suggests:

```sql
customers ON orders.customer_id = customers.id
```

### Behavior

- After typing `JOIN`, suggest tables that have FK relationships with tables in FROM
- After selecting a table, auto-complete the ON clause based on FK
- If multiple FKs exist between tables, offer selection
- Works for LEFT JOIN, RIGHT JOIN, INNER JOIN

## Files

- `src/frontend-shared/components/editor/SqlEditor.tsx` — add custom CodeMirror completion source for JOIN
- `src/frontend-shared/stores/editor.ts` — provide FK data for autocomplete context

## Acceptance Criteria

- [ ] After `JOIN`, FK-related tables appear first in autocomplete
- [ ] Selecting a table auto-completes the ON clause
- [ ] Support for multiple FKs between same tables (selection offered)
- [ ] Works for all JOIN types
- [ ] Uses existing schema introspection data
