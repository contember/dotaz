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

1. Every CLI database operation runs in a backend-owned read-only session that is **never**
   switched to read-write. An approved write runs in the console tab (a click in the app's window) or
   in a session created only after a verified remote approval (see
   [Remote approvals](#remote-approvals)), never in an agent session.
   No control-plane method may be used to get around this: `ui.openConsole` and
   `ui.openTable`'s `where` only prefill the console or the filter box. Agent SQL reaches the
   app's writable session only when the user runs or applies it. `where` must also be a single
   boolean expression, so applying what looks like a filter cannot run a hidden statement.
2. Read-only is enforced by the database engine, not by parsing SQL. Statement classification
   exists only to fail fast with a good message. The one thing parsing must get right is that a
   read-only session runs exactly one statement per engine round-trip: a multi-statement string
   could flip the session to read-write between statements (`… ; SET SESSION … READ WRITE ;
   COMMIT ; INSERT …`), which the engine cannot catch on its own. The guard rejects anything not
   provably a single statement, using a dialect-aware, fail-closed scanner (`isSingleStatement`).
3. The control endpoint does not exist unless the user enabled it (`cli.enabled` setting or
   `DOTAZ_CLI=1`). No setting, no socket, no endpoint file.

The endpoint enforces invariant 1 itself. It exposes only the operation-level `agent.query`,
`agent.schema`, and `agent.search` methods. Their backend handlers create, verify, and destroy
the read-only session internally. Generic `session.*`, `query.execute`, `schema.load`, and
`search.searchDatabase` methods are not exposed, and session IDs never cross the CLI boundary.

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

Also absent, and worth naming because each was reachable at one point: all `session.*`
methods, the generic data methods `query.execute`, `schema.load`, and
`search.searchDatabase`, and `ui.runCommand` (it could execute any registered app command,
including `run-query` in the frontend's writable session).

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

An instance prunes files belonging to dead pids at startup, and on a graceful shutdown
(closing the window, or switching the setting off) removes only its own file and socket.

A killed instance leaves both behind: Electrobun installs its own signal handlers and exits
through a native quit, so neither our signal handlers nor `process.on('exit')` get a turn.
Nothing depends on that cleanup — the next instance prunes dead pids at startup, and the CLI
skips any endpoint whose pid is gone. Verified: after `kill -TERM`, `dotaz status` reports
`pid <n> is not running` and exits 5.

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

| Method                    | Params                                                            | Returns                            |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| `agent.hello`             | —                                                                 | `{ version, mode, pid, protocol }` |
| `agent.schema`            | `{ connectionId, database? }`                                     | `SchemaData`                       |
| `agent.query`             | `{ connectionId, database?, sql, queryId, params?, searchPath? }` | `QueryResult[]`                    |
| `agent.search`            | `{ connectionId, database?, searchTerm, scope, … }`               | `SearchDatabaseResult`             |
| `agent.proposeWrite`      | `{ connectionId, database?, sql, reason?, requestedBy? }`         | `{ proposalId }`                   |
| `agent.proposals.list`    | `{ status?, connectionId? }`                                      | `Proposal[]`                       |
| `agent.proposals.get`     | `{ proposalId }`                                                  | `Proposal`                         |
| `agent.proposals.wait`    | `{ proposalId, timeoutMs? }`                                      | `Proposal` (long-poll)             |
| `agent.proposals.cancel`  | `{ proposalId }`                                                  | `void`                             |
| `agent.proposals.resolve` | `{ proposalId, status, result?, error? }`                         | `Proposal` — **frontend only**     |
| `ui.state`                | —                                                                 | `UiSnapshot`                       |
| `ui.openTable`            | `{ connectionId, database?, schema, table, where?, limit? }`      | `{ ok: true }`                     |
| `ui.openConsole`          | `{ connectionId, database?, sql? }`                               | `{ ok: true }`                     |
| `ui.snapshot.set`         | `{ snapshot }`                                                    | `void` — **frontend only**         |

Remote approvals add these (see [Remote approvals](#remote-approvals)):

| Method                      | Params                                                                                        | Returns                                      |
| --------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `approvers.request`         | `{ label, rpId, origin, credentialId, publicKey }`                                            | `{ requestId, fingerprint, expiresAt }`      |
| `approvers.list`            | (none)                                                                                        | `RemoteApprover[]` (public data only)        |
| `agent.approvals.challenge` | `{ proposalId, decision: 'approve' \| 'reject' }`                                             | `ApprovalChallenge`                          |
| `agent.approvals.redeem`    | `{ proposalId, decision, nonce, credentialId, authenticatorData, clientDataJSON, signature }` | `Proposal` (settled)                         |
| `approvers.pending`         | (none)                                                                                        | `ApproverRequest \| null`, **frontend only** |
| `approvers.confirm`         | `{ requestId, fingerprint }`                                                                  | `RemoteApprover`, **frontend only**          |
| `approvers.decline`         | `{ requestId }`                                                                               | `void`, **frontend only**                    |
| `approvers.remove`          | `{ id }`                                                                                      | `void`, **frontend only**                    |

### Backend → frontend messages

| Channel             | Payload                                                       |
| ------------------- | ------------------------------------------------------------- |
| `cli.proposal`      | `Proposal` — emitted on every state change, not only creation |
| `cli.command`       | `{ kind: 'open-table' \| 'open-console', … }`                 |
| `approvers.changed` | `{ request, approvers }`: a pairing request or the key list   |

## Read-only sessions

Each `agent.query`, `agent.schema`, and `agent.search` call creates a session with
`readOnly: true`. The handler checks that the driver confirmed it as read-only, runs exactly
one operation, and destroys the session in `finally`. The CLI neither creates sessions nor
receives their IDs. If the CLI disconnects mid-request, the backend handler keeps ownership
and releases the session when the operation ends.

Creating the session reaches `driver.reserveSession(sessionId, { readOnly: true })`:

| Driver     | Enforcement                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| PostgreSQL | `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` on the session's dedicated connection         |
| MySQL      | `SET SESSION TRANSACTION READ ONLY` on the session's dedicated connection                            |
| SQLite     | dedicated handle opened `readonly`, plus `PRAGMA query_only = ON`; the session's queries route to it |

Neither mechanism protects itself, so both are re-established rather than set once:

- PostgreSQL's `default_transaction_read_only` is an ordinary GUC, and
  `SELECT set_config('default_transaction_read_only','off',false)` classifies as a _read_. The
  driver therefore re-asserts the session characteristics (and the timeout) before every
  statement. Verified against PostgreSQL 17: re-asserting blocks the write, and a single
  statement cannot both clear the GUC and write under it. That re-assert runs once per
  `execute()`, so it only holds if `execute()` receives one statement at a time — which is why a
  read-only session rejects multi-statement input (`isSingleStatement`) before running it.
- SQLite's `PRAGMA query_only` can be revoked with `PRAGMA query_only(0)` — the function form
  carries no `=`, so it too classifies as a read. The handle is opened read-only at the VFS
  level, which no statement can revoke; the pragma is a second layer.
- An unknown `sessionId` throws on every driver. SQLite used to fall through to the shared
  writable handle, which silently downgraded a session whose handle had been lost.

`SessionInfo.readOnly` is read back from `driver.isSessionReadOnly()`, not echoed from the
request. A session the driver does not confirm as read-only is released and refused before
the operation starts.

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
	connectionName: string // frozen at creation
	database?: string
	sql: string // frozen at creation: exactly what is shown, signed and run
	reason?: string
	requestedBy?: string // free text from the CLI, unverified
	status: ProposalStatus
	createdAt: number
	resolvedAt?: number
	resolvedVia?: 'app' | 'remote'
	approver?: string // label of the paired key that decided remotely
	result?: { affectedRows?: number; statements?: number }
	error?: string
}
```

Lifecycle:

1. CLI calls `agent.proposeWrite` → store creates a `pending` proposal, backend emits
   `cli.proposal` to the frontend.
2. Frontend opens a SQL console tab with the SQL prefilled and a banner offering Run / Reject.
3. Before anything in the proposal's tab reaches the database — banner Run, toolbar Run or
   Ctrl+Enter alike — the frontend claims the proposal with `agent.proposals.resolve`
   `approved`. From then on the agent cannot cancel it and it cannot expire. After the run the
   frontend resolves `executed` (or `failed` + error). On Reject it resolves `rejected`.
   EXPLAIN ANALYZE, which executes the statement, is refused while the banner is live. Once a
   banner is invalidated, the unchanged proposal SQL is refused too: confirming a destructive-
   statement warning opened before the agent cancelled must not run it.
   The run is matched to the proposal by tab _and_ by SQL. If the user edited the console, or
   ran one statement of a multi-statement proposal, the proposal resolves `failed`, with an
   error saying that different SQL ran and may have changed data. If the app stopped waiting
   for the result (timeout, cancel, lost connection), it resolves `failed` with an error saying
   the outcome is unknown. So `executed` means the proposed SQL ran, not merely that
   something ran in that tab.
4. `agent.proposals.wait` returns once the proposal is settled — neither `pending` nor
   `approved` — or on timeout.

Proposals live in memory for one hour, then a `pending` one becomes `expired`. `pending` is
the only status the frontend may claim, and `approved` may only move to `executed` or
`failed`. A claim the app never settles (reload, lost reply) becomes `failed` with an
unknown-outcome error an hour after the claim. At most 20 proposals may be pending at once; `agent.proposeWrite` refuses more.

A proposal can also leave `pending` behind the app's back — the agent cancels it, the TTL
expires it, or another window resolves it. The backend therefore emits `cli.proposal` on
every transition, and the app invalidates that banner: the tab stays, Run and Reject go away.
Because the message may not have arrived yet, the claim is what decides: it fails for a
proposal that is no longer `pending`, and nothing runs. Without it, a click on a stale banner
would run a write for a proposal that no longer exists.

## Remote approvals

Approve or reject a proposal with a passkey from a paired device (a phone with Face ID, a laptop
with Touch ID), without a click in the app's window. Off in practice until the user pairs a key:
with no paired keys every challenge is refused and nothing changes.

### Threat model

The endpoint token is readable by any process running as the user, so everything on the CLI
surface is open to every such process. Remote approvals keep invariant 1 against that caller:

- **The signature is the proof, not the caller.** Dotaz runs a write only for a WebAuthn
  assertion, made with user verification, by a key the user paired, over a challenge Dotaz
  recomputes from its own one-time nonce and its own stored proposal. The private key never
  leaves the authenticator, so nothing on this machine can produce that assertion.
- **The CLI can ask to pair a key, never add one.** `approvers.request` only creates a request.
  The app's window shows it with its label, origin, relying party and fingerprint; the user
  compares the fingerprint with the one the requesting device shows and clicks Pair. Confirming,
  declining and removing keys are frontend-only methods, absent from the CLI allowlist.
- **What is signed is what runs.** The signed bytes cover the SQL hash, the connection and the
  database. A page that showed different SQL produces a signature that does not verify, and the
  proposal's SQL is frozen when it is created.
- **Another page cannot borrow the key.** The browser writes the true origin into
  `clientDataJSON`; Dotaz accepts only the origin the key was paired with, and the relying
  party hash in the authenticator data must match the paired RP id.

Not covered: a process that edits Dotaz's app database or binary, or drives its window through
accessibility APIs. Such a process could equally read the saved credentials and connect to the
database directly; the gate cannot be stronger than the user account.

### Approver keys

Stored in the app database (`remote_approvers`): `{ id, label, rpId, origin, credentialId,
publicKey, fingerprint, addedAt }`. ES256 (ECDSA P-256) only; `publicKey` is the base64url
COSE_Key from the credential's attested data. `approvers.list` returns everything except the
public key.

Pairing request rules: one request at a time (a second one is refused, never replaces the first),
expires after 5 minutes, at most 5 per hour, at most 20 paired keys. `origin` must be an
`https` origin whose host is `rpId` or a subdomain of it (or `http://localhost…` for rpId
`localhost`). The public key must parse as exactly one COSE EC2 P-256 ES256 map.

**Fingerprint:** the first 16 characters (80 bits) of RFC 4648 base32 (uppercase, no padding)
of `SHA-256(credentialId bytes || publicKey bytes)`. The window shows it in groups of four.

### Challenge and signed bytes

`agent.approvals.challenge` returns:

```ts
interface ApprovalChallenge {
	nonce: string // base64url, 32 random bytes
	expiresAt: number
	proposal: {
		id: string
		connectionId: string
		connectionName: string
		database: string | null
		sql: string
		sqlSha256: string // lowercase hex over the UTF-8 bytes of sql
		reason: string | null
		requestedBy: string | null
		createdAt: number
		statements: number
	}
	allowCredentials: string[] // base64url credential ids of paired keys
}
```

A nonce is bound to one proposal and one decision, good for 2 minutes and for one redeem attempt,
good or bad. At most 16 may be outstanding. Anyone may ask for one: a challenge by itself does
nothing.

The WebAuthn challenge is the 32-byte digest

```
SHA-256(UTF-8("dotaz-approval/v1\n" + JSON.stringify([nonce, decision, id, connectionId,
        connectionName, database, sqlSha256, reason, requestedBy, createdAt])))
```

with `null` for absent optional fields. `sqlSha256` is over the exact stored string: nothing is
trimmed or normalised anywhere. `approvalChallengeBytes()` in `shared/remote-approval.ts` is the
reference implementation and runs in a browser. An approving page should compute these bytes
itself from the fields it renders, not take them from a server.

### Redeem

`agent.approvals.redeem` takes the assertion fields base64url-encoded. Dotaz checks, in order:
the nonce is its own, unused and unexpired, and was issued for this proposal and decision; the
credential id belongs to a paired key; the proposal is still `pending`; `clientDataJSON.type` is
`webauthn.get`, its `challenge` equals the bytes above recomputed from the stored proposal, its
`origin` equals the key's paired origin and `crossOrigin` is not true; the authenticator data's
RP id hash matches the key's `rpId`; the user-present and user-verified flags are set; the ES256
signature over `authenticatorData || SHA-256(clientDataJSON)` verifies with the paired key.

Only then does it act:

- **reject**: `pending → rejected`. Nothing runs.
- **approve**: claims the proposal atomically (`pending → approved`), so a click in the window
  and a remote approval can never both run it, and the window can no longer settle it. It then
  runs the frozen `proposal.sql` in a read-write session created for this run only, in one
  transaction, and resolves `executed` with `affectedRows`, or `failed` with the error after a
  rollback. No rows are ever returned. The run is recorded in Query History.

Both record `resolvedVia: 'remote'` and the key's label in `approver`. Refusals carry
`errorCode` `APPROVAL_UNAVAILABLE` (no keys paired) or `APPROVAL_REFUSED` (anything else; the
message names the check). Pairing refusals carry `PAIRING_REFUSED`.

### Never approved remotely

Approving is refused (at the challenge and again at redeem) when the SQL is over 64 KB of UTF-8,
or the SQL, the reason or the database name contains bidirectional or invisible format characters
(`\p{Cf}`), U+2028/U+2029, or C0/C1 control characters other than tab, line feed and carriage
return; when the SQL contains its own transaction control (`BEGIN`, `COMMIT`, `ROLLBACK`, …);
or when the connection is gone, not connected or marked read-only in Dotaz. Rejecting such a
proposal remotely is allowed, and it can still be run from the app's window.

### Who asked

`dotaz propose --by <label>` (or `DOTAZ_REQUESTED_BY` in the environment) stores a free-text
label on the proposal: up to 120 characters on one line, no control or format characters. The
approver is shown it as unverified.

## CLI

Public package `@dotaz/cli`, binary `dotaz`. Its private source workspace lives in
`src/cli-agent/`; `scripts/build-agent-cli.ts` bundles it and `@dotaz/shared` into the
dependency-free `dist-agent-cli/` package published by the tag-driven release workflow.

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
dotaz bookmarks list [--conn] [--search]
dotaz propose <conn[/db]> <sql> [--reason] [--by label] [--wait [sec]]
dotaz approvals list | status <id> | wait <id> [--wait sec] | cancel <id>
dotaz ui state
dotaz ui open <path> [--where]                 # --where is prefilled, the user applies it
dotaz ui console <conn[/db]> [--sql]
```

Global flags: `--json`, `--format table|json|jsonl|csv|md`, `--max-bytes N` (default 65536),
`--timeout ms`, `--endpoint <file>`, `--instance <pid>`, `--quiet`.

Output rules:

- Default format is a compact aligned table on stdout; diagnostics go to stderr.
- Row output is always capped, and truncation is always reported — `--quiet` silences
  diagnostics, never a missing row. `table`/`md` end with `rows: 20/1543 (truncated, use
  --limit)`; `--json` carries `truncated`/`shown`/`total` inside the object; `csv`/`jsonl`
  keep stdout a clean stream and report on stderr.
- `--json` emits a single object; `--format jsonl` emits one row per line.
- `--limit` on `query` is pushed into the SQL when the statement is a single unlimited
  read-only `SELECT`/`WITH` with no `OFFSET`, locking clause or `INTO` — so the database
  stops early. Anything else falls back to trimming the printed rows, and the CLI says which
  of the two happened. The distinction matters: only the first one bounds what the database
  actually does.
- A timed-out or interrupted query is cancelled in the app (`query.cancel`) rather than left
  running. The `agent.query` handler then releases its session in `finally`, and the CLI
  reports whether the cancel succeeded.

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
