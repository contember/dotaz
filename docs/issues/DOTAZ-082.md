# DOTAZ-082: Standardize error handling with domain error types

**Phase**: 8.5 — Tech Debt
**Type**: fullstack
**Dependencies**: none

## Description

Error handling is inconsistent across the application. Raw database errors propagate as plain `Error` objects. The RPC layer extracts `.message` as a string (line 147), so the frontend cannot distinguish between connection timeouts, permission denied, constraint violations, or invalid queries. Each frontend store handles errors differently: grid re-throws, editor catches locally, connections catches via message listener.

Additionally, several catch blocks silently swallow errors: query history logging (line 668), cancel during disconnect (line 502), cancel query (line 595).

Changes needed:
1. Create domain error hierarchy in `src/shared/types/errors.ts`:
   - `DatabaseError` (base, with `code` field)
   - `ConnectionError` (connection failures, timeouts)
   - `QueryError` (syntax errors, execution failures)
   - `ConstraintError` (unique/FK/check violations)
   - `AuthenticationError` (invalid credentials)
2. Map database-specific errors to domain errors in each driver
3. Pass error code through RPC so frontend can handle errors by type
4. Standardize frontend error handling: stores catch recoverable errors, bubble the rest to AppShell toast
5. Replace silent catches with conditional debug logging

## Files

- `src/shared/types/errors.ts` — new file with error hierarchy and codes
- `src/backend-shared/drivers/postgres-driver.ts` — map PostgreSQL error codes to domain errors
- `src/backend-shared/drivers/sqlite-driver.ts` — map SQLite error codes to domain errors
- `src/backend-shared/drivers/mysql-driver.ts` — map MySQL error codes to domain errors
- `src/backend-shared/rpc/rpc-handlers.ts` — serialize domain errors with code through RPC
- `src/frontend-shared/lib/rpc-errors.ts` — update to handle error codes
- `src/frontend-shared/stores/grid.ts` — standardize error handling pattern
- `src/frontend-shared/stores/editor.ts` — standardize error handling pattern

## Acceptance Criteria

- [ ] Domain error types defined with error codes
- [ ] Each driver maps native DB errors to domain errors (at minimum: connection, query, constraint, auth)
- [ ] Frontend receives error code and can display context-appropriate messages
- [ ] No silent catch blocks — all caught errors are at least debug-logged
- [ ] Frontend stores follow a consistent error handling pattern
- [ ] Existing error translation in `rpc-errors.ts` still works
- [ ] All tests pass; new tests for error mapping in each driver
