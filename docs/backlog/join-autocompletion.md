# JOIN Autocompletion

**Tier**: 3 — Nice-to-have
**Type**: frontend
**Inspiration**: DataGrip — JOIN completion s FK awareness

## Description

Při psaní JOIN klauzule v SQL editoru automaticky nabídnout celou JOIN podmínku na základě foreign key vztahů. Například:

Uživatel napíše `SELECT * FROM orders JOIN` a autocompletion nabídne:

```sql
customers ON orders.customer_id = customers.id
```

### Chování

- Po napsání `JOIN` nabídnout tabulky, které mají FK vztah s tabulkami v FROM
- Po výběru tabulky automaticky doplnit ON klauzuli dle FK
- Pokud existuje více FK mezi tabulkami, nabídnout výběr
- Funguje i pro LEFT JOIN, RIGHT JOIN, INNER JOIN

## Acceptance Criteria

- [ ] Po `JOIN` se v autocomplete přednostně nabízí FK-propojené tabulky
- [ ] Výběr tabulky automaticky doplní ON klauzuli
- [ ] Podpora více FK mezi stejnými tabulkami (nabídka výběru)
- [ ] Funguje pro všechny typy JOIN
- [ ] Využívá existující schema introspection data
