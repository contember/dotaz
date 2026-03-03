# EXPLAIN Plan

**Tier**: 2 — Střední effort, zásadní feature
**Type**: fullstack
**Inspiration**: DataGrip — Explain Plan (tree, diagram, flame graph)

## Description

Přidat možnost zobrazit execution plan SQL dotazu. Uživatel klikne na "Explain" (nebo Ctrl+E) místo "Run" a výsledek se zobrazí jako strukturovaný plan místo datového gridu.

### PostgreSQL

- `EXPLAIN` — odhadovaný plan
- `EXPLAIN ANALYZE` — skutečný plan s naměřenými časy
- Výstup ve formátu JSON (snáze parsovatelný) nebo TEXT

### SQLite

- `EXPLAIN QUERY PLAN` — zjednodušený plan
- Výstup jako tabulka s nested strukturou

### Zobrazení

- Stromová/tabulková vizualizace operací (Seq Scan, Index Scan, Hash Join, Sort, atd.)
- Zvýraznění nákladných operací (highest cost / actual time)
- Zobrazení odhadovaných vs. skutečných řádků (ANALYZE mode)

## Acceptance Criteria

- [ ] Tlačítko "Explain" v SQL editoru vedle "Run"
- [ ] Klávesová zkratka (Ctrl+E nebo podobná)
- [ ] PostgreSQL: podpora EXPLAIN i EXPLAIN ANALYZE
- [ ] SQLite: podpora EXPLAIN QUERY PLAN
- [ ] Stromové zobrazení plánu s odsazením operací
- [ ] Zvýraznění nejdražších operací (barevně)
- [ ] Zobrazení key metrics: cost, rows, actual time (kde dostupné)
- [ ] Výsledek se zobrazí ve speciálním tabu/panelu (ne jako datový grid)
