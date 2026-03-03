# Grid Heatmaps

**Tier**: 3 — Nice-to-have
**Type**: frontend
**Inspiration**: DataGrip — Grid heatmaps (Diverging, Sequential)

## Description

Barevné škály na numerických sloupcích v data gridu pro rychlou vizuální analýzu rozložení dat. Uživatel zapne heatmap per sloupec nebo pro celou tabulku.

### Režimy

- **Sequential** — od světlé po tmavou (pro hodnoty od minima po maximum)
- **Diverging** — od modré přes bílou po červenou (pro hodnoty s neutrálním středem)

### Chování

- Barva pozadí buňky dle relativní hodnoty v rámci sloupce
- Min/max se počítají z aktuálně zobrazených dat
- Přepínač v context menu hlavičky sloupce
- NULL hodnoty se nezabarvují

## Acceptance Criteria

- [ ] Context menu na hlavičce sloupce: "Apply Heatmap"
- [ ] Podpora Sequential barevné škály
- [ ] Podpora Diverging barevné škály
- [ ] Barvy se počítají z min/max aktuálně zobrazených dat
- [ ] NULL hodnoty nemají heatmap barvu
- [ ] Funguje pouze na numerických sloupcích
- [ ] Přepínač pro zapnutí/vypnutí per sloupec
