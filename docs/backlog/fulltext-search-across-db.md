# Full-text Search Across Database

**Tier**: 3 — Nice-to-have
**Type**: fullstack
**Inspiration**: DataGrip — Ctrl+Alt+Shift+F full-text search across tables

## Description

Vyhledávání textového řetězce napříč všemi tabulkami (nebo vybranými tabulkami) v databázi. Pomalé, ale neocenitelné když nevíte, kde se data nachází.

### Flow

1. Uživatel otevře "Search in Database" dialog
2. Zadá hledaný text
3. Vybere scope: celá databáze, konkrétní schéma, nebo vybrané tabulky
4. Spustí hledání
5. Výsledky zobrazí: tabulka → sloupec → řádek s matchem

### Implementace

- Pro každou tabulku v scope generovat SELECT s WHERE LIKE přes text-kompatibilní sloupce
- Dotazy spouštět sekvenčně (ne paralelně, aby se nepřetížila DB)
- Progress bar s názvem aktuálně prohledávané tabulky
- Možnost zrušit probíhající hledání
- Limit na počet výsledků per tabulka

## Acceptance Criteria

- [ ] Dialog pro full-text search s výběrem scope
- [ ] Prohledání text-kompatibilních sloupců ve vybraných tabulkách
- [ ] Výsledky seskupené dle tabulka → sloupec
- [ ] Progress indikace a možnost zrušení
- [ ] Klik na výsledek otevře tabulku s filtrovaným řádkem
- [ ] Limit na výsledky per tabulka (konfigurovatelný)
- [ ] Case-insensitive hledání
