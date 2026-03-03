# DOTAZ-101: Web streaming infrastructure (token registry, HTTP endpoints, StreamSaver)

**Phase**: 13 — Robust Streaming Import/Export
**Type**: fullstack
**Dependencies**: [DOTAZ-098, DOTAZ-099, DOTAZ-100]

## Description

Web mode needs dedicated HTTP endpoints for streaming import/export because large files can't flow through WebSocket RPC. This issue adds the token-based session bridging, HTTP stream endpoints, StreamSaver.js export download, and web-mode frontend flows.

### Token Registry

Global registry in `src/backend-web/server.ts`:

```typescript
interface StreamToken {
	session: Session
	connectionId: string
	database?: string
	params: ExportStreamParams | ImportStreamParams
	type: 'export' | 'import'
	createdAt: number
}

const streamTokens = new Map<string, StreamToken>()
```

**Lifecycle**:

- Created via WS RPC (`stream.createExportToken` / `stream.createImportToken`) — web-server-specific handlers added directly in `server.ts` WS message handler (not in shared BackendAdapter)
- One-time use: consumed and deleted on first HTTP request
- Auto-expire after 5 minutes (periodic `setInterval` cleanup)

### Session Lifecycle

- Store sessions in global `Map<sessionId, Session>` alongside `ws.data`
- **Delayed cleanup**: On WS close, don't destroy session if active stream operations reference it. Track active stream count per session. Destroy only when WS closed AND active streams = 0.

### HTTP Endpoints

**`GET /api/stream/export/:token`**:

- Look up token → validate → get driver from session's ConnectionManager
- `exportToStream(driver, params, httpResponseWriter, signal)`
- Headers: `Content-Type` (csv: `text/csv`, json: `application/json`, etc.), `Content-Disposition: attachment; filename="..."`
- Backpressure: use Bun's response streaming with proper backpressure (Response with ReadableStream body, or use `new Response(stream)`)
- On error mid-stream: close response, client detects broken stream

**`POST /api/stream/import/:token`**:

- Look up token → validate → get driver from session's ConnectionManager
- `importFromStream(driver, request.body, params, signal, onProgress)`
- `onProgress` sends WS messages to the session's websocket (progress reporting via parallel channel)
- Returns JSON `{ rowCount }` on success, error JSON on failure

### WS Token Handlers

Intercepted in `server.ts` message handler before passing to shared handlers:

- `stream.createExportToken` → generate UUID token, store in registry, return `{ token }`
- `stream.createImportToken` → generate UUID token, store in registry, return `{ token }`

### Frontend: Web Export (StreamSaver.js pattern)

After user configures export in ExportDialog:

1. `rpc.stream.createExportToken(params)` via WS → `{ token }`
2. Create writable file stream via Service Worker (StreamSaver.js pattern):
   - Register SW that intercepts fetch to a special URL
   - `fetch('/api/stream/export/' + token)` → pipe `response.body` through SW to download stream
3. On stream error: show toast notification (file may be corrupt/incomplete)
4. Progress: via parallel WS messages from server's onProgress callback

### Frontend: Web Import

After user configures import in ImportDialog:

1. `rpc.stream.createImportToken(params)` via WS → `{ token }`
2. `fetch('/api/stream/import/' + token, { method: 'POST', body: file })` where `file` is the File object from `<input type="file">`
3. Await response JSON `{ rowCount }`
4. Progress: via parallel WS messages

### Frontend: Web Import Preview

- `file.slice(0, 65536).text()` → send `{ fileContent: prefix }` via WS RPC
- If preview parse is incomplete, show warning "Preview may be incomplete"

### Cancellation

- Frontend creates AbortController, passes signal to fetch()
- Aborting fetch closes the HTTP connection
- Server detects broken pipe / aborted request → propagates to exportToStream/importFromStream signal
- Import: transaction rolls back. Export: cursor closes, connection released.

## Files

- `src/backend-web/server.ts` — token registry, session map, HTTP endpoints, WS token handlers, delayed session cleanup
- `src/frontend-shared/components/import/ImportDialog.tsx` — web mode flow (HTTP POST import, preview from prefix)
- `src/frontend-shared/components/export/ExportDialog.tsx` — web mode flow (StreamSaver download)
- `src/frontend-web/main.tsx` — Service Worker registration for StreamSaver (if needed)

## Acceptance Criteria

- [ ] Token registry with create/consume/expire lifecycle
- [ ] `stream.createExportToken` and `stream.createImportToken` WS handlers
- [ ] `GET /api/stream/export/:token` streams export data with correct headers
- [ ] `POST /api/stream/import/:token` streams import from request body
- [ ] Backpressure: export HTTP response doesn't buffer unbounded data
- [ ] Session delayed cleanup: sessions survive WS close during active streams
- [ ] Tokens expire after 5 minutes unused
- [ ] Web export: StreamSaver.js downloads streaming response to disk
- [ ] Web import: HTTP POST with File body, result from response
- [ ] Web import preview: 64KB prefix via WS, incomplete parse warning
- [ ] Progress: WS messages during import/export operations
- [ ] Cancellation: abort fetch → server cleanup → rollback/cursor close
- [ ] Mid-stream error: toast notification on frontend
