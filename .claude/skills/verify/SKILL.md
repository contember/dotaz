---
name: verify
description: How to run and verify the dotaz web server locally — build, launch, drive the auth/RPC surface.
---

# Verifying dotaz (web mode)

## Build & launch

Port 6401 may be taken by a local Docker container (`tuzex-dotaz-1`) — use a spare port.

```bash
bun run build:web    # refresh dist/ so the served frontend matches the working tree

# loopback mode (no token auth)
DOTAZ_ENCRYPTION_KEY=test-key DOTAZ_PORT=6411 DOTAZ_HOST=localhost bun src/backend-web/server.ts &

# token mode (non-loopback bind; generated token is printed to stdout)
DOTAZ_ENCRYPTION_KEY=test-key DOTAZ_PORT=6412 DOTAZ_HOST=0.0.0.0 bun src/backend-web/server.ts &
```

Wait for readiness with a curl retry loop against `/api/bootstrap` (starts in <1s). Kill by port: `lsof -ti:<port> | xargs -r kill` — never `pkill -f` with a pattern that appears in your own compound command (it kills the shell).

## Driving the surface

- HTTP auth branches: curl `/api/bootstrap` with combinations of `Host:`, `Origin:`, `Sec-Fetch-Site:`, `Cookie: dotaz_rpc_token=…`, `Authorization: Bearer …`.
- WS upgrade: curl `/rpc` with `Connection: Upgrade`, `Upgrade: websocket`, `Sec-WebSocket-Version: 13`, `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==` and an `Origin:`. A 101 hangs the connection — add `--max-time 2`.
- Browser flow: `agent-browser --session <name> open http://localhost:<port>` — the app shell renders only after `/api/bootstrap` returns 200. Clicking "Load Demo Database" does a real RPC round-trip over the WS (errors surface as a toast; "Demo database paths not configured" just means `bun run seed:sqlite` wasn't run).
- Token provisioning: open `/?rpcToken=<token>` and check the URL comes back stripped.

## Gotchas

- `bun test` needs `docker compose up -d` for the pg/mysql driver tests (ports 5488/3388); without it ~22 fail with connection errors — environmental, not a regression.
- `dist/` is untracked; rebuilding it never dirties git status.
