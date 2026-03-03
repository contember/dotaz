# Value Editor Panel

**Tier**: 2 — Střední effort
**Type**: frontend
**Inspiration**: DataGrip — Value Editor side panel

## Description

Dedicovaný boční panel pro prohlížení a editaci hodnoty vybrané buňky. Automaticky se zobrazí při kliknutí na buňku (nebo přes toggle). Užitečné pro:

- **Dlouhé texty** — zobrazení s word-wrap místo oříznutí v buňce
- **JSON data** — formátovaný JSON s odsazením a syntax highlighting
- **XML data** — formátovaný XML
- **Binární data** — hex view nebo image preview

### Chování

- Panel se zobrazí na pravé straně gridu
- Obsah se aktualizuje při navigaci mezi buňkami
- Editace v panelu se propaguje zpět do gridu (pending changes)
- Toggle tlačítko pro zobrazení/skrytí panelu

## Acceptance Criteria

- [ ] Boční panel zobrazující hodnotu aktuálně vybrané buňky
- [ ] Automatická aktualizace při navigaci mezi buňkami
- [ ] JSON hodnoty se zobrazí s formátováním a syntax highlighting
- [ ] Dlouhé texty se zobrazí s word-wrap
- [ ] Editace v panelu se projeví jako pending change
- [ ] Toggle tlačítko v grid toolbaru
- [ ] Klávesová zkratka pro toggle
- [ ] Panel si pamatuje šířku (resizable)
