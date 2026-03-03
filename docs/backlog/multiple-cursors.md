# Multiple Cursors v SQL editoru

**Tier**: 3 — Nice-to-have
**Type**: frontend
**Inspiration**: DataGrip — Multiple cursors, column selection

## Description

Aktivovat podporu multiple cursors v CodeMirror editoru. CodeMirror 6 toto nativně podporuje, stačí zapnout příslušné rozšíření.

### Operace

- **Alt+Click** — přidání dalšího kurzoru
- **Ctrl+D** — vybrat další výskyt aktuálního slova
- **Alt+Shift+I** — kurzor na konec každého vybraného řádku
- **Column selection** — Alt+Shift+Drag pro blokový výběr

## Acceptance Criteria

- [ ] Alt+Click přidá kurzor na kliknuté místo
- [ ] Ctrl+D vybere další výskyt aktuálního slova
- [ ] Psaní s více kurzory edituje všechny pozice současně
- [ ] Escape zruší extra kurzory a vrátí na jeden
