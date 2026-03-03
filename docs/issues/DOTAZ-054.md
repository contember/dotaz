# DOTAZ-054: SSL mode for PostgreSQL connections

**Phase**: 8 — Gaps
**Type**: fullstack
**Dependencies**: [DOTAZ-013]

## Description

Replace the current boolean SSL checkbox with a proper SSL mode dropdown for PostgreSQL connections. The PRD requires full SSL mode support (FR-CONN-01). Currently the SSL setting is stored as a boolean and is not even passed to the PostgreSQL driver connection string, making it non-functional.

Changes needed:

1. Change `PostgresConnectionConfig.ssl` from `boolean` to `SSLMode` enum type (`"disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full"`)
2. Update ConnectionDialog to render a `<select>` dropdown instead of a checkbox
3. Pass the SSL mode parameter to the PostgreSQL driver connection URL (`?sslmode=...`)
4. Update connection string parsing to preserve the full sslmode value (currently collapses to boolean)
5. Handle migration of existing saved connections (boolean `true` → `"require"`, `false` → `"disable"`)

## Files

- `src/shared/types/connection.ts` — change `ssl?: boolean` to `ssl?: SSLMode` with type definition
- `src/mainview/components/connection/ConnectionDialog.tsx` — replace checkbox with dropdown
- `src/bun/db/postgres-driver.ts` — append `?sslmode=` to connection URL
- `src/bun/storage/app-db.ts` — migration for existing boolean values

## Acceptance Criteria

- [ ] SSL mode dropdown with options: disable, allow, prefer, require, verify-ca, verify-full
- [ ] Selected SSL mode is passed to PostgreSQL driver and used in connection
- [ ] Connection string parsing preserves full sslmode value
- [ ] Existing saved connections with boolean SSL are migrated correctly
- [ ] Default SSL mode is "prefer" for new connections
