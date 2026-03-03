# DOTAZ-099: Import service streaming refactor

**Phase**: 13 — Robust Streaming Import/Export
**Type**: backend
**Dependencies**: [DOTAZ-096, DOTAZ-097]

## Description

Replace the current in-memory `importData()` (parses entire file, then batches INSERTs) with `importFromStream()` that streams from a `ReadableStream`, uses the streaming CSV parser, and calls `driver.importBatch()`.

### New `importFromStream()`

```typescript
async function importFromStream(
	driver: DatabaseDriver,
	stream: ReadableStream<Uint8Array>,
	params: {
		schema: string
		table: string
		format: ImportFormat
		delimiter?: CsvDelimiter
		hasHeader?: boolean
		mappings: ColumnMapping[]
		batchSize?: number
	},
	signal?: AbortSignal,
	onProgress?: (rowsInserted: number) => void,
): Promise<ImportResult>
```

Core loop:

```typescript
await driver.beginTransaction()
try {
	for await (const { rows } of parseCsvStream(stream, csvOptions)) {
		if (signal?.aborted) throw new Error('Import cancelled')
		const mappedRows = rows.map(row => mapRow(row, activeMappings))
		await driver.importBatch(qualifiedTable, columns, mappedRows)
		totalInserted += rows.length
		onProgress?.(totalInserted)
	}
	await driver.commit()
} catch (err) {
	await driver.rollback()
	throw err
}
```

### Error policy

Always full rollback. Single transaction, all-or-nothing. Parse errors (from CSV parser) and DB errors both trigger rollback. User sees line number for parse errors or DB error detail.

### Preview

New `importPreviewFromStream()`:

- Takes a `ReadableStream` (or file path for desktop)
- Uses `parseCsvStream()` with `maxRows: 20` — stops reading early
- For desktop: `Bun.file(path).stream()`
- For web/demo: create stream from content prefix

`ImportPreviewResult.totalRows` becomes optional — streaming can't know total without full parse.

### RPC contract changes

`src/shared/types/import.ts`:

- `fileContent` → optional (was required)
- Add `filePath?: string` to `ImportPreviewRequest` and `ImportOptions`
- `ImportPreviewResult.totalRows` → `number | undefined`
- Add `fileSizeBytes?: number` to `ImportPreviewResult`

### BackendAdapter changes

- `importData()`: if `filePath` present → `importFromStream(driver, Bun.file(path).stream(), ...)`; if `fileContent` present → create ReadableStream from string → `importFromStream()`
- `importPreview()`: if `filePath` → stream first 64KB from file; if `fileContent` → parse directly

### Old code removal

Remove `parseFileContent()`, `parseCsvLines()`, old `importData()`, old `parseImportPreview()`. The streaming versions completely replace them.

JSON import: read full `fileContent` (or `filePath`) into string, `JSON.parse()`, then create async iterable from the array. JSON stays in-memory.

## Files

- `src/backend-shared/services/import-service.ts` — replace with importFromStream, importPreviewFromStream
- `src/shared/types/import.ts` — filePath optional, fileContent optional, totalRows optional
- `src/backend-shared/rpc/backend-adapter.ts` — dispatch filePath vs fileContent
- `src/frontend-demo/demo-adapter.ts` — update to pass fileContent through streaming API
- `tests/import-service.test.ts` — update tests

## Acceptance Criteria

- [ ] `importFromStream()` uses streaming CSV parser + driver.importBatch()
- [ ] Full rollback on any error (parse error, DB error, cancellation)
- [ ] Parse errors include line number
- [ ] AbortSignal checked between batches
- [ ] `onProgress` callback reports cumulative rows
- [ ] `importPreviewFromStream()` reads only first rows (maxRows), does not consume entire stream
- [ ] RPC types updated: filePath optional, fileContent optional, totalRows optional
- [ ] BackendAdapter dispatches filePath vs fileContent
- [ ] DemoAdapter updated for new API
- [ ] Old in-memory parsing code removed
- [ ] JSON import still works (in-memory fallback)
- [ ] Tests: streaming import, error rollback, preview from prefix, cancellation
