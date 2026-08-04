# Agent CLI

`dotaz` — a command-line client that lets an AI agent (or a human) browse databases, run
read-only queries, submit writes for the user to approve, and drive the running desktop app.

This document is the implementation contract. Everything below is normative.

## Scope (v1)

- **Transport:** attach to a running desktop app only. No headless mode, no remote mode.
- **Data plane:** schema navigation + read-only queries, enforced by the database engine.
- **Control plane:** open tabs, prefill the SQL console, read what the user is looking at.
- **Writes:** never executed by the CLI. The CLI submits a _proposal_; the user approves it
  in the app and the app executes it.

## Invariants

1. The CLI's database session is opened read-only and is **never** switched to read-write.
   An approved write executes in the frontend's own session, not in the CLI session.
   No control-plane method may be used to get around this: `ui.openConsole` will prefill a
   write, but refuses to auto-run one (`run: true` is rejected for non-read-only SQL).
2. Read-only is enforced by the database engine, not by parsing SQL. Statement
   classification exists only to fail fast with a good message.
3. The control endpoint does not exist unless the user enabled it (`cli.enabled` setting or
   `DOTAZ_CLI=1`). No setting, no socket, no endpoint file.

## Transport

### Control server

The Electrobun backend process serves plain HTTP over a unix domain socket (macOS, Linux) or
loopback TCP (Windows). Not WebSocket — every CLI invocation is one-shot, and Bun's `fetch`
speaks unix sockets natively via `fetch(url, { unix })`.

| Route     | Method | Purpose                                              |
| --------- | ------ | ---------------------------------------------------- |
| `/health` | GET    | `{ ok, version, pid, protocol }` — no token required |
| `/rpc`    | POST   | `{ method, params }` → dispatch, token required      |

Auth: `x-dotaz-token` header, compared with `timingSafeEqual`. Required on `/rpc` even over a
unix socket.

The endpoint exposes an **allowlist**, not the app's full handler map
(`backend-shared/rpc/cli-surface.ts`). Connection mutation, import/export, settings writes
and anything that returns decrypted secrets stay unreachable, and `connections.list`
responses are stripped of passwords on the way out. `ui.snapshot.set` and
`agent.proposals.resolve` are frontend-only and equally unreachable. A forbidden method is
indistinguishable from a nonexistent one.

Socket path: `${XDG_RUNTIME_DIR ?? tmpdir()}/dotaz-${pid}.sock`. A stale socket at that path
is unlinked on startup.

### Endpoint discovery

One file per running instance, so two open windows never overwrite or delete each other's
endpoint: `${userData}/cli/endpoint-<pid>.json`, directory mode `0700`, files `0600`.

```jsonc
{
	"pid": 12345,
	"transport": "unix", // or "tcp"
	"socket": "/run/user/1000/dotaz-12345.sock",
	"port": null, // set when transport is "tcp"
	"token": "…64 hex chars…",
	"version": "0.0.42",
	"protocol": 1,
	"startedAt": 1717430000000
}
```

The CLI reads every file in that directory, drops the ones whose pid is no longer alive
(`process.kill(pid, 0)`), and connects to the newest surviving `startedAt`. `--instance <pid>`
picks a specific one — an unknown or dead pid is a usage error listing the live instances.
`--endpoint <file>` and `DOTAZ_ENDPOINT` still override with one explicit file. No live
instance, or a refused connection ⇒ exit code 5.

An instance prunes files belonging to dead pids at startup, and on shutdown (`exit`,
`SIGINT`, `SIGTERM`) removes only its own file and socket.

The transport follows the platform, but `DOTAZ_CLI_TRANSPORT=tcp|unix` overrides it — that
is how the Windows path gets tested on Linux.

### Wire format

The request/response envelope matches the existing web-mode WebSocket protocol so both
transports share one dispatcher (`backend-shared/rpc/dispatch.ts`):

```jsonc
// request
{ "method": "connections.list", "params": {} }
// response
{ "type": "response", "id": 0, "success": true, "payload": [ … ] }
{ "type": "response", "id": 0, "success": false, "error": "…", "errorCode": "…" }
```

## RPC surface

Existing handlers are reused wherever possible. New methods:

| Method                    | Params                                                       | Returns                            |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| `agent.hello`             | —                                                            | `{ version, mode, pid, protocol }` |
| `agent.proposeWrite`      | `{ connectionId, database?, sql, reason? }`                  | `{ proposalId }`                   |
| `agent.proposals.list`    | `{ status?, connectionId? }`                                 | `Proposal[]`                       |
| `agent.proposals.get`     | `{ proposalId }`                                             | `Proposal`                         |
| `agent.proposals.wait`    | `{ proposalId, timeoutMs? }`                                 | `Proposal` (long-poll)             |
| `agent.proposals.cancel`  | `{ proposalId }`                                             | `void`                             |
| `agent.proposals.resolve` | `{ proposalId, status, result?, error? }`                    | `Proposal` — **frontend only**     |
| `ui.state`                | —                                                            | `UiSnapshot`                       |
| `ui.openTable`            | `{ connectionId, database?, schema, table, where?, limit? }` | `{ ok: true }`                     |
| `ui.openConsole`          | `{ connectionId, database?, sql?, run? }`                    | `{ ok: true }`                     |
| `ui.runCommand`           | `{ commandId }`                                              | `{ ok: true }`                     |
| `ui.snapshot.set`         | `{ snapshot }`                                               | `void` — **frontend only**         |

