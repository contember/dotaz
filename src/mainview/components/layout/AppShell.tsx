import { createSignal, Show, Switch, Match, onMount, onCleanup } from "solid-js";
import Sidebar, { SidebarExpandButton } from "./Sidebar";
import Resizer from "./Resizer";
import TabBar from "./TabBar";
import StatusBar from "./StatusBar";
import Icon from "../common/Icon";
import ConnectionTree from "../connection/ConnectionTree";
import ConnectionDialog from "../connection/ConnectionDialog";
import QueryHistory from "../history/QueryHistory";
import CommandPalette from "../common/CommandPalette";
import ToastContainer from "../common/Toast";
import DataGrid from "../grid/DataGrid";
import SqlEditor from "../editor/SqlEditor";
import QueryToolbar from "../editor/QueryToolbar";
import SqlResultPanel from "../editor/SqlResultPanel";
import SchemaViewer from "../schema/SchemaViewer";
import type { ConnectionInfo } from "../../../shared/types/connection";
import { tabsStore } from "../../stores/tabs";
import { connectionsStore } from "../../stores/connections";
import { editorStore } from "../../stores/editor";
import { gridStore } from "../../stores/grid";
import { uiStore } from "../../stores/ui";
import { friendlyErrorMessage, messages } from "../../lib/rpc";
import { commandRegistry } from "../../lib/commands";
import { keyboardManager } from "../../lib/keyboard";
import type { ShortcutContext } from "../../lib/keyboard";
import "./AppShell.css";

// Clean up grid/editor state when tabs are closed to prevent memory leaks
tabsStore.onTabClosed((tabId) => {
	gridStore.removeTab(tabId);
	editorStore.removeTab(tabId);
});

const MIN_WIDTH = 150;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 250;

