# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also: `src/frontend-shared/CLAUDE.md` (frontend), `src/shared/CLAUDE.md` (shared types).

## Project

Dotaz is a database client built on **Electrobun** (Bun backend + system webview) with a **Solid.js** frontend. It supports PostgreSQL, MySQL, and SQLite, focused on DML operations (viewing, editing, querying data) — no DDL/schema management.

Runs in three modes:

- **Desktop** (Electrobun) — native window with RPC transport, app state in backend SQLite
- **Web** — standalone Bun HTTP/WebSocket server (`bun run dev:web`), app state in browser IndexedDB. Can also be started via CLI (`bunx @dotaz/server`, see `src/cli/`)
- **Demo** — browser-only with WASM SQLite, no server needed (`bun run dev:demo`)

## Commands

```bash
# Development — desktop (Vite HMR + Electrobun)
bun run dev

# Development — web mode (HTTP + WebSocket)
bun run dev:web

# Development — demo mode (browser-only WASM SQLite)
bun run dev:demo

# Production build (desktop / Electrobun)
bun run build:canary

# Production build (web server)
bun run build:server

# Type checking (must pass with zero errors)
bunx tsc --noEmit

# Lint & format
bun run lint          # check lint (biome)
bun run lint:fix      # auto-fix lint
bun run format        # format (dprint)
bun run format:check  # check formatting

# Run all tests
bun test

# Run a single test file
bun test tests/query-executor.test.ts

# Seed demo data
bun run seed:sqlite
bun run seed:postgres
```

## Architecture

Two-process model communicating via type-safe RPC:

```
Frontend (Solid.js in webview)          Backend (Bun process)
  Components → Stores → RPC client  ⟷  RPC handlers → Services → DB drivers
```

### Directory structure

```
src/
  shared/              ← Pure types + browser-safe utilities (no backend concepts)
  backend-shared/      ← Backend logic: drivers, services, storage, RPC adapter/handlers
  backend-types/       ← Type-only re-exports for frontend (import type from backend-shared)
  backend-desktop/     ← Electrobun backend entry point
  backend-web/         ← HTTP/WebSocket server entry point
  cli/                 ← CLI entry point (bunx @dotaz/server)
  frontend-shared/     ← Solid.js UI: components, stores, lib (transport/storage registries)
  frontend-desktop/    ← Desktop entry: setTransport(electrobun) + setStorage(rpc)
  frontend-web/        ← Web entry: setTransport(websocket) + setStorage(indexeddb)
  frontend-demo/       ← Demo entry: setTransport(inline) + setStorage(rpc), WASM SQLite
```

### Dependency graph (no cycles)

```
shared               ← no deps
backend-shared       ← shared
backend-types        ← backend-shared (import type only)
frontend-shared      ← shared + backend-types (import type only)
frontend-desktop     ← frontend-shared
frontend-web         ← frontend-shared
frontend-demo        ← frontend-shared + backend-shared (runtime — createHandlers/RpcAdapter)
backend-desktop      ← backend-shared
backend-web          ← backend-shared
cli                  ← backend-web (starts server with CLI argument parsing)
```

### Transport & storage — registration pattern

Entry points register concrete implementations via `setTransport()` / `setStorage()`. Shared code accesses them through lazy proxies — no Vite swap plugins, no build-time module resolution tricks.

```typescript
// frontend-desktop/main.tsx
setTransport(createElectrobunTransport())
setStorage(new RpcAppStateStorage())
render(() => <App />, document.getElementById('app')!)
```

## Release

Release is fully automated via GitHub Actions (`.github/workflows/release.yml`). To release:

```bash
# 1. Push commits to origin
git push origin main

# 2. Create and push a version tag
git tag v0.0.XX
git push origin v0.0.XX
```

This triggers the release workflow which:
- Builds desktop apps for 5 platforms (Linux x64/ARM64, macOS x64/ARM64, Windows x64)
- Publishes Docker image to `ghcr.io/contember/dotaz`
- Publishes `@dotaz/server` npm package
- Creates GitHub Release with all artifacts

Pre-release tags (containing `-beta`, `-alpha`, `-rc`) get `canary` electrobun env and `beta` npm tag.

### Monitoring the release

```bash
# Watch the release workflow run
gh run watch
```

## Multi-agent coordination

This project may have multiple agents working concurrently. Follow these rules strictly:

- **Never use `git stash`**. To commit selectively, stage only the files you need with `git add <file>` — leave everything else unstaged.
- **Never revert or discard changes** you did not author in the current task
- **Never assume a conflict is an error** — another agent may have legitimately modified the file
- If a merge conflict, unexpected state, or test failure appears to be caused by concurrent edits:
  1. **Wait between 30-90 seconds (jitter)** (eg `sleep 53`) and retry the failed operation - repeat up to three times
  2. If it still fails, **stop immediately** — do not attempt further fixes
  3. Report the situation to the user, describe what you observed, and ask how to proceed

## General Conventions

- **Bun APIs over Node.js**: Use `Bun.SQL`, `bun:sqlite`, `Bun.serve()`, Bun test runner
- **Electrobun APIs** for desktop features: windows, menus, RPC, native dialogs
- **Parameterized queries** always — no string concatenation for SQL
- **Dark theme** with CSS variables, no component CSS libraries
- Tests in `tests/` directory, required for backend logic; skip for pure UI components
- **No side effects in shared modules**: `shared/`, `backend-shared/`, `backend-types/`, `frontend-shared/` must not have top-level side effects. All initialization (transport, storage, listeners) goes in entry point modules.

## Testing

- Tests use Bun test runner, all files in `tests/*.test.ts`
- SQLite tests: in-memory (`:memory:`), no external setup
- PostgreSQL tests: require `docker compose up -d`, connection `postgres://dotaz:dotaz@localhost:5488/dotaz_test`
- MySQL tests: require `docker compose up -d`, connection `mysql://dotaz:dotaz@localhost:3388/dotaz_test`
- Test helpers: `tests/helpers.ts` — `seedPostgres()`, `seedSqlite()`, `seedMysql()`

### What to test

- Persistence, isolation, concurrency, error handling
- Driver behavior through the DatabaseDriver interface
- RPC wiring — handlers delegate to services correctly

### What NOT to test

- Trivial getters/setters, constants, type definitions
- Pure UI components — verify visually
