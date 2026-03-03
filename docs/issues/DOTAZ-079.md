# DOTAZ-079: Editable query results

**Phase**: 11 — Backlog Tier 3
**Type**: fullstack
**Dependencies**: [DOTAZ-030, DOTAZ-032, DOTAZ-033]

## Description

Allow editing cells directly in SELECT query results (not just in the table data view). Currently query results are read-only — editing only works when opening a table via the schema browser.

### Requirements

- Query must contain PK columns for row identification
- System detects source table from the query
- After editing a cell, an UPDATE statement is generated
- Works for simple SELECT queries (single table)
- For JOIN queries: editing cells from an unambiguously identifiable table

### Limitations

- Does not work for aggregation queries (GROUP BY, HAVING)
- Does not work for UNION queries
- Does not work for subqueries in SELECT
- Does not work without PK in result set

## Files

- `src/backend-shared/services/query-executor.ts` — add `analyzeQueryEditability(sql, columns)` to detect source table and PK
- `src/shared/types/query.ts` — add editability info to QueryResult
- `src/frontend-shared/components/editor/SqlResultPanel.tsx` — enable inline editing for editable result sets
- `src/frontend-shared/stores/editor.ts` — add pending changes management for query results

## Acceptance Criteria

- [ ] Simple SELECT query results are editable (when PK is present)
- [ ] Editing generates correct UPDATE statement
- [ ] Pending changes panel works for query results
- [ ] Visual indication that result set is editable
- [ ] Results without PK or with aggregations remain read-only
- [ ] Indication of why result set is read-only (missing PK, aggregation, etc.)
