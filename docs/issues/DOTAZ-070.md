# DOTAZ-070: Additional export formats (Markdown, SQL UPDATE, HTML)

**Phase**: 10 — Backlog Tier 2
**Type**: fullstack
**Dependencies**: [DOTAZ-039, DOTAZ-040]

## Description

Extend existing export (CSV, JSON, SQL INSERT) with additional useful formats:

- **Markdown table** — for pasting into documentation, GitHub issues, README
- **SQL UPDATE** — generates UPDATE statements instead of INSERT (useful for data migration)
- **HTML table** — for sharing in emails, presentations
- **XML** — structured XML output

### Priority

1. Markdown — simple implementation, high usefulness
2. SQL UPDATE — logical complement to SQL INSERT
3. HTML — simple
4. XML — less common but complete

## Files

- `src/backend-shared/services/export-service.ts` — add MarkdownFormatter, SqlUpdateFormatter, HtmlFormatter, XmlFormatter
- `src/shared/types/export.ts` — extend `ExportFormat` type with new formats
- `src/frontend-shared/components/export/ExportDialog.tsx` — add new formats to format selector

## Acceptance Criteria

- [ ] Markdown table export with correct formatting
- [ ] SQL UPDATE export with WHERE clause based on PK
- [ ] HTML table export
- [ ] All new formats available in Export dialog
- [ ] Work with all export scopes (entire table, current view, selected rows)
- [ ] Preview in export dialog for each format
