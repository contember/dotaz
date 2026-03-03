# DOTAZ-098: Export service streaming refactor

**Phase**: 13 — Robust Streaming Import/Export
**Type**: backend
**Dependencies**: [DOTAZ-096]

## Description

Replace the current `exportToFile()` (LIMIT/OFFSET batching) with `exportToStream()` that uses `driver.iterate()`. The export service becomes driver-agnostic — no LIMIT/OFFSET logic, no driver-type checks.

### New `exportToStream()`

```typescript
async function exportToStream(
	driver: DatabaseDriver,
	params: ExportParams,
	writer: { write(chunk: string | Uint8Array): void; end(): Promise<void> },
	signal?: AbortSignal,
	onProgress?: (rowCount: number) => void,
): Promise<{ rowCount: number }>
```

Core loop:

```typescript
const selectSql = buildExportSelectQuery(params, driver) // no LIMIT/OFFSET
const iterator = driver.iterate(selectSql, queryParams, BATCH_SIZE, signal)
for await (const batch of iterator) {
	writer.write(encode(formatter.formatBatch(batch, isFirst)))
	totalRows += batch.length
	onProgress?.(totalRows)
	isFirst = false
}
```

### Changes

- Extract `buildExportSelectQuery()` — base SELECT without LIMIT/OFFSET (columns, FROM, WHERE, ORDER BY only)
- Remove `buildExportQuery()` (old LIMIT/OFFSET version)
- Remove the `while(true)` loop with offset tracking
- **Backpressure**: writer interface should support backpressure. When writing to HTTP response for slow clients, the write must pause iteration when buffer is full. Use async write or check writer buffer status.
- `onProgress` callback fires after each batch with cumulative row count
- `signal` checked via `driver.iterate()` (driver handles abort internally)
- Existing formatters (CSV, JSON, SQL INSERT, SQL UPDATE, Markdown, HTML, XML) remain unchanged
- `exportPreview()` stays unchanged (single small LIMIT query)
- Helper `exportToFile()` wraps `exportToStream()` with `Bun.file(path).writer()` for desktop mode

### BackendAdapter changes

`exportData()` uses `exportToFile()` (wrapper around `exportToStream` + file writer).

## Files

- `src/backend-shared/services/export-service.ts` — replace exportToFile with exportToStream, new buildExportSelectQuery
- `src/backend-shared/rpc/backend-adapter.ts` — update exportData() call
- `tests/export-service.test.ts` — update tests

## Acceptance Criteria

- [ ] `exportToStream()` uses `driver.iterate()` instead of LIMIT/OFFSET
- [ ] No driver-type branching in export service
- [ ] `buildExportSelectQuery()` generates SQL without LIMIT/OFFSET
- [ ] Old `buildExportQuery()` and LIMIT/OFFSET loop removed
- [ ] Backpressure: writer can signal when buffer is full
- [ ] `onProgress` callback reports cumulative rows after each batch
- [ ] AbortSignal propagated to driver.iterate()
- [ ] All existing export formats still work (CSV, JSON, SQL, Markdown, HTML, XML)
- [ ] `exportPreview()` unchanged
- [ ] `exportToFile()` convenience wrapper for desktop mode
- [ ] Tests pass
