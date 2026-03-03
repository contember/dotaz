# DOTAZ-100: Frontend capabilities and desktop/demo mode updates

**Phase**: 13 — Robust Streaming Import/Export
**Type**: fullstack
**Dependencies**: [DOTAZ-098, DOTAZ-099]

## Description

Add a capability registration system for frontend entry points and update ImportDialog + ExportDialog for desktop and demo modes.

### Capability Registration

New file `src/frontend-shared/lib/capabilities.ts`:

```typescript
interface AppCapabilities {
  hasFileSystem: boolean;      // can read/write files via path (desktop)
  hasHttpStreaming: boolean;    // can stream via HTTP endpoints (web)
  hasNativeDialogs: boolean;   // has native open/save dialogs (desktop)
}

setCapabilities(c: AppCapabilities): void
getCapabilities(): Readonly<AppCapabilities>
```

Default: all false (safest). Entry points register at startup:

- `frontend-desktop/main.tsx`: `{ hasFileSystem: true, hasHttpStreaming: false, hasNativeDialogs: true }`
- `frontend-web/main.tsx`: `{ hasFileSystem: false, hasHttpStreaming: true, hasNativeDialogs: false }`
- `frontend-demo/main.tsx`: `{ hasFileSystem: false, hasHttpStreaming: false, hasNativeDialogs: false }`

### ImportDialog mode-aware flow

**Desktop** (`hasFileSystem + hasNativeDialogs`):

- "Browse" → `rpc.system.showOpenDialog()` → stores file path (not content)
- Preview: sends `{ filePath }` → backend reads 64KB prefix, parses with `maxRows: 20`
- Import: sends `{ filePath }` → backend streams from file
- Progress: live rows counter via RPC events

**Demo** (`neither`):

- "Browse" → `<input type="file">` → `file.text()` → stores content string
- Preview: sends `{ fileContent }` via RPC
- Import: sends `{ fileContent }` via RPC → backend creates ReadableStream from string
- Same streaming API internally

### ExportDialog mode-aware flow

**Desktop**: Unchanged — save dialog → path → RPC → file written → result with sizeBytes

**Demo**: Export to in-memory Blob + browser download:

- `exportToStream()` with a blobWriter that collects chunks into array
- Create Blob → object URL → trigger `<a download>` click → revoke URL

### Progress UI

Replace current indeterminate spinner with live rows counter:

- `"Importing... 42,000 rows"` / `"Exporting... 150,000 rows"`
- Updates after each batch via onProgress callback (desktop/demo) or WS events (web, added in DOTAZ-101)

### Import preview with unknown total

When `totalRows` is undefined (streaming mode), UI shows:

- `"Preview (first 20 rows)"` instead of `"Preview (first 20 of 1,234 rows)"`
- Info section: `"~X rows to import (estimated from file size)"` or just `"20+ rows to import"`
- Best-effort warning if preview parse is incomplete (64KB prefix didn't yield enough rows)

## Files

- `src/frontend-shared/lib/capabilities.ts` — **new** capability registration
- `src/frontend-desktop/main.tsx` — `setCapabilities(...)` call
- `src/frontend-web/main.tsx` — `setCapabilities(...)` call
- `src/frontend-demo/main.tsx` — `setCapabilities(...)` call
- `src/frontend-shared/components/import/ImportDialog.tsx` — mode-aware browse/preview/import flow
- `src/frontend-shared/components/export/ExportDialog.tsx` — demo Blob download, progress UI

## Acceptance Criteria

- [ ] `capabilities.ts` with setCapabilities/getCapabilities
- [ ] All three entry points register capabilities
- [ ] Desktop import: showOpenDialog → filePath flow (no file.text())
- [ ] Desktop import preview from file path (64KB prefix)
- [ ] Demo import: file.text() → fileContent flow through streaming API
- [ ] Demo export: Blob + browser download
- [ ] Progress: live rows counter replaces indeterminate spinner
- [ ] Preview UI handles optional totalRows gracefully
- [ ] Best-effort warning on incomplete preview parse
