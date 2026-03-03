# Color Coding Connections

**Tier**: 3 — Nice-to-have
**Type**: fullstack
**Inspiration**: DataGrip — Color coding data sources

## Description

Přiřazení barvy k connection pro vizuální odlišení prostředí. Typické použití:

- **Červená** — produkce (pozor!)
- **Zelená** — development
- **Žlutá** — staging
- **Modrá** — testing

Barva se projeví jako:

- Barevný proužek ve status baru
- Barevný indikátor v connection tree
- Volitelně: obarvení rámečku celého okna

### Výběr barvy

- Předdefinovaná paleta (8–12 barev)
- Nastavení v Connection dialogu

## Acceptance Criteria

- [ ] Výběr barvy v Connection dialogu (paleta předdefinovaných barev)
- [ ] Barevný indikátor v connection tree
- [ ] Barevný proužek ve status baru pro aktivní connection
- [ ] Barva persistuje v app databázi
- [ ] Výchozí barva: žádná (neutrální)
