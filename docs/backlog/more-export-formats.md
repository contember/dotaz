# Další export formáty

**Tier**: 2 — Nízký–střední effort
**Type**: fullstack
**Inspiration**: DataGrip — Markdown, XML, HTML, SQL UPDATE

## Description

Rozšířit stávající export (CSV, JSON, SQL INSERT) o další užitečné formáty:

### Nové formáty

- **Markdown tabulka** — pro vkládání do dokumentace, GitHub issues, README
- **SQL UPDATE** — generuje UPDATE příkazy místo INSERT (užitečné pro migraci dat)
- **HTML tabulka** — pro sdílení v emailech, prezentacích
- **XML** — strukturovaný XML výstup

### Priorita formátů

1. Markdown — jednoduchá implementace, vysoká užitečnost
2. SQL UPDATE — logické doplnění k SQL INSERT
3. HTML — jednoduché
4. XML — méně časté, ale kompletní

## Acceptance Criteria

- [ ] Markdown tabulka export s korektním formátováním
- [ ] SQL UPDATE export s WHERE klauzulí dle PK
- [ ] HTML tabulka export
- [ ] Všechny nové formáty dostupné v Export dialogu
- [ ] Fungují se všemi export scopy (celá tabulka, current view, selected rows)
- [ ] Preview v export dialogu pro každý formát
