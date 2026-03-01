# DOTAZ-080: Fix type safety at RPC boundary

**Phase**: 8.5 — Tech Debt
**Type**: fullstack
**Dependencies**: none

## Description

RPC handlers accept `config: any` despite `ConnectionConfig` being a proper union type. Database driver results use `(result as any).count` casts. Schema introspection mappers use `(row: any) =>` throughout. The Electrobun transport bypasses type checking entirely with `(electroviewRpc.request as any)[method](params)`.

These gaps at the frontend-backend boundary defeat the purpose of the shared type system and allow runtime errors that TypeScript should catch.

Changes needed:
1. Replace `config: any` with `ConnectionConfig` in all RPC handler parameter types (`connections.create`, `connections.test`, `connections.update`)
2. Create typed interfaces for database query results (PRAGMA results, introspection queries) and use them instead of `(row: any)` in all 3 drivers
3. Type `Bun.SQL` result objects — create a wrapper or augment types so `result.count` / `result.affectedRows` are typed without `as any`
4. Fix transport layer — replace `(electroviewRpc.request as any)[method]` with properly typed method routing
5. Type the message listener payload: replace `(payload: any) => void` in `RpcTransport` with a generic or message registry

## Files

- `src/backend-shared/rpc/rpc-handlers.ts` — replace `config: any` with `ConnectionConfig` (3 locations)
- `src/backend-shared/drivers/postgres-driver.ts` — create interfaces for introspection query rows, type result objects
- `src/backend-shared/drivers/sqlite-driver.ts` — create interfaces for PRAGMA results, type result objects
- `src/backend-shared/drivers/mysql-driver.ts` — create interfaces for information_schema rows, type result objects
- `src/frontend-desktop/transport.ts` — remove `as any` cast, type method routing
- `src/frontend-shared/lib/transport/types.ts` — add generic typing to `addMessageListener`

## Acceptance Criteria

- [ ] Zero `any` types in RPC handler parameter signatures
- [ ] All driver introspection methods use typed row interfaces instead of `(row: any)`
- [ ] `result.count` / `result.affectedRows` accessed without `as any` casts
- [ ] Transport `call()` and `addMessageListener()` are type-safe
- [ ] `bunx tsc --noEmit` passes with zero errors
- [ ] All existing tests pass