export default function AppShell() {
	const [sidebarWidth, setSidebarWidth] = createSignal(DEFAULT_WIDTH);
	const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
	const [dialogOpen, setDialogOpen] = createSignal(false);
	const [connectionToEdit, setConnectionToEdit] = createSignal<ConnectionInfo | null>(null);
	const [historyOpen, setHistoryOpen] = createSignal(false);
	const [paletteOpen, setPaletteOpen] = createSignal(false);

	function handleResize(deltaX: number) {
		setSidebarWidth((w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + deltaX)));
	}

	function toggleCollapse() {
		setSidebarCollapsed((c) => !c);
	}

	function openAddConnectionDialog() {
		setConnectionToEdit(null);
		setDialogOpen(true);
	}

	function openEditConnectionDialog(conn: ConnectionInfo) {
		setConnectionToEdit(conn);
		setDialogOpen(true);
	}

	let removeMenuListener: (() => void) | undefined;
	let removeResizeListener: (() => void) | undefined;

	function handleDuplicateTab(tabId: string) {
		const sourceTab = tabsStore.openTabs.find((t) => t.id === tabId);
		if (!sourceTab) return;

		if (sourceTab.type === "sql-console") {
			const editorTab = editorStore.getTab(tabId);
			const newTabId = tabsStore.openTab({
				type: "sql-console",
				title: sourceTab.title,
				connectionId: sourceTab.connectionId,
			});
			editorStore.initTab(newTabId, sourceTab.connectionId);
			if (editorTab?.content) {
				editorStore.setContent(newTabId, editorTab.content);
			}
		} else if (sourceTab.type === "data-grid") {
			tabsStore.openTab({
				type: "data-grid",
				title: sourceTab.title,
				connectionId: sourceTab.connectionId,
				schema: sourceTab.schema,
				table: sourceTab.table,
			});
		} else if (sourceTab.type === "schema-viewer") {
			tabsStore.openTab({
				type: "schema-viewer",
				title: sourceTab.title,
				connectionId: sourceTab.connectionId,
				schema: sourceTab.schema,
				table: sourceTab.table,
			});
		}
	}

	// ── Global error handlers ─────────────────────────────
	function handleUnhandledError(event: ErrorEvent) {
		event.preventDefault();
		uiStore.addToast("error", friendlyErrorMessage(event.error ?? event.message));
	}

	function handleUnhandledRejection(event: PromiseRejectionEvent) {
		event.preventDefault();
		uiStore.addToast("error", friendlyErrorMessage(event.reason));
	}

	onMount(() => {
		registerCommands();
		registerShortcuts();
		keyboardManager.setContextProvider((): ShortcutContext => {
			const tab = tabsStore.activeTab;
			if (tab?.type === "data-grid") return "data-grid";
			if (tab?.type === "sql-console") return "sql-console";
			return "global";
		});
		keyboardManager.init();

		// Listen for menu actions from backend
		removeMenuListener = messages.onMenuAction(({ action }) => {
			commandRegistry.execute(action);
		});

		// Global error catching — prevents app crash on unhandled errors
		window.addEventListener("error", handleUnhandledError);
		window.addEventListener("unhandledrejection", handleUnhandledRejection);

		// Responsive: auto-collapse sidebar under 600px
		const mediaQuery = window.matchMedia("(max-width: 600px)");
		function handleMediaChange(e: MediaQueryListEvent | MediaQueryList) {
			if (e.matches && !sidebarCollapsed()) {
				setSidebarCollapsed(true);
			}
		}
		handleMediaChange(mediaQuery);
		mediaQuery.addEventListener("change", handleMediaChange);
		removeResizeListener = () => mediaQuery.removeEventListener("change", handleMediaChange);

		// Transaction warning on tab close
		tabsStore.setBeforeCloseHook((tab) => {
			if (tab.type === "sql-console") {
				const editorTab = editorStore.getTab(tab.id);
				if (editorTab?.inTransaction) {
					const confirmed = window.confirm(
						"This tab has an uncommitted transaction. Changes will be rolled back. Close anyway?",
					);
					if (!confirmed) return false;
					// Fire-and-forget rollback
					editorStore.rollbackTransaction(tab.id);
				}
			}
			return true;
		});

		// Transaction warning on disconnect
		connectionsStore.setBeforeDisconnectHook((connectionId) => {
			// Check if any SQL console tab on this connection has an active transaction
			for (const openTab of tabsStore.openTabs) {
				if (openTab.connectionId === connectionId && openTab.type === "sql-console") {
					const editorTab = editorStore.getTab(openTab.id);
					if (editorTab?.inTransaction) {
						const confirmed = window.confirm(
							"This connection has an active transaction. Changes will be rolled back. Disconnect anyway?",
						);
						if (!confirmed) return false;
						// Fire-and-forget rollback
						editorStore.rollbackTransaction(openTab.id);
						return true;
					}
				}
			}
			return true;
		});
	});

	onCleanup(() => {
		keyboardManager.destroy();
		removeMenuListener?.();
		removeResizeListener?.();
		tabsStore.setBeforeCloseHook(null);
		connectionsStore.setBeforeDisconnectHook(null);
		window.removeEventListener("error", handleUnhandledError);
		window.removeEventListener("unhandledrejection", handleUnhandledRejection);
	});

	// ── Command registration ──────────────────────────────
	function registerCommands() {
		commandRegistry.register({
			id: "command-palette",
			label: "Command Palette",
			shortcut: "Ctrl+Shift+P",
			category: "Navigation",
			handler: () => setPaletteOpen((v) => !v),
		});

		commandRegistry.register({
			id: "new-sql-console",
			label: "New SQL Console",
			shortcut: "Ctrl+N",
			category: "Query",
			handler: () => {
				const conn = connectionsStore.activeConnection;
				if (!conn) return;
				const tabId = tabsStore.openTab({
					type: "sql-console",
					title: `SQL — ${conn.name}`,
					connectionId: conn.id,
				});
				editorStore.initTab(tabId, conn.id);
			},
		});

		commandRegistry.register({
			id: "close-tab",
			label: "Close Tab",
			shortcut: "Ctrl+W",
			category: "Navigation",
			handler: () => {
				const tab = tabsStore.activeTab;
				if (tab) tabsStore.closeTab(tab.id);
			},
		});

		commandRegistry.register({
			id: "close-all-tabs",
			label: "Close All Tabs",
			category: "Navigation",
			handler: () => tabsStore.closeAllTabs(),
		});

		commandRegistry.register({
			id: "next-tab",
			label: "Next Tab",
			shortcut: "Ctrl+Tab",
			category: "Navigation",
			handler: () => tabsStore.activateNextTab(),
		});

		commandRegistry.register({
			id: "prev-tab",
			label: "Previous Tab",
			shortcut: "Ctrl+Shift+Tab",
			category: "Navigation",
			handler: () => tabsStore.activatePrevTab(),
		});

		commandRegistry.register({
			id: "connect",
			label: "Connect",
			category: "Connection",
			handler: () => {
				const conn = connectionsStore.activeConnection;
				if (conn && conn.state === "disconnected") {
					connectionsStore.connectTo(conn.id);
				}
			},
		});

		commandRegistry.register({
			id: "disconnect",
			label: "Disconnect",
			category: "Connection",
			handler: () => {
				const conn = connectionsStore.activeConnection;
				if (conn && conn.state === "connected") {
					connectionsStore.disconnectFrom(conn.id);
				}
			},
		});

		commandRegistry.register({
			id: "format-sql",
			label: "Format SQL",
			shortcut: "Ctrl+Shift+F",
			category: "Query",
			handler: () => {
				const tab = tabsStore.activeTab;
				if (tab?.type === "sql-console") {
					editorStore.formatSql(tab.id);
				}
			},
		});

		commandRegistry.register({
			id: "run-query",
			label: "Run Query",
			shortcut: "Ctrl+Enter",
			category: "Query",
			handler: () => {
				const tab = tabsStore.activeTab;
				if (tab?.type === "sql-console") {
					editorStore.executeQuery(tab.id);
				}
			},
		});

		commandRegistry.register({
			id: "cancel-query",
			label: "Cancel Query",
			shortcut: "Escape",
			category: "Query",
			handler: () => {
				const tab = tabsStore.activeTab;
				if (tab?.type === "sql-console") {
					editorStore.cancelQuery(tab.id);
				}
			},
		});

		commandRegistry.register({
			id: "commit-transaction",
			label: "Commit Transaction",
			shortcut: "Ctrl+Shift+Enter",
			category: "Query",
			handler: () => {
				const tab = tabsStore.activeTab;
				if (tab?.type === "sql-console") {
					editorStore.commitTransaction(tab.id);
				}
			},
		});

		commandRegistry.register({
			id: "rollback-transaction",
			label: "Rollback Transaction",
			shortcut: "Ctrl+Shift+R",
			category: "Query",
			handler: () => {
				const tab = tabsStore.activeTab;
				if (tab?.type === "sql-console") {
					editorStore.rollbackTransaction(tab.id);
				}
			},
		});

		commandRegistry.register({
			id: "refresh-data",
			label: "Refresh Data",
			shortcut: "F5",
			category: "Grid",
			handler: () => {
				const tab = tabsStore.activeTab;
				if (tab?.type === "data-grid") {
					gridStore.refreshData(tab.id);
				}
			},
		});

		commandRegistry.register({
			id: "toggle-sidebar",
			label: "Toggle Sidebar",
			shortcut: "Ctrl+B",
			category: "View",
			handler: () => toggleCollapse(),
		});

		commandRegistry.register({
			id: "save-view",
			label: "Save View",
			shortcut: "Ctrl+S",
			category: "Grid",
			handler: () => {
				// Dispatched as custom event so DataGrid (which owns the save dialog) can handle it
				const tab = tabsStore.activeTab;
				if (tab?.type === "data-grid") {
					window.dispatchEvent(new CustomEvent("dotaz:save-view", { detail: { tabId: tab.id } }));
				}
			},
		});

		commandRegistry.register({
			id: "inline-edit",
			label: "Edit Cell",
			shortcut: "F2",
			category: "Grid",
			handler: () => {
				const tab = tabsStore.activeTab;
				if (tab?.type !== "data-grid") return;
				const gridTab = gridStore.getTab(tab.id);
				if (!gridTab?.focusedCell) return;
				if (gridStore.isRowDeleted(tab.id, gridTab.focusedCell.row)) return;
				gridStore.startEditing(tab.id, gridTab.focusedCell.row, gridTab.focusedCell.column);
			},
		});

		commandRegistry.register({
			id: "delete-rows",
			label: "Delete Selected Rows",
			shortcut: "Delete",
			category: "Grid",
			handler: () => {
				const tab = tabsStore.activeTab;
				if (tab?.type === "data-grid") {
					gridStore.deleteSelectedRows(tab.id);
				}
			},
		});

		commandRegistry.register({
			id: "export-data",
			label: "Export Data",
			category: "Grid",
			handler: () => {
				// Export is managed by the ExportDialog within DataGrid
			},
		});

		commandRegistry.register({
			id: "new-connection",
			label: "New Connection",
			category: "Connection",
			handler: () => openAddConnectionDialog(),
		});

		commandRegistry.register({
			id: "reconnect",
			label: "Reconnect",
			category: "Connection",
			handler: async () => {
				const conn = connectionsStore.activeConnection;
				if (!conn) return;
				if (conn.state === "connected") {
					await connectionsStore.disconnectFrom(conn.id);
				}
				connectionsStore.connectTo(conn.id);
			},
		});

		commandRegistry.register({
			id: "zoom-in",
			label: "Zoom In",
			category: "View",
			shortcut: "Ctrl+=",
			handler: () => {
				const current = parseFloat(document.documentElement.style.zoom || "1");
				document.documentElement.style.zoom = String(Math.min(current + 0.1, 2));
			},
		});

		commandRegistry.register({
			id: "zoom-out",
			label: "Zoom Out",
			category: "View",
			shortcut: "Ctrl+-",
			handler: () => {
				const current = parseFloat(document.documentElement.style.zoom || "1");
				document.documentElement.style.zoom = String(Math.max(current - 0.1, 0.5));
			},
		});

		commandRegistry.register({
			id: "zoom-reset",
			label: "Reset Zoom",
			category: "View",
			shortcut: "Ctrl+0",
			handler: () => {
				document.documentElement.style.zoom = "1";
			},
		});

		commandRegistry.register({
			id: "about",
			label: "About Dotaz",
			category: "Help",
			handler: () => {
				uiStore.addToast("info", "Dotaz — Desktop Database Client");
			},
		});

		commandRegistry.register({
			id: "settings",
			label: "Settings",
			category: "Navigation",
			handler: () => {
				uiStore.addToast("info", "Settings will be available in a future update.");
			},
		});
	}

	// ── Shortcut registration ──────────────────────────────
	function registerShortcuts() {
		// Global shortcuts
		keyboardManager.register("Ctrl+Shift+P", "command-palette");
		keyboardManager.register("Ctrl+N", "new-sql-console");
		keyboardManager.register("Ctrl+W", "close-tab");
		keyboardManager.register("Ctrl+Tab", "next-tab");
		keyboardManager.register("Ctrl+Shift+Tab", "prev-tab");
		keyboardManager.register("Ctrl+B", "toggle-sidebar");

		// SQL console context
		keyboardManager.register("Ctrl+Enter", "run-query", "sql-console");
		keyboardManager.register("Ctrl+Shift+F", "format-sql", "sql-console");
		keyboardManager.register("Ctrl+Shift+Enter", "commit-transaction", "sql-console");
		keyboardManager.register("Ctrl+Shift+R", "rollback-transaction", "sql-console");

		// Data grid context
		keyboardManager.register("F5", "refresh-data", "data-grid");
		keyboardManager.register("F2", "inline-edit", "data-grid");
		keyboardManager.register("Delete", "delete-rows", "data-grid");
		keyboardManager.register("Ctrl+S", "save-view", "data-grid");
	}

	return (
		<div class="app-shell">
			<div class="app-shell__body">
				<Show when={sidebarCollapsed()}>
					<SidebarExpandButton onClick={toggleCollapse} />
				</Show>

				<Sidebar
					width={sidebarWidth()}
					collapsed={sidebarCollapsed()}
					onToggleCollapse={toggleCollapse}
					onAdd={openAddConnectionDialog}
				>
					<ConnectionTree onAddConnection={openAddConnectionDialog} onEditConnection={openEditConnectionDialog} />
				</Sidebar>

				<Show when={!sidebarCollapsed()}>
					<Resizer onResize={handleResize} />
				</Show>

				<div class="app-shell__main">
					<TabBar
						tabs={tabsStore.openTabs}
						activeTabId={tabsStore.activeTabId}
						onSelectTab={tabsStore.setActiveTab}
						onCloseTab={tabsStore.closeTab}
						onCloseOtherTabs={tabsStore.closeOtherTabs}
						onCloseAllTabs={tabsStore.closeAllTabs}
						onDuplicateTab={handleDuplicateTab}
						onRenameTab={tabsStore.renameTab}
					/>
					<main class="main-content">
						<Show when={tabsStore.openTabs.length === 0}>
							<div class="welcome-screen">
								<Icon name="database" size={40} class="welcome-screen__icon" />
								<h2 class="welcome-screen__title">Dotaz</h2>
								<p class="welcome-screen__subtitle">
									Open a connection and select a table to get started.
								</p>
							</div>
						</Show>
						<Show when={tabsStore.activeTab} keyed>
							{(tab) => (
								<Switch>
									<Match when={tab.type === "data-grid"}>
										<DataGrid
											tabId={tab.id}
											connectionId={tab.connectionId}
											schema={tab.schema!}
											table={tab.table!}
										/>
									</Match>
									<Match when={tab.type === "sql-console"}>
										<div class="sql-console">
											<QueryToolbar
												tabId={tab.id}
												connectionId={tab.connectionId}
												onOpenHistory={() => setHistoryOpen(true)}
											/>
											<SqlEditor
												tabId={tab.id}
												connectionId={tab.connectionId}
											/>
											<SqlResultPanel
												tabId={tab.id}
												connectionId={tab.connectionId}
											/>
										</div>
									</Match>
									<Match when={tab.type === "schema-viewer"}>
										<SchemaViewer
											tabId={tab.id}
											connectionId={tab.connectionId}
											schema={tab.schema!}
											table={tab.table!}
										/>
									</Match>
								</Switch>
							)}
						</Show>
					</main>
				</div>
			</div>

			<StatusBar
			connectionName={(() => {
				const tab = tabsStore.activeTab;
				if (!tab) return undefined;
				return connectionsStore.connections.find(c => c.id === tab.connectionId)?.name;
			})()}
			connectionStatus={(() => {
				const tab = tabsStore.activeTab;
				if (!tab) return undefined;
				const conn = connectionsStore.connections.find(c => c.id === tab.connectionId);
				return conn?.state as any;
			})()}
			inTransaction={(() => {
				const tab = tabsStore.activeTab;
				if (!tab) return false;
				// Check if any SQL console tab on this connection has an active transaction
				for (const openTab of tabsStore.openTabs) {
					if (openTab.connectionId === tab.connectionId && openTab.type === "sql-console") {
						const editorTab = editorStore.getTab(openTab.id);
						if (editorTab?.inTransaction) return true;
					}
				}
				return false;
			})()}
		/>

			<ConnectionDialog
				open={dialogOpen()}
				connection={connectionToEdit()}
				onClose={() => setDialogOpen(false)}
			/>

			<QueryHistory
				open={historyOpen()}
				onClose={() => setHistoryOpen(false)}
			/>

			<CommandPalette
				open={paletteOpen()}
				onClose={() => setPaletteOpen(false)}
			/>

			<ToastContainer />
		</div>
	);
}
