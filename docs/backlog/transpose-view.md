# Transpose View

**Tier**: 1 — Rychlá výhra
**Type**: frontend
**Inspiration**: DataGrip — Transpose mode

## Description

Přepínač v toolbaru gridu pro transpozici zobrazení: řádky se stanou sloupci a sloupce řádky. Klíčové pro tabulky s mnoha sloupci (50+), kde horizontální scrollování je nepraktické.

V transponovaném režimu:

- Každý řádek původní tabulky = jeden sloupec
- Názvy sloupců jsou v prvním sloupci (jako row headers)
- Navigace šipkami funguje otočeně
- Lze kombinovat s existujícím sortováním a filtrováním

## Acceptance Criteria

- [ ] Tlačítko/toggle v grid toolbaru pro přepnutí transpose režimu
- [ ] Sloupce se zobrazí jako řádky a řádky jako sloupce
- [ ] Názvy sloupců tvoří první sloupec (row headers)
- [ ] Inline editace funguje i v transponovaném režimu
- [ ] Při přepnutí zpět se zachová stav (sort, filtry)
- [ ] Klávesová zkratka pro toggle
