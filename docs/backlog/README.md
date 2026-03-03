# Backlog — Feature Ideas

Inspirováno průzkumem DataGrip features (DML only, bez DDL). Seřazeno dle priority.

Všechny backlog items mají založené issues — viz [STATUS.md](../STATUS.md).

## Tier 1 — Rychlé výhry (nízký effort, vysoký dopad)

| Feature                          | Soubor                                                   | Issue                               | Popis                                             |
| -------------------------------- | -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------- |
| Aggregate View                   | [aggregate-view.md](aggregate-view.md)                   | [DOTAZ-062](../issues/DOTAZ-062.md) | Označit buňky → SUM, COUNT, AVG, MIN, MAX         |
| Quick Value Shortcuts            | [quick-value-shortcuts.md](quick-value-shortcuts.md)     | [DOTAZ-063](../issues/DOTAZ-063.md) | n→NULL, t→true, f→false, d→DEFAULT při editaci    |
| DELETE/UPDATE bez WHERE varování | [destructive-sql-warning.md](destructive-sql-warning.md) | [DOTAZ-064](../issues/DOTAZ-064.md) | Potvrzovací dialog pro destruktivní SQL bez WHERE |
| Read-only Mode                   | [read-only-mode.md](read-only-mode.md)                   | [DOTAZ-065](../issues/DOTAZ-065.md) | Per-connection ochrana proti nechtěným zápisům    |
| Transpose View                   | [transpose-view.md](transpose-view.md)                   | [DOTAZ-066](../issues/DOTAZ-066.md) | Přepnutí řádky↔sloupce pro široké tabulky         |

## Tier 2 — Střední effort, zásadní features

| Feature              | Soubor                                           | Issue                               | Popis                                              |
| -------------------- | ------------------------------------------------ | ----------------------------------- | -------------------------------------------------- |
| EXPLAIN Plan         | [explain-plan.md](explain-plan.md)               | [DOTAZ-067](../issues/DOTAZ-067.md) | Vizualizace execution planu dotazu                 |
| Data Import          | [data-import.md](data-import.md)                 | [DOTAZ-068](../issues/DOTAZ-068.md) | Import CSV/JSON do tabulky s column mappingem      |
| Value Editor Panel   | [value-editor-panel.md](value-editor-panel.md)   | [DOTAZ-069](../issues/DOTAZ-069.md) | Boční panel pro JSON, dlouhé texty, velké hodnoty  |
| Další export formáty | [more-export-formats.md](more-export-formats.md) | [DOTAZ-070](../issues/DOTAZ-070.md) | Markdown, SQL UPDATE, HTML, XML                    |
| Data Comparison      | [data-comparison.md](data-comparison.md)         | [DOTAZ-071](../issues/DOTAZ-071.md) | Side-by-side porovnání dvou tabulek/query výsledků |

## Tier 3 — Nice-to-have

| Feature                    | Soubor                                                       | Issue                               | Popis                                                   |
| -------------------------- | ------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------- |
| JOIN Autocompletion        | [join-autocompletion.md](join-autocompletion.md)             | [DOTAZ-072](../issues/DOTAZ-072.md) | Auto-doplnění JOIN + ON z FK vztahů                     |
| Pin Result Tabs            | [pin-result-tabs.md](pin-result-tabs.md)                     | [DOTAZ-073](../issues/DOTAZ-073.md) | Připnout výsledkový tab, aby nebyl přepsán              |
| Bookmarks                  | [bookmarks.md](bookmarks.md)                                 | [DOTAZ-074](../issues/DOTAZ-074.md) | Ukládání oblíbených SQL dotazů                          |
| Full-text Search Across DB | [fulltext-search-across-db.md](fulltext-search-across-db.md) | [DOTAZ-075](../issues/DOTAZ-075.md) | Hledání textu napříč všemi tabulkami                    |
| Grid Heatmaps              | [grid-heatmaps.md](grid-heatmaps.md)                         | [DOTAZ-076](../issues/DOTAZ-076.md) | Barevné škály na numerických sloupcích                  |
| Multiple Cursors           | [multiple-cursors.md](multiple-cursors.md)                   | [DOTAZ-077](../issues/DOTAZ-077.md) | Multi-cursor editace v SQL editoru                      |
| Connection Color Coding    | [connection-color-coding.md](connection-color-coding.md)     | [DOTAZ-078](../issues/DOTAZ-078.md) | Barevné odlišení connections (prod=červená, dev=zelená) |
| Editable Query Results     | [editable-query-results.md](editable-query-results.md)       | [DOTAZ-079](../issues/DOTAZ-079.md) | Editace buněk přímo ve výsledcích SELECT dotazu         |

## Poznámky

- Grid full-text search (v rámci jedné tabulky) je naplánovaný jako [DOTAZ-055](../issues/DOTAZ-055.md) (Phase 8 — PRD Gaps)
- Virtual Foreign Keys nemá zatím detailní specifikaci — chybí soubor
- Všechny naplánované issues viz [STATUS.md](../STATUS.md)
