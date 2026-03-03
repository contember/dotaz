# Bookmarks / Oblíbené dotazy

**Tier**: 3 — Nice-to-have
**Type**: fullstack
**Inspiration**: DataGrip — Bookmarks, Virtual views

## Description

Ukládání oblíbených SQL dotazů pro rychlý přístup. Na rozdíl od query history (automatické), bookmarks jsou explicitně uložené uživatelem s vlastním pojmenováním.

### Features

- Uložit aktuální SQL dotaz jako bookmark s názvem a volitelným popisem
- Seznam bookmarks v sidebar panelu nebo dialogu
- Klik na bookmark vloží SQL do editoru
- Organizace do složek/kategorií
- Per-connection nebo globální bookmarks

### Rozdíl od Saved Views

Saved Views ukládají stav gridu (filtry, sort, sloupce). Bookmarks ukládají SQL dotazy.

## Acceptance Criteria

- [ ] Uložit SQL dotaz jako bookmark (Ctrl+D nebo context menu)
- [ ] Pojmenování a volitelný popis
- [ ] Seznam bookmarks s možností vyhledávání
- [ ] Klik na bookmark otevře SQL v editoru
- [ ] Editace a mazání bookmarks
- [ ] Bookmarks persistují v app databázi
