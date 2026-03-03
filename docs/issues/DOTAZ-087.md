# DOTAZ-087: SSH tunnel for PostgreSQL connections

**Phase**: 12 — DBeaver Parity
**Type**: fullstack
**Dependencies**: [DOTAZ-012]

## Description

Support SSH tunneling for PostgreSQL connections. Essential for accessing production and staging databases behind a bastion host / jump server.

### Configuration in Connection Dialog

- SSH host, port (default 22), username
- Authentication: password or SSH key (file path + optional passphrase)
- Optional: custom local port (otherwise auto-assign)

### Behavior

- Tunnel is created automatically on connect and torn down on disconnect
- Backend spawns SSH tunnel (e.g. via `ssh2` library or Bun subprocess with `ssh -L`)
- Local port forwarding: `localhost:localPort → remoteHost:remotePort`
- PG driver connects to `localhost:localPort` transparently

### Architecture

- SSH tunnel runs on the backend side (Bun process)
- Frontend only configures parameters in the Connection dialog
- SSH config stored in app database (key as file path, not content)

## Files

- `src/backend-shared/services/ssh-tunnel.ts` — SSH tunnel manager (create, destroy, health check)
- `src/shared/types/connection.ts` — add SSH tunnel fields to connection config
- `src/backend-shared/services/connection-manager.ts` — integrate tunnel lifecycle with connect/disconnect
- `src/frontend-shared/components/connection/ConnectionDialog.tsx` — SSH tunnel config section
- `src/backend-shared/rpc/rpc-handlers.ts` — pass SSH config through connection RPC

## Acceptance Criteria

- [ ] SSH Tunnel section in Connection dialog (collapsible, default off)
- [ ] Configuration: host, port, username
- [ ] Password authentication
- [ ] SSH key authentication (file picker + optional passphrase)
- [ ] Tunnel automatically created on Connect and destroyed on Disconnect
- [ ] Works with existing PG driver transparently
- [ ] Error messages on tunnel failure (timeout, auth failed, host unreachable)
- [ ] SSH config persists in app database
