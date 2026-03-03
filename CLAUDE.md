# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also: `src/frontend-shared/CLAUDE.md` (frontend), `src/shared/CLAUDE.md` (shared types).

## Project

Dotaz is a desktop database client built on **Electrobun** (Bun backend + system webview) with a **Solid.js** frontend. It supports PostgreSQL and SQLite, focused on DML operations (viewing, editing, querying data) — no DDL/schema management.

Runs in three modes:

- **Desktop** (Electrobun) — native window with RPC transport, app state in backend SQLite
- **Web** — standalone Bun HTTP/WebSocket server (`bun run dev:web`), app state in browser IndexedDB
- **Demo** — browser-only with WASM SQLite, no server needed (`bun run dev:demo`)

## Commands

```bash
# Development — desktop with HMR (recommended)
bun run dev:hmr

# Development — desktop without HMR
bun run dev

# Development — web mode (HTTP + WebSocket)
bun run dev:web

# Development — demo mode (browser-only WASM SQLite)
bun run dev:demo

# Production build (desktop)
bun run build:canary

# Type checking (must pass with zero errors)
bunx tsc --noEmit

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
```

### Transport & storage — registration pattern

Entry points register concrete implementations via `setTransport()` / `setStorage()`. Shared code accesses them through lazy proxies — no Vite swap plugins, no build-time module resolution tricks.

```typescript
// frontend-desktop/main.tsx
setTransport(createElectrobunTransport())
setStorage(new RpcAppStateStorage())
render(() => <App />, document.getElementById('app')!)
```

## Implementation Workflow

Follow `docs/INSTRUCTIONS.md` — issue-driven development, one issue per invocation:

1. Read `docs/STATUS.md` to find the next `not started` issue
2. Read the issue file at `docs/issues/DOTAZ-{NNN}.md`
3. Check dependencies are `done` before starting
4. Implement, type-check, test, commit with format `DOTAZ-{NNN}: {description}`
5. Update `docs/STATUS.md`

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
- Test helpers: `tests/helpers.ts` — `seedPostgres()`, `seedSqlite()`

### What to test

- Persistence, isolation, concurrency, error handling
- Driver behavior through the DatabaseDriver interface
- RPC wiring — handlers delegate to services correctly

### What NOT to test

- Trivial getters/setters, constants, type definitions
- Pure UI components — verify visually
