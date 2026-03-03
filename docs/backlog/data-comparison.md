# Data Comparison

**Tier**: 2 — Střední effort
**Type**: fullstack
**Inspiration**: DataGrip — Compare Data (tabulky, query result sety)

## Description

Porovnání dat mezi dvěma tabulkami nebo dvěma výsledky query. Výsledek zobrazí rozdíly side-by-side s barevným zvýrazněním.

### Scénáře použití

- Porovnání stejné tabulky na dvou různých databázích (staging vs. production)
- Porovnání dvou tabulek ve stejné databázi
- Porovnání dvou query výsledků

### Zobrazení

- Side-by-side grid s barevně zvýrazněnými rozdíly
- Řádky jen vlevo (červené), jen vpravo (zelené), odlišné hodnoty (žluté)
- Sloupcový mapping (automatický dle názvů, manuální úprava)
- Statistika: počet shodných, přidaných, odebraných, změněných řádků

### Porovnávání

- Matching řádků dle PK nebo uživatelem vybraných klíčových sloupců
- Tolerance parametr: kolik sloupců smí být odlišných

## Acceptance Criteria

- [ ] Dialog pro výběr dvou zdrojů dat k porovnání
- [ ] Automatický column mapping dle názvů sloupců
- [ ] Side-by-side zobrazení s barevnými rozdíly
- [ ] Statistika rozdílů (shodné, přidané, odebrané, změněné)
- [ ] Matching dle PK nebo vybraných sloupců
- [ ] Funguje across connections (různé databáze)
