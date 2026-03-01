# Frontend — `src/mainview/`

Solid.js UI running in system webview (desktop) or browser (web mode).

## Architecture

```
main.tsx / App.tsx               ← Entry point and root component
├── components/
│   ├── layout/                  ← AppShell, Sidebar, TabBar, StatusBar, Resizer
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
│   ├── transport/               ← Transport abstraction (Electrobun RPC vs WebSocket)
│   ├── storage/                 ← App state storage (connections, history, views)
│   │   ├── index.ts             ← Re-export (default: rpc.ts, swapped to indexeddb.ts in web mode)
│   │   ├── rpc.ts               ← RpcAppStateStorage — delegates to backend RPC (desktop)
│   │   └── indexeddb.ts         ← IndexedDbAppStateStorage — browser IndexedDB (web)
│   ├── app-state-storage.ts     ← AppStateStorage interface
│   ├── keyboard.ts              ← Keyboard shortcut system
│   └── commands.ts              ← Command registry for command palette
└── styles/
    └── global.css               ← Global styles, dark theme, CSS variables
```

## State Management

All state uses **Solid.js `createStore` / `createSignal`** — never React patterns (useState, useEffect, etc.).

Data flow: **User action → Component → Store action → Storage adapter / RPC call → Store update → Reactive re-render**

Stores are module-level singletons (not context providers). Import directly:
```typescript
import { gridState, loadTableData } from "../stores/grid";
```

## RPC Client (`lib/rpc.ts`)

Proxy-based client with types inferred from `createHandlers()` via `NamespacedRpcClient`. All methods use **object params** matching the handler signatures:
```typescript
import { rpc } from "../lib/rpc";

await rpc.connections.list();
await rpc.query.execute({ connectionId, sql, queryId, database });
await rpc.schema.load({ connectionId, database });
```

Also exports `messages` for backend → frontend notifications (connection status changes, menu actions).

New RPC methods added to `createHandlers()` are automatically available on the client — no manual wiring needed.

### Transport layer (`lib/transport/`)

Abstraction over communication channel:
- `electrobun.ts` — Electrobun RPC (desktop mode, default)
- `websocket.ts` — WebSocket (web mode, swapped at build time)

### Storage layer (`lib/storage/`)

`AppStateStorage` interface for persisting connections, history, and saved views:
- `rpc.ts` — `RpcAppStateStorage`: delegates to backend via RPC (desktop, default)
- `indexeddb.ts` — `IndexedDbAppStateStorage`: stores in browser IndexedDB (web, swapped at build time)

Both transport and storage use **Vite build-time plugins** to swap implementations. The `index.ts` re-exports the default (`./rpc`), which is redirected to the web adapter via `storageSwapPlugin()` in `vite.config.ts` when building for web mode.

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
