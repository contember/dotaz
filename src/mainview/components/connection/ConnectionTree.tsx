import { createSignal, For, Show, type JSX } from "solid-js";
import type { ConnectionInfo, ConnectionState } from "../../../shared/types/connection";
import type { SchemaInfo, TableInfo } from "../../../shared/types/database";
import type { SavedView } from "../../../shared/types/rpc";
import { connectionsStore } from "../../stores/connections";
import { tabsStore } from "../../stores/tabs";
import { viewsStore } from "../../stores/views";
import { gridStore } from "../../stores/grid";
import { rpc } from "../../lib/rpc";
import { siPostgresql, siSqlite } from "simple-icons";
import { Eye, Table, Bookmark, FolderOpen, Plus } from "lucide-solid";
import ContextMenu, { type ContextMenuEntry } from "../common/ContextMenu";
import ConnectionTreeItem from "./ConnectionTreeItem";
import "./ConnectionTree.css";

interface ConnectionTreeProps {
	onAddConnection: () => void;
	onEditConnection: (conn: ConnectionInfo) => void;
}

const STATUS_COLORS: Record<ConnectionState, string | undefined> = {
	connected: "var(--color-success)",
	connecting: "var(--color-warning)",
	reconnecting: "var(--color-warning)",
	error: "var(--color-error)",
	disconnected: undefined,
};

function SimpleIcon(props: { icon: typeof siPostgresql; size?: number }) {
	const s = () => props.size ?? 14;
	return (
		<svg width={s()} height={s()} viewBox="0 0 24 24" fill={`#${props.icon.hex}`} aria-hidden="true">
			<path d={props.icon.path} />
		</svg>
	);
}

function getConnectionIcon(type: string): JSX.Element {
	return type === "postgresql"
		? <SimpleIcon icon={siPostgresql} />
		: <SimpleIcon icon={siSqlite} />;
}

interface ContextMenuState {
	x: number;
	y: number;
	items: ContextMenuEntry[];
}

