---
name: dotaz
description: Browse databases and run read-only queries through the running Dotaz app via the `dotaz` CLI. Use when you need to inspect a database the user has configured in Dotaz — list tables, read schema, sample rows, run SELECTs — or to open a table or SQL console in their app window. Triggers include "look at the database", "co je v tabulce X", "run this query", "show me the schema", "open this in Dotaz".
---

# Dotaz CLI

`dotaz` attaches to the user's running Dotaz desktop app and reuses its configured
connections. You never need credentials — the app already has them.

## Before anything else

```bash
dotaz status
```

Exit code 5 means the app is not running, or CLI access is off. Tell the user to launch
Dotaz and enable **Settings → Allow CLI access**. Do not try to connect to their database
another way.

## Reading data

Navigate with paths — `connection/database/schema/table`:

```bash
dotaz ls                              # connections
dotaz ls prod                         # databases
dotaz ls prod/app/public              # tables
dotaz describe prod/app/public/orders # columns, PK, indexes, FKs both directions
dotaz rows prod/app/public/orders --where "status='new'" --limit 20
dotaz query prod "SELECT count(*) FROM orders WHERE created_at > $1" --param 2024-01-01
```

Rules that matter:

- **Always bound your reads.** `rows` and `query` cap output, but a query that scans a huge
  table still costs the user time. Add `--limit`, and prefer `describe` over `SELECT *` when
  you only need shape.
- **Parameterise.** Use `--param` instead of pasting values into SQL.
- `--json` when you need to parse the result; the default table output is for humans.
- Truncated output says so on the last line. Do not conclude "the table has 20 rows" from a
  truncated result.

## Writes need the user

The CLI session is read-only at the database level. An INSERT/UPDATE/DELETE/DDL exits with
code 4. That is not a bug to route around — propose it instead:

```bash
dotaz propose prod "UPDATE orders SET status='paid' WHERE id=42" --reason "user asked to mark order 42 paid"
```

This opens the SQL in the user's app with Run/Reject buttons. `dotaz approvals wait <id>`
blocks until they decide (exit 7 = still pending, 8 = rejected). Tell the user you are
waiting on their approval rather than silently polling.

Never try to get around the read-only session — no `--param` injection, no DDL disguised as
a read, no asking the user for direct database credentials.

## Driving the app

```bash
dotaz ui state                                 # what the user currently has open
dotaz ui open prod/app/public/orders           # open a data grid tab
dotaz ui console prod --sql "SELECT …"         # open a SQL console, prefilled
```

`ui state` before `ui open` is usually worth it — it tells you which connection and database
the user is actually working in, so you can act in their context instead of guessing.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 2 | usage error |
| 3 | database error |
| 4 | read-only violation — use `dotaz propose` |
| 5 | Dotaz not running or CLI access disabled |
| 6 | timeout |
| 7 | proposal still pending |
| 8 | proposal rejected |

Full reference: `docs/agent-cli.md` in the dotaz repo.
