# DOTAZ-108: Frontend cleanup and error handling

**Phase**: 14 — Robustness & Tech Debt II
**Type**: frontend
**Dependencies**: none

## Description

Several minor frontend issues found during architecture review.

### 1. Global stale-data timer

Each DataGrid tab mounts its own `setInterval(..., 30_000)` to update the "data loaded N minutes ago" label. With 10 open tabs, that's 10 independent intervals doing the same thing.

Extract a single shared signal at module level that all DataGrid instances subscribe to:

```typescript
// In a shared module or at DataGrid module level
const [staleNow, setStaleNow] = createSignal(Date.now())
setInterval(() => setStaleNow(Date.now()), 30_000)
```

Remove per-instance `setInterval` from `onMount`.

### 2. Error handling for non-critical async operations

Several fire-and-forget async calls have no `.catch()` handler, causing silent failures:

- `ConnectionTree.tsx` — `viewsStore.loadViewsForConnection().then(...)` (line 228) has no `.catch()`; if view loading fails, user gets no feedback
- `ConnectionTree.tsx` — `gridStore.loadTableData().then(...)` (line 298, in saved view opening) has no `.catch()`
- `stores/connections.ts` — `loadSchemaTreesForConnection()` calls `loadSchemaTree()` (async) without `await` or `.catch()` at lines 134, 142; errors are silently swallowed

Add `.catch()` handlers that show a warning toast (not error — these are non-critical features that shouldn't block the main workflow).

## Files

- `src/frontend-shared/components/grid/DataGrid.tsx` — replace per-tab stale timer with shared signal
- `src/frontend-shared/components/connection/ConnectionTree.tsx` — add catch handlers for view loading and saved-view table loading
- `src/frontend-shared/stores/connections.ts` — add catch handlers for `loadSchemaTree()` calls in `loadSchemaTreesForConnection()`

## Acceptance Criteria

- [ ] Single shared stale-data timer instead of per-DataGrid interval
- [ ] `loadViewsForConnection()` failures show warning toast
- [ ] `loadTableData()` failures in saved view opening show warning toast
- [ ] `loadSchemaTree()` failures show warning toast
- [ ] Existing stale-data label behavior unchanged
- [ ] `bunx tsc --noEmit` passes