`session.create` gains two optional params: `readOnly?: boolean` and `label?: string`.

### Backend → frontend messages

| Channel        | Payload                                                        |
| -------------- | -------------------------------------------------------------- |
| `cli.proposal` | `Proposal` — a write awaiting approval                         |
| `cli.command`  | `{ kind: 'open-table' \| 'open-console' \| 'run-command', … }` |

## Read-only sessions

`session.create { readOnly: true }` reaches `driver.reserveSession(sessionId, { readOnly })`:

| Driver     | Enforcement                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| PostgreSQL | `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` on the session's dedicated connection            |
| MySQL      | `SET SESSION TRANSACTION READ ONLY` on the session's dedicated connection                               |
| SQLite     | dedicated `SQL` handle for the session with `PRAGMA query_only = ON`; the session's queries route to it |

Read-only is not the same as cheap, so the same sessions also carry an engine-enforced
statement timeout, driven by the existing `queryTimeout` setting (30 s; `0` disables it):
`statement_timeout` on PostgreSQL, `MAX_EXECUTION_TIME` on MySQL — falling back to
`max_statement_time` on MariaDB, which has no `MAX_EXECUTION_TIME`. Both surface as
`QUERY_CANCELED`.

**SQLite has no cap.** `bun:sqlite` exposes neither an interrupt nor a progress handler, and
`busy_timeout` bounds lock waits rather than query runtime, so an agent session against
SQLite can still run an unbounded scan. Nothing here fakes it with a client-side race that
would leave the query running.

Normal UI sessions never get a cap — a deliberate ten-minute report from the SQL console must
keep working.

On top of that, `QueryExecutor` rejects a statement classified as a write before it reaches
the driver, with error code `READ_ONLY_SESSION`. `classifyStatement()` in
`shared/sql/statements.ts` returns `'read' | 'write' | 'ddl' | 'unknown'`; `'unknown'` is
treated as a write (fail closed).

## Proposals

```ts
type ProposalStatus =
	| 'pending'
	| 'approved'
	| 'rejected'
	| 'executed'
	| 'failed'
	| 'cancelled'
	| 'expired'

interface Proposal {
	id: string
	connectionId: string
	database?: string
	sql: string
	reason?: string
	status: ProposalStatus
	createdAt: number
	resolvedAt?: number
	result?: { affectedRows?: number; statements?: number }
	error?: string
}
```

Lifecycle:

1. CLI calls `agent.proposeWrite` → store creates a `pending` proposal, backend emits
   `cli.proposal` to the frontend.
2. Frontend opens a SQL console tab with the SQL prefilled and a banner offering Run / Reject.
3. On Run the frontend executes the SQL in the tab's own session, then calls
   `agent.proposals.resolve` with `executed` (or `failed` + error). On Reject it resolves
   `rejected`.
4. `agent.proposals.wait` returns as soon as the status leaves `pending`, or on timeout.

Proposals live in memory for one hour, then become `expired`. `pending` is the only status
the frontend may act on.

## CLI

Package `@dotaz/agent-cli` in `src/cli-agent/`, binary `dotaz`. (`@dotaz/cli` is already
taken by the web-server CLI in `src/cli/`.)

Paths address objects as `connection/database/schema/table`. A connection is matched by id,
by exact name, or by a unique case-insensitive prefix. Drivers without databases or schemas
(SQLite) accept the shortened form `connection/table`.

```
dotaz status                                   # is the app running, is CLI access enabled
dotaz ls [path]                                # connections → databases → schemas → tables
dotaz describe <path>                          # columns, PK, indexes, foreign keys both ways
dotaz rows <path> [--where] [--order] [--limit] [--offset] [--columns]
dotaz query <conn[/db]> <sql> [--param v]… [--limit]
dotaz explain <conn[/db]> <sql> [--analyze]
dotaz search <conn[/db]> <term> [--scope database|schema|table]
dotaz history [--conn] [--limit]
dotaz propose <conn[/db]> <sql> [--reason] [--wait [sec]]
dotaz approvals list | status <id> | wait <id> [--timeout sec] | cancel <id>
dotaz ui state
dotaz ui open <path> [--where]
dotaz ui console <conn[/db]> [--sql] [--run]
dotaz ui command <command-id>
```

Global flags: `--json`, `--format table|json|jsonl|csv|md`, `--max-bytes N` (default 65536),
`--timeout ms`, `--endpoint <file>`, `--instance <pid>`, `--quiet`.

Output rules:

- Default format is a compact aligned table on stdout; diagnostics go to stderr.
- Row output is always capped. When truncated, the last line states
  `rows: 20/1543 (truncated, use --limit)`.
- `--json` emits a single object; `--format jsonl` emits one row per line.

Exit codes:

| Code | Meaning                                           |
| ---- | ------------------------------------------------- |
| 0    | success                                           |
| 2    | usage error                                       |
| 3    | database error (`errorCode` printed when present) |
| 4    | read-only violation — use `dotaz propose`         |
| 5    | Dotaz is not running or CLI access is disabled    |
| 6    | timeout                                           |
| 7    | proposal still pending                            |
| 8    | proposal rejected                                 |

## Enabling CLI access

Off by default. `cli.enabled` in app settings (Settings UI toggle), or `DOTAZ_CLI=1` in the
environment. Toggling the setting starts or stops the control server without a restart.
