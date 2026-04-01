<p align="center">
  <img src="assets/icon.png" alt="Dotaz" width="128" height="128">
</p>

<h1 align="center">Dotaz</h1>

<p align="center">
  A fast, lightweight database client for PostgreSQL, MySQL, and SQLite.<br>
  Browse, edit, and query your data. No DDL, no bloat — just data.
</p>

<p align="center">
  <a href="https://contember.github.io/dotaz/">Try the live demo</a> (runs entirely in your browser)
</p>

<p align="center">
  <img src="assets/screenshot.png" alt="Dotaz screenshot" width="800">
</p>

---

## What is Dotaz?

Dotaz is a database client that gets out of your way. It focuses on what you do most — looking at data, editing rows, and running queries. It deliberately skips schema management (CREATE TABLE, ALTER, migrations) to keep things simple and fast.

### Desktop

Native app built with [Electrobun](https://electrobun.dev/) — Bun backend with a system webview. Available for macOS, Linux, and Windows. App state (connections, views) is persisted in a local SQLite database.

### Server

A lightweight Bun HTTP server you can self-host or run via Docker. Like [Adminer](https://www.adminer.org/), the server has no database of its own — it acts as a proxy to databases you connect to. All app state (connections, views, query history) lives in the browser (IndexedDB), so the server itself is stateless.

## Features

**Data grid** — Virtualized scrolling for large tables. Sort, filter (including raw WHERE), paginate, transpose, reorder columns, aggregate over selections (COUNT, SUM, AVG, MIN, MAX), and copy anything.

**Inline editing** — Edit cells directly in the grid or open a row detail panel. Batch edit multiple rows. Insert, delete, review all pending changes before committing. Foreign key picker for related records.

**SQL editor** — Full CodeMirror editor with syntax highlighting, autocomplete, multi-statement execution, and EXPLAIN plan visualization. AI-assisted SQL generation from plain text. Transaction support with commit/rollback and a change log. Warns you before running destructive queries.

**Export & import** — Export to CSV, JSON, SQL INSERT, SQL UPDATE, Markdown, HTML, or XML. Configurable delimiters, encoding, and BOM. Preview before saving. Import from CSV and JSON.

**Navigation** — Connection tree with databases, schemas, and tables. Schema viewer showing columns, indexes, and foreign keys. Command palette, query history, saved views, bookmarks, cross-table search. Dark theme throughout.

## Install

### Desktop app

**macOS & Linux:**

```sh
curl -fsSL https://raw.githubusercontent.com/contember/dotaz/main/install.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/contember/dotaz/main/install.ps1 | iex
```

### Server mode

Run as a web server accessible from your browser — no desktop app needed:

```sh
bunx @dotaz/server
```

Options: `--port <port>` (default: 6401), `--host <host>` (default: localhost)

### Docker

```sh
docker run -p 6401:6401 -e DOTAZ_ENCRYPTION_KEY=<your-secret> ghcr.io/contember/dotaz
```

`DOTAZ_ENCRYPTION_KEY` is required — it encrypts saved database credentials in the browser. Use any random string (e.g. `openssl rand -hex 32`).

## Development

Requirements: [Bun](https://bun.sh/) v1.1+

```bash
git clone https://github.com/contember/dotaz.git
cd dotaz
bun install
```

```bash
# Desktop (Electrobun)
bun run dev

# Web
bun run dev:web

# Demo (browser-only, no server)
bun run dev:demo
```

### Running tests

```bash
# SQLite (no setup needed)
bun test

# PostgreSQL (needs Docker)
docker compose up -d
bun test tests/pg-smoke.test.ts

# MySQL / MariaDB (needs Docker)
docker compose up -d
bun test tests/mysql-driver.test.ts
```

## License

MIT — see [LICENSE](LICENSE)

Copyright (c) 2025 [Contember Limited](https://www.contember.com/)
