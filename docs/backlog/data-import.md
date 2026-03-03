# Data Import (CSV/JSON → tabulka)

**Tier**: 2 — Střední effort, zásadní feature
**Type**: fullstack
**Inspiration**: DataGrip — CSV/Excel import s column mappingem

## Description

Import dat ze souboru (CSV, JSON) do existující tabulky. Přirozený protějšek k existujícímu exportu.

### Flow

1. Uživatel vybere cílovou tabulku a klikne "Import"
2. Vybere soubor (CSV nebo JSON)
3. Dotaz zobrazí náhled dat a mapping sloupců: sloupce ze souboru → sloupce tabulky
4. Uživatel může upravit mapping, přeskočit sloupce, nastavit výchozí hodnoty
5. Kliknutím na "Import" se data vloží pomocí batched INSERT příkazů

### Podporované formáty

- **CSV**: konfigurovatelný delimiter (comma, semicolon, tab), header row on/off
- **JSON**: pole objektů (`[{col: val}, ...]`)

### Bezpečnost

- Import probíhá v transakci — při chybě se provede rollback
- Preview prvních N řádků před samotným importem
- Zobrazení počtu importovaných řádků po dokončení

## Acceptance Criteria

- [ ] Import dialog dostupný z context menu tabulky
- [ ] Podpora CSV a JSON formátu
- [ ] Náhled importovaných dat před potvrzením
- [ ] Column mapping (soubor → tabulka) s možností přeskočení sloupců
- [ ] Konfigurovatelný CSV delimiter a header row
- [ ] Import v transakci s rollbackem při chybě
- [ ] Progress indikace pro velké soubory
- [ ] Zobrazení výsledku (počet importovaných řádků)
