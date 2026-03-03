# Frontend — `src/frontend-shared/`

Solid.js UI running in system webview (desktop) or browser (web/demo mode).

## Architecture

```
App.tsx                          ← Root component
├── components/
│   ├── layout/                  ← AppShell, Sidebar, TabBar, Resizer
│   ├── connection/              ← ConnectionDialog, ConnectionTree, DatabasePicker, PasswordDialog
│   ├── grid/                    ← DataGrid, GridHeader, GridRow, GridCell, VirtualScroller, Pagination, FilterBar, ColumnManager
│   ├── editor/                  ← SqlEditor (CodeMirror), SqlResultPanel, QueryToolbar
│   ├── edit/                    ← InlineEditor, RowDetailDialog, PendingChanges
│   ├── schema/                  ← SchemaViewer, ColumnList, IndexList
│   ├── export/                  ← ExportDialog
│   ├── history/                 ← QueryHistory
│   ├── views/                   ← SaveViewDialog
│   └── common/                  ← CommandPalette, ContextMenu, Dialog, Toast, Icon
├── stores/                      ← Solid.js reactive state
│   ├── connections.ts           ← Connection list, state, active connection, schema trees
│   ├── tabs.ts                  ← Open tabs, active tab
│   ├── grid.ts                  ← Per-tab grid data, pagination, sort, filter, selection, pending changes
│   ├── editor.ts                ← SQL content, query results, transaction state
│   ├── ui.ts                    ← Sidebar width, dialogs, toasts, command palette
│   └── views.ts                 ← Saved views per table
├── lib/
│   ├── rpc.ts                   ← Typed RPC client (namespace access: rpc.connections.list())
│   ├── rpc-errors.ts            ← RPC error handling and user-friendly messages
│   ├── transport/               ← Transport abstraction
│   │   ├── index.ts             ← setTransport() + lazy proxy
│   │   └── types.ts             ← RpcTransport interface
│   ├── storage/                 ← App state storage
│   │   ├── index.ts             ← setStorage() + lazy proxy
│   │   ├── rpc.ts               ← RpcAppStateStorage class (desktop + demo)
│   │   └── indexeddb.ts         ← IndexedDbAppStateStorage class (web)
│   ├── app-state-storage.ts     ← AppStateStorage interface
│   ├── keyboard.ts              ← Keyboard shortcut system
│   └── commands.ts              ← Command registry for command palette
└── styles/
    └── global.css               ← Global styles, dark theme, CSS variables
```

## Entry Points

Entry points live outside this directory. Each registers transport + storage, then renders `<App />`:

- `src/frontend-desktop/main.tsx` — Electrobun transport + RPC storage
- `src/frontend-web/main.tsx` — WebSocket transport + IndexedDB storage
- `src/frontend-demo/main.tsx` — Inline transport + RPC storage (via WASM SQLite handlers)

## State Management

All state uses **Solid.js `createStore` / `createSignal`** — never React patterns (useState, useEffect, etc.).

Data flow: **User action → Component → Store action → Storage adapter / RPC call → Store update → Reactive re-render**

Stores are module-level singletons (not context providers). Import directly:

```typescript
import { gridState, loadTableData } from '../stores/grid'
```

## RPC Client (`lib/rpc.ts`)

Proxy-based client with types inferred from `createHandlers()` via `NamespacedRpcClient`. All methods use **object params** matching the handler signatures:

```typescript
import { rpc } from '../lib/rpc'

await rpc.connections.list()
await rpc.query.execute({ connectionId, sql, queryId, database })
await rpc.schema.load({ connectionId, database })
```

Also exports `messages` for backend → frontend notifications (connection status changes, menu actions).

New RPC methods added to `createHandlers()` are automatically available on the client — no manual wiring needed.

### Transport layer (`lib/transport/`)

Registration pattern: entry points call `setTransport()` with a concrete implementation. Shared code accesses `transport` via a lazy proxy that throws if not initialized.

Transport factory functions live in their respective entry point directories:

- `frontend-desktop/transport.ts` — `createElectrobunTransport()` (Electrobun RPC)
- `frontend-web/transport.ts` — `createWebSocketTransport()` (WebSocket)
- `frontend-demo/transport.ts` — `createInlineTransport()` (direct handler invocation)

### Storage layer (`lib/storage/`)

Registration pattern: entry points call `setStorage()` with a concrete implementation.

- `RpcAppStateStorage` — delegates to backend via RPC (desktop + demo)
- `IndexedDbAppStateStorage` — stores in browser IndexedDB (web)

In web mode, passwords are encrypted by the server (`storage.encrypt` RPC) before being stored in IndexedDB. On connect, the encrypted config is sent back to the server for decryption.

## Styling

- **Dark theme** using CSS variables defined in `styles/global.css`
- Each component has its own `.css` file (e.g., `DataGrid.css`) imported in the component
- No CSS-in-JS, no component libraries — plain CSS with variables
- Icons from **`lucide-solid`** (Lucide icon set as Solid.js components)

## Key Libraries

- **CodeMirror 6** (`@codemirror/lang-sql`) — SQL editor with syntax highlighting and autocomplete
- **TanStack Solid Virtual** (`@tanstack/solid-virtual`) — virtual scrolling for large datasets in DataGrid
- **lucide-solid** — icon components

## Conventions

- Components are `.tsx` files with corresponding `.css` files
- Use Solid.js primitives: `createSignal`, `createStore`, `createEffect`, `createMemo`, `<Show>`, `<For>`, `<Switch>`/`<Match>`
- Avoid `useEffect`-like patterns — prefer `createEffect` with explicit dependency tracking
- Keep components focused — extract logic into stores or lib utilities
- RPC calls happen in stores, not in components directly (components call store actions)
- All user-facing text is hardcoded (no i18n yet)
- **No side effects at module top-level** — all initialization happens in entry points or via init functions called from `App.tsx`
