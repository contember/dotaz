# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also: `src/bun/CLAUDE.md` (backend), `src/mainview/CLAUDE.md` (frontend), `src/shared/CLAUDE.md` (shared types).

## Project

Dotaz is a desktop database client built on **Electrobun** (Bun backend + system webview) with a **Solid.js** frontend. It supports PostgreSQL and SQLite, focused on DML operations (viewing, editing, querying data) — no DDL/schema management.

Runs in two modes:
- **Desktop** (Electrobun) — native window with RPC transport, app state in backend SQLite
- **Web** — standalone Bun HTTP/WebSocket server (`bun run dev:web`), app state in browser IndexedDB

## Commands

```bash
# Development — desktop with HMR (recommended)
bun run dev:hmr

# Development — desktop without HMR
bun run dev

# Development — web mode (HTTP + WebSocket)
bun run dev:web

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

- **Backend** (`src/bun/`): Database connections, query execution, app storage
- **Frontend** (`src/mainview/`): Solid.js UI with reactive stores
- **Shared** (`src/shared/types/`): Type definitions for RPC schema and domain types

Communication: Electrobun RPC (desktop) or WebSocket (web mode). Both share the same RPC handler layer.

App state (connections, history, views) is stored via `AppStateStorage` interface with two adapters:
- **Desktop** (`RpcAppStateStorage`): delegates to backend SQLite via RPC
- **Web** (`IndexedDbAppStateStorage`): stores in browser IndexedDB, passwords encrypted by server

Vite build-time plugin swaps the adapter (same pattern as transport swap).

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
