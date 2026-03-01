# DOTAZ-085: AppDatabase transaction wrapping and storage improvements

**Phase**: 8.5 — Tech Debt
**Type**: backend
**Dependencies**: none

## Description

Several backend storage operations lack proper safety measures:

### No transaction wrapping in AppDatabase
Multi-row operations like `storage.restore()` in `rpc-handlers.ts` (lines 292-322) insert into multiple tables without a transaction. If the operation fails midway, the app database is left in an inconsistent state.

### History cleanup not enforced
`DEFAULT_SETTINGS.maxHistoryEntries = "1000"` exists but is never enforced. The history table grows without bound. `clearHistory()` is manual only.

### Settings are untyped strings
`getSetting()` returns `string | null`. All settings are stored/retrieved as strings with no type-safe parsing. Frontend must manually parse numbers, booleans, etc.

### No connection pool limits
`ConnectionManager` allows unlimited database activations. No configurable maximum.

Changes needed:
1. Add `transaction<T>(fn: () => T): T` method to `AppDatabase` using `bun:sqlite` transactions
2. Wrap `restore()` and other multi-statement operations in transactions
3. Add automatic history pruning in `addHistory()` — delete oldest entries when exceeding max
4. Add typed settings helpers: `getNumberSetting()`, `getBooleanSetting()` or a settings codec
5. Add `MAX_ACTIVE_DATABASES` constant (default 10) to ConnectionManager, enforce in `activateDatabase()`

## Files

- `src/backend-shared/storage/app-db.ts` — add `transaction()` method, typed setting getters, history pruning in `addHistory()`
- `src/backend-shared/rpc/rpc-handlers.ts` — wrap restore operations in transactions
- `src/backend-shared/services/connection-manager.ts` — add and enforce connection pool limit

## Acceptance Criteria

- [ ] `AppDatabase.transaction()` wraps operations atomically — partial failures roll back
- [ ] `storage.restore()` uses transaction wrapping
- [ ] History is automatically pruned when exceeding `maxHistoryEntries`
- [ ] Typed setting accessors exist (at least for number and boolean settings)
- [ ] Connection pool limit enforced with descriptive error when exceeded
- [ ] All existing tests pass; new tests for transaction rollback and history pruning
