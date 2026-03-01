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
│   ├── keyboard.ts              ← Keyboard shortcut system
│   ├── commands.ts              ← Command registry for command palette
│   ├── mode.ts                  ← Application mode detection (desktop/web, stateless)
│   └── browser-storage.ts       ← localStorage for stateless mode
└── styles/
    └── global.css               ← Global styles, dark theme, CSS variables
```

## State Management

All state uses **Solid.js `createStore` / `createSignal`** — never React patterns (useState, useEffect, etc.).

Data flow: **User action → Component → Store action → RPC call → Store update → Reactive re-render**

Stores are module-level singletons (not context providers). Import directly:
```typescript
import { gridState, loadTableData } from "../stores/grid";
```

## RPC Client (`lib/rpc.ts`)

Typed wrapper over the transport layer. Provides namespace access:
```typescript
import { rpc } from "../lib/rpc";

await rpc.connections.list();
await rpc.data.getTableData({ connectionId, schema, table, ... });
await rpc.query.execute(connectionId, sql, queryId);
```

Also exports `messages` for backend → frontend notifications (connection status changes, menu actions).

### Transport layer (`lib/transport/`)

Abstraction over communication channel:
- `electrobun.ts` — Electrobun RPC (desktop mode)
- `websocket.ts` — WebSocket (web mode)

Auto-detected based on `window.electrobun` availability.

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
