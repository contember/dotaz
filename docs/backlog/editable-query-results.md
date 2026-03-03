# Editable Query Results

**Tier**: 3 — Nice-to-have
**Type**: fullstack
**Inspiration**: DataGrip — Editable result sets (včetně JOIN queries)

## Description

Umožnit editaci buněk přímo ve výsledcích SELECT dotazu (nejen v table data view). Aktuálně jsou výsledky SQL dotazů read-only — editace funguje jen při otevření tabulky přes schema browser.

### Požadavky

- Dotaz musí obsahovat PK sloupce pro identifikaci řádků
- Systém detekuje zdrojovou tabulku z dotazu
- Po editaci buňky se vygeneruje UPDATE příkaz
- Funguje pro jednoduché SELECT dotazy (single table)
- Pro JOIN dotazy: editace buněk z jednoznačně identifikovatelné tabulky

### Omezení

- Nefunguje pro agregační dotazy (GROUP BY, HAVING)
- Nefunguje pro UNION dotazy
- Nefunguje pro subquery v SELECT
- Nefunguje bez PK v result setu

## Acceptance Criteria

- [ ] Výsledky jednoduchých SELECT dotazů jsou editovatelné (pokud obsahují PK)
- [ ] Editace generuje správný UPDATE příkaz
- [ ] Pending changes panel funguje i pro query results
- [ ] Vizuální indikace, že result set je editovatelný
- [ ] Výsledky bez PK nebo s agregacemi zůstávají read-only
- [ ] Indikace proč je result set read-only (chybí PK, agregace, atd.)