export default function ConnectionTree(props: ConnectionTreeProps) {
	const [expandedConnections, setExpandedConnections] = createSignal<Set<string>>(new Set());
	const [expandedSchemas, setExpandedSchemas] = createSignal<Set<string>>(new Set());
	const [expandedTables, setExpandedTables] = createSignal<Set<string>>(new Set());
	const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);

	function isConnectionExpanded(id: string): boolean {
		return expandedConnections().has(id);
	}

	function isSchemaExpanded(key: string): boolean {
		return expandedSchemas().has(key);
	}

	function isTableExpanded(key: string): boolean {
		return expandedTables().has(key);
	}

	function toggleTable(tableKey: string) {
		setExpandedTables((prev) => {
			const next = new Set(prev);
			if (next.has(tableKey)) {
				next.delete(tableKey);
			} else {
				next.add(tableKey);
			}
			return next;
		});
	}

	function tableKey(connectionId: string, schemaName: string, tableName: string): string {
		return `${connectionId}:${schemaName}:${tableName}`;
	}

	function toggleConnection(conn: ConnectionInfo) {
		if (conn.state === "disconnected" || conn.state === "error") {
			connectionsStore.connectTo(conn.id);
			// Expand when connecting
			setExpandedConnections((prev) => {
				const next = new Set(prev);
				next.add(conn.id);
				return next;
			});
			return;
		}

		const isExpanding = !expandedConnections().has(conn.id);
		setExpandedConnections((prev) => {
			const next = new Set(prev);
			if (next.has(conn.id)) {
				next.delete(conn.id);
			} else {
				next.add(conn.id);
			}
			return next;
		});

		// Load views when expanding
		if (isExpanding && conn.state === "connected") {
			viewsStore.loadViewsForConnection(conn.id).then(() => {
				// Auto-expand tables that have views
				autoExpandTablesWithViews(conn.id);
			});
		}
	}

	function autoExpandTablesWithViews(connectionId: string) {
		const tree = connectionsStore.getSchemaTree(connectionId);
		if (!tree) return;

		setExpandedTables((prev) => {
			const next = new Set(prev);
			for (const schema of tree.schemas) {
				const tables = tree.tables[schema.name] ?? [];
				for (const table of tables) {
					const views = viewsStore.getViewsForTable(connectionId, schema.name, table.name);
					if (views.length > 0) {
						next.add(tableKey(connectionId, schema.name, table.name));
					}
				}
			}
			return next;
		});
	}

	function toggleSchema(schemaKey: string) {
		setExpandedSchemas((prev) => {
			const next = new Set(prev);
			if (next.has(schemaKey)) {
				next.delete(schemaKey);
			} else {
				next.add(schemaKey);
			}
			return next;
		});
	}

	function handleTableClick(connectionId: string, schema: string, table: string) {
		// Reuse existing default tab for this table
		const existing = tabsStore.findDefaultTab(connectionId, schema, table);
		if (existing) return;

		tabsStore.openTab({
			type: "data-grid",
			title: table,
			connectionId,
			schema,
			table,
		});
	}

	function handleViewClick(connectionId: string, schema: string, table: string, view: SavedView) {
		// Reuse existing view tab
		const existing = tabsStore.findViewTab(view.id);
		if (existing) return;

		const tabId = tabsStore.openTab({
			type: "data-grid",
			title: table,
			connectionId,
			schema,
			table,
			viewId: view.id,
			viewName: view.name,
		});

		// Apply the saved view config once grid data is loaded
		gridStore.loadTableData(tabId, connectionId, schema, table).then(() => {
			gridStore.setActiveView(tabId, view.id, view.name);
			gridStore.applyViewConfig(tabId, view.config);
		});
	}

	function schemaKey(connectionId: string, schemaName: string): string {
		return `${connectionId}:${schemaName}`;
	}

	function isLoading(conn: ConnectionInfo): boolean {
		return conn.state === "connecting" ||
			(conn.state === "connected" && !connectionsStore.getSchemaTree(conn.id));
	}

	// ── Context menu builders ────────────────────────────

	function showContextMenu(e: MouseEvent, items: ContextMenuEntry[]) {
		e.preventDefault();
		e.stopPropagation();
		setContextMenu({ x: e.clientX, y: e.clientY, items });
	}

	function connectionMenuItems(conn: ConnectionInfo): ContextMenuEntry[] {
		const isConnected = conn.state === "connected";
		const isDisconnected = conn.state === "disconnected" || conn.state === "error";

		return [
			{
				label: "Connect",
				action: () => connectionsStore.connectTo(conn.id),
				disabled: !isDisconnected,
			},
			{
				label: "Disconnect",
				action: () => connectionsStore.disconnectFrom(conn.id),
				disabled: !isConnected,
			},
			"separator",
			{
				label: "Edit",
				action: () => props.onEditConnection(conn),
			},
			{
				label: "Duplicate",
				action: () => {
					connectionsStore.createConnection(
						`${conn.name} (copy)`,
						conn.config,
					);
				},
			},
			"separator",
			{
				label: "Delete",
				action: () => {
					const confirmed = window.confirm(
						`Delete connection "${conn.name}"? This cannot be undone.`,
					);
					if (confirmed) {
						connectionsStore.deleteConnection(conn.id);
					}
				},
			},
		];
	}

	function schemaMenuItems(connectionId: string, schemaName: string): ContextMenuEntry[] {
		return [
			{
				label: "New SQL Console",
				action: () => {
					tabsStore.openTab({
						type: "sql-console",
						title: `SQL — ${schemaName}`,
						connectionId,
						schema: schemaName,
					});
				},
			},
		];
	}

	function tableMenuItems(connectionId: string, schemaName: string, tableName: string): ContextMenuEntry[] {
		return [
			{
				label: "Open Data",
				action: () => handleTableClick(connectionId, schemaName, tableName),
			},
			{
				label: "New SQL Console",
				action: () => {
					tabsStore.openTab({
						type: "sql-console",
						title: `SQL — ${tableName}`,
						connectionId,
						schema: schemaName,
						table: tableName,
					});
				},
			},
			{
				label: "View Schema",
				action: () => {
					tabsStore.openTab({
						type: "schema-viewer",
						title: `Schema — ${tableName}`,
						connectionId,
						schema: schemaName,
						table: tableName,
					});
				},
			},
		];
	}

	function viewMenuItems(connectionId: string, view: SavedView): ContextMenuEntry[] {
		return [
			{
				label: "Open",
				action: () => handleViewClick(connectionId, view.schemaName, view.tableName, view),
			},
			{
				label: "Rename",
				action: async () => {
					const newName = window.prompt("Rename view:", view.name);
					if (newName && newName.trim() && newName.trim() !== view.name) {
						try {
							await rpc.views.update({
								id: view.id,
								name: newName.trim(),
								config: view.config,
							});
							await viewsStore.refreshViews(connectionId);
						} catch {
							// Ignore rename errors
						}
					}
				},
			},
			"separator",
			{
				label: "Delete",
				action: async () => {
					const confirmed = window.confirm(
						`Delete view "${view.name}"? This cannot be undone.`,
					);
					if (confirmed) {
						try {
							await rpc.views.delete(view.id);
							await viewsStore.refreshViews(connectionId);
						} catch {
							// Ignore delete errors
						}
					}
				},
			},
		];
	}

	// ── Table rendering helper with optional views ──────

	function renderTable(conn: ConnectionInfo, schema: SchemaInfo, table: TableInfo, baseLevel: number) {
		const tKey = tableKey(conn.id, schema.name, table.name);
		const views = () => viewsStore.getViewsForTable(conn.id, schema.name, table.name);
		const hasViews = () => views().length > 0;
		const tExpanded = () => isTableExpanded(tKey);

		return (
			<>
				<ConnectionTreeItem
					label={table.name}
					level={baseLevel}
					type="table"
					icon={table.type === "view" ? <Eye size={14} /> : <Table size={14} />}
					expanded={hasViews() ? tExpanded() : undefined}
					hasChildren={hasViews()}
					onClick={() => handleTableClick(conn.id, schema.name, table.name)}
					onToggle={hasViews() ? () => toggleTable(tKey) : undefined}
					onContextMenu={(e) => showContextMenu(e, tableMenuItems(conn.id, schema.name, table.name))}
				/>
				<Show when={hasViews() && tExpanded()}>
					<For each={views()}>
						{(view) => (
							<ConnectionTreeItem
								label={view.name}
								level={baseLevel + 1}
								type="view"
								icon={<Bookmark size={14} />}
								onClick={() => handleViewClick(conn.id, schema.name, table.name, view)}
								onContextMenu={(e) => showContextMenu(e, viewMenuItems(conn.id, view))}
							/>
						)}
					</For>
				</Show>
			</>
		);
	}

	return (
		<div class="connection-tree">
			<Show
				when={connectionsStore.connections.length > 0}
				fallback={
					<div class="connection-tree__empty">
						<span>No connections</span>
						<button class="connection-tree__empty-cta" onClick={props.onAddConnection}>
							<Plus size={14} /> Add Connection
						</button>
					</div>
				}
			>
				<For each={connectionsStore.connections}>
					{(conn) => {
						const tree = () => connectionsStore.getSchemaTree(conn.id);
						const schemas = () => tree()?.schemas ?? [];
						const expanded = () => isConnectionExpanded(conn.id);
						const loading = () => isLoading(conn);
						const hasSchemas = () => conn.state === "connected" && schemas().length > 0;

						return (
							<>
								<ConnectionTreeItem
									label={conn.name}
									level={0}
									type="connection"
									icon={getConnectionIcon(conn.config.type)}
									expanded={expanded()}
									hasChildren={true}
									statusColor={STATUS_COLORS[conn.state]}
									loading={loading()}
									onClick={() => toggleConnection(conn)}
									onToggle={() => toggleConnection(conn)}
									onContextMenu={(e) => showContextMenu(e, connectionMenuItems(conn))}
								/>

								<Show when={expanded() && !loading() && hasSchemas()}>
									<For each={schemas()}>
										{(schema: SchemaInfo) => {
											const sKey = () => schemaKey(conn.id, schema.name);
											const tables = () => tree()?.tables[schema.name] ?? [];
											const sExpanded = () => isSchemaExpanded(sKey());

											// For SQLite with only "main" schema, skip schema level
											const isSingleSchema = () => schemas().length === 1 && schema.name === "main";

											return (
												<Show
													when={!isSingleSchema()}
													fallback={
														<For each={tables()}>
															{(table: TableInfo) => renderTable(conn, schema, table, 1)}
														</For>
													}
												>
													<ConnectionTreeItem
														label={schema.name}
														level={1}
														type="schema"
														icon={<FolderOpen size={14} />}
														expanded={sExpanded()}
														hasChildren={tables().length > 0}
														onToggle={() => toggleSchema(sKey())}
														onClick={() => toggleSchema(sKey())}
														onContextMenu={(e) => showContextMenu(e, schemaMenuItems(conn.id, schema.name))}
													/>

													<Show when={sExpanded()}>
														<For each={tables()}>
															{(table: TableInfo) => renderTable(conn, schema, table, 2)}
														</For>
													</Show>
												</Show>
											);
										}}
									</For>
								</Show>
							</>
						);
					}}
				</For>
			</Show>

			<Show when={contextMenu()}>
				{(menu) => (
					<ContextMenu
						x={menu().x}
						y={menu().y}
						items={menu().items}
						onClose={() => setContextMenu(null)}
					/>
				)}
			</Show>
		</div>
	);
}
