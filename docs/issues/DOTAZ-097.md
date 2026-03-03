# DOTAZ-097: Streaming CSV parser

**Phase**: 13 — Robust Streaming Import/Export
**Type**: backend
**Dependencies**: none

## Description

New async-generator CSV parser that processes a `ReadableStream<Uint8Array>` and yields batches of parsed rows. Replaces the current in-memory `parseCsvLines()` which loads the entire file content into a string before parsing.

### Signature

```typescript
async function* parseCsvStream(
	stream: ReadableStream<Uint8Array>,
	options: {
		delimiter: CsvDelimiter
		hasHeader: boolean
		batchSize: number
		maxRows?: number // for preview — stops reading early
	},
): AsyncGenerator<{ columns: string[]; rows: Record<string, unknown>[] }>
```

### Behavior

- **RFC 4180 compliant**: quoted fields, escaped quotes (`""`), multiline fields within quotes
- **Streaming UTF-8 decode**: `TextDecoder("utf-8", { stream: true })` for correct multi-byte character handling at chunk boundaries
- **Batch yielding**: accumulates `batchSize` rows then yields. Columns derived from header row (or generated as `col1`, `col2`... if `hasHeader: false`)
- **Early stop**: `maxRows` stops consuming the stream after N data rows (for preview). Does not read rest of file.
- **Coercion**: same logic as existing `coerceValue()` — booleans (`true`/`false`), integers, floats, empty string → null
- **Error handling**: Throw immediately at first malformed input with line number and error detail:
  - Unclosed quote at end of stream
  - Invalid UTF-8 sequence
  - Error includes approximate line number for user feedback

### What stays in-memory

JSON import stays in-memory (`JSON.parse()`). JSON arrays can't be easily streamed, and large JSON imports are very rare.

## Files

- `src/backend-shared/services/csv-stream-parser.ts` — **new** streaming CSV parser
- `tests/csv-stream-parser.test.ts` — comprehensive tests

## Acceptance Criteria

- [ ] Async generator yields batches from ReadableStream
- [ ] Handles quoted fields correctly (RFC 4180)
- [ ] Handles multiline fields within quotes
- [ ] Correct UTF-8 decoding at chunk boundaries (multi-byte chars split across chunks)
- [ ] `maxRows` stops reading early without consuming rest of stream
- [ ] `hasHeader: false` generates column names (col1, col2, ...)
- [ ] Value coercion: booleans, numbers, nulls
- [ ] Throws on unclosed quote with line number
- [ ] Tests: normal CSV, quoted fields spanning chunks, multi-byte UTF-8 at boundaries, empty files, single-row files, malformed rows, maxRows limit, various delimiters (comma, semicolon, tab)
