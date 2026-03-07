import Bookmark from 'lucide-solid/icons/bookmark'
import Database from 'lucide-solid/icons/database'
import Eye from 'lucide-solid/icons/eye'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Lock from 'lucide-solid/icons/lock'
import Plus from 'lucide-solid/icons/plus'
import SquareTerminal from 'lucide-solid/icons/square-terminal'
import Table from 'lucide-solid/icons/table'
import { siMysql, siPostgresql, siSqlite } from 'simple-icons'
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js'
import type { ConnectionInfo, ConnectionState, ConnectionType } from '../../../shared/types/connection'
import { CONNECTION_TYPE_META, getDefaultDatabase } from '../../../shared/types/connection'
import type { SchemaInfo, TableInfo } from '../../../shared/types/database'
import type { SavedView } from '../../../shared/types/rpc'
import { rpc } from '../../lib/rpc'
import type { SchemaTree } from '../../stores/connections'
import { connectionsStore } from '../../stores/connections'
import { editorStore } from '../../stores/editor'
import { gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import { uiStore } from '../../stores/ui'
import { viewsStore } from '../../stores/views'
import ContextMenu, { type ContextMenuEntry } from '../common/ContextMenu'
import Icon from '../common/Icon'
import ConnectionTreeItem from './ConnectionTreeItem'
import type { TreeItemAction } from './ConnectionTreeItem'
import './ConnectionTree.css'

interface ConnectionTreeProps {
	onAddConnection: () => void
	onEditConnection: (conn: ConnectionInfo) => void
	onManageDatabases?: (conn: ConnectionInfo) => void
}

const STATUS_COLORS: Record<ConnectionState, string | undefined> = {
	connected: 'var(--success)',
	connecting: 'var(--warning)',
	reconnecting: 'var(--warning)',
	error: 'var(--error)',
	disconnected: undefined,
}

function SimpleIcon(props: { icon: typeof siPostgresql; size?: number }) {
	const s = () => props.size ?? 14
	return (
		<svg width={s()} height={s()} viewBox="0 0 24 24" fill={`#${props.icon.hex}`} aria-hidden="true">
			<path d={props.icon.path} />
		</svg>
	)
}

const CONNECTION_ICONS: Record<ConnectionType, typeof siPostgresql> = {
	postgresql: siPostgresql,
	sqlite: siSqlite,
	mysql: siMysql,
}

function getConnectionIcon(type: ConnectionType): JSX.Element {
	return <SimpleIcon icon={CONNECTION_ICONS[type] ?? siSqlite} />
}

interface ContextMenuState {
	x: number
	y: number
	items: ContextMenuEntry[]
}

export default function ConnectionTree(props: ConnectionTreeProps) {
	const [expandedConnections, setExpandedConnections] = createSignal<Set<string>>(new Set())
	const [expandedDatabases, setExpandedDatabases] = createSignal<Set<string>>(new Set())
	const [expandedSchemas, setExpandedSchemas] = createSignal<Set<string>>(new Set())
	const [expandedTables, setExpandedTables] = createSignal<Set<string>>(new Set())
	const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null)

	// ── Navigator filter ─────────────────────────────────
	const [filterInput, setFilterInput] = createSignal('')
	const [filterTerm, setFilterTerm] = createSignal('')
	let filterDebounceTimer: ReturnType<typeof setTimeout> | undefined
	let searchInputRef: HTMLInputElement | undefined

	function handleFilterInput(value: string) {
		setFilterInput(value)
		if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
		filterDebounceTimer = setTimeout(() => {
			setFilterTerm(value.toLowerCase().trim())
		}, 150)
	}

	function handleClearFilter() {
		setFilterInput('')
		setFilterTerm('')
		if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
		searchInputRef?.focus()
	}

	/** Check if a table/view name matches the current filter */
	function matchesFilter(name: string): boolean {
		const term = filterTerm()
		if (!term) return true
		return name.toLowerCase().includes(term)
	}

	/** Filter tables in a schema, returns only those matching */
	function filteredTables(tables: TableInfo[]): TableInfo[] {
		const term = filterTerm()
		if (!term) return tables
		return tables.filter((t) => matchesFilter(t.name))
	}

	/** Check if any table in a schema matches */
	function schemaHasMatch(tree: SchemaTree, schemaName: string): boolean {
		const term = filterTerm()
		if (!term) return true
		const tables = tree.tables[schemaName] ?? []
		return tables.some((t) => matchesFilter(t.name))
	}

	/** Check if any table in a connection matches */
	function connectionHasMatch(connectionId: string): boolean {
		const term = filterTerm()
		if (!term) return true
		const tree = connectionsStore.getSchemaTree(connectionId)
		if (!tree) return true // Show loading connections
		return tree.schemas.some((s) => schemaHasMatch(tree, s.name))
	}

	/** Check if any table in a database matches */
	function databaseHasMatch(connectionId: string, dbName: string): boolean {
		const term = filterTerm()
		if (!term) return true
		const tree = connectionsStore.getSchemaTree(connectionId, dbName)
		if (!tree) return true
		return tree.schemas.some((s) => schemaHasMatch(tree, s.name))
	}

	// Focus search on Ctrl+F when sidebar is focused
	function handleTreeKeyDown(e: KeyboardEvent) {
		if (e.key === 'f' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
			e.preventDefault()
			e.stopPropagation()
			searchInputRef?.focus()
		}
	}

	// Listen for global "focus navigator filter" event (Ctrl+Shift+L)
	function handleFocusFilter() {
		searchInputRef?.focus()
	}
	window.addEventListener('dotaz:focus-navigator-filter', handleFocusFilter)

	onCleanup(() => {
		if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
		window.removeEventListener('dotaz:focus-navigator-filter', handleFocusFilter)
	})

	function isConnectionExpanded(id: string): boolean {
		return expandedConnections().has(id)
	}

	function isDatabaseExpanded(key: string): boolean {
		return expandedDatabases().has(key)
	}

	function isSchemaExpanded(key: string): boolean {
		return expandedSchemas().has(key)
	}

	function isTableExpanded(key: string): boolean {
		return expandedTables().has(key)
	}

	function toggleTable(tableKey: string) {
		setExpandedTables((prev) => {
			const next = new Set(prev)
			if (next.has(tableKey)) {
				next.delete(tableKey)
			} else {
				next.add(tableKey)
			}
			return next
		})
	}

	function tableKey(connectionId: string, schemaName: string, tableName: string, database?: string): string {
		return database
			? `${connectionId}:${database}:${schemaName}:${tableName}`
			: `${connectionId}:${schemaName}:${tableName}`
	}

	function databaseKey(connectionId: string, dbName: string): string {
		return `${connectionId}:db:${dbName}`
	}

	function toggleDatabase(key: string) {
		setExpandedDatabases((prev) => {
			const next = new Set(prev)
			if (next.has(key)) {
				next.delete(key)
			} else {
				next.add(key)
			}
			return next
		})
	}

	function toggleConnection(conn: ConnectionInfo) {
		if (conn.state === 'disconnected' || conn.state === 'error') {
			connectionsStore.connectTo(conn.id)
			// Expand when connecting
			setExpandedConnections((prev) => {
				const next = new Set(prev)
				next.add(conn.id)
				return next
			})
			return
		}

		const isExpanding = !expandedConnections().has(conn.id)
		setExpandedConnections((prev) => {
			const next = new Set(prev)
			if (next.has(conn.id)) {
				next.delete(conn.id)
			} else {
				next.add(conn.id)
			}
			return next
		})

		// Load views when expanding
		if (isExpanding && conn.state === 'connected') {
			viewsStore.loadViewsForConnection(conn.id).then(() => {
				// Auto-expand tables that have views
				autoExpandTablesWithViews(conn.id)
			}).catch(() => {
				uiStore.addToast('warning', 'Failed to load saved views.')
			})
		}
	}

	function autoExpandTablesWithViews(connectionId: string) {
		const tree = connectionsStore.getSchemaTree(connectionId)
		if (!tree) return

		setExpandedTables((prev) => {
			const next = new Set(prev)
			for (const schema of tree.schemas) {
				const tables = tree.tables[schema.name] ?? []
				for (const table of tables) {
					const views = viewsStore.getViewsForTable(connectionId, schema.name, table.name)
					if (views.length > 0) {
						next.add(tableKey(connectionId, schema.name, table.name))
					}
				}
			}
			return next
		})
	}

	function toggleSchema(schemaKey: string) {
		setExpandedSchemas((prev) => {
			const next = new Set(prev)
			if (next.has(schemaKey)) {
				next.delete(schemaKey)
			} else {
				next.add(schemaKey)
			}
			return next
		})
	}

	function handleTableClick(connectionId: string, schema: string, table: string, database?: string) {
		// Reuse existing default tab for this table
		const existing = tabsStore.findDefaultTab(connectionId, schema, table, database)
		if (existing) return

		tabsStore.openTab({
			type: 'data-grid',
			title: table,
			connectionId,
			schema,
			table,
			database,
		})
	}

	function handleViewClick(connectionId: string, schema: string, table: string, view: SavedView, database?: string) {
		// Reuse existing view tab
		const existing = tabsStore.findViewTab(view.id)
		if (existing) return

		const tabId = tabsStore.openTab({
			type: 'data-grid',
			title: table,
			connectionId,
			schema,
			table,
			database,
			viewId: view.id,
			viewName: view.name,
		})

		// Apply the saved view config once grid data is loaded
		gridStore.loadTableData(tabId, connectionId, schema, table, database).then(() => {
			gridStore.setActiveView(tabId, view.id, view.name)
			gridStore.applyViewConfig(tabId, view.config)
		}).catch(() => {
			uiStore.addToast('warning', 'Failed to load table data for saved view.')
		})
	}

	function schemaKey(connectionId: string, schemaName: string, database?: string): string {
		return database
			? `${connectionId}:${database}:${schemaName}`
			: `${connectionId}:${schemaName}`
	}

	function isLoading(conn: ConnectionInfo): boolean {
		return conn.state === 'connecting'
			|| (conn.state === 'connected' && !connectionsStore.getSchemaTree(conn.id))
	}

	/** Check if this connection has multiple active databases */
	function hasMultipleDatabases(conn: ConnectionInfo): boolean {
		if (!CONNECTION_TYPE_META[conn.config.type].supportsMultiDatabase) return false
		return connectionsStore.getActiveDatabaseNames(conn.id).length > 1
	}

	// ── Context menu builders ────────────────────────────

	function showContextMenu(e: MouseEvent, items: ContextMenuEntry[]) {
		e.preventDefault()
		e.stopPropagation()
		setContextMenu({ x: e.clientX, y: e.clientY, items })
	}

	function connectionMenuItems(conn: ConnectionInfo): ContextMenuEntry[] {
		const isConnected = conn.state === 'connected'
		const isDisconnected = conn.state === 'disconnected' || conn.state === 'error'
		const supportsMultiDb = CONNECTION_TYPE_META[conn.config.type].supportsMultiDatabase

		const defaultDb = supportsMultiDb ? getDefaultDatabase(conn.config) : undefined

		const items: ContextMenuEntry[] = [
			{
				label: 'New SQL Console',
				action: () => {
					const tabId = tabsStore.openTab({
						type: 'sql-console',
						title: `SQL — ${conn.name}`,
						connectionId: conn.id,
						database: defaultDb,
					})
					editorStore.initTab(tabId, conn.id, defaultDb)
				},
				disabled: !isConnected,
			},
			'separator',
			{
				label: 'Connect',
				action: () => connectionsStore.connectTo(conn.id),
				disabled: !isDisconnected,
			},
			{
				label: 'Disconnect',
				action: () => connectionsStore.disconnectFrom(conn.id),
				disabled: !isConnected,
			},
		]

		if (supportsMultiDb) {
			items.push('separator')
			items.push({
				label: 'Manage Databases...',
				action: () => props.onManageDatabases?.(conn),
				disabled: !isConnected,
			})
		}

		items.push('separator', {
			label: 'Search Database...',
			action: () => {
				window.dispatchEvent(
					new CustomEvent('dotaz:open-search', {
						detail: { connectionId: conn.id },
					}),
				)
			},
			disabled: !isConnected,
		})

		items.push(
			'separator',
			{
				label: conn.readOnly ? 'Disable Read-Only' : 'Enable Read-Only',
				action: () => connectionsStore.setReadOnly(conn.id, !conn.readOnly),
			},
			'separator',
			{
				label: 'Edit',
				action: () => props.onEditConnection(conn),
			},
			{
				label: 'Duplicate',
				action: () => {
					connectionsStore.createConnection(
						`${conn.name} (copy)`,
						conn.config,
					)
				},
			},
			'separator',
			{
				label: 'Delete',
				action: () => {
					const confirmed = window.confirm(
						`Delete connection "${conn.name}"? This cannot be undone.`,
					)
					if (confirmed) {
						connectionsStore.deleteConnection(conn.id)
					}
				},
			},
		)

		return items
	}

	function databaseMenuItems(connectionId: string, dbName: string, isDefault: boolean): ContextMenuEntry[] {
		const items: ContextMenuEntry[] = [
			{
				label: 'New SQL Console',
				action: () => {
					const tabId = tabsStore.openTab({
						type: 'sql-console',
						title: `SQL — ${dbName}`,
						connectionId,
						database: dbName,
					})
					editorStore.initTab(tabId, connectionId, dbName)
				},
			},
		]

		if (!isDefault) {
			items.push('separator')
			items.push({
				label: 'Deactivate',
				action: () => connectionsStore.deactivateDatabase(connectionId, dbName),
			})
		}

		return items
	}

	function tableMenuItems(connectionId: string, schemaName: string, tableName: string, database?: string): ContextMenuEntry[] {
		const conn = connectionsStore.connections.find((c) => c.id === connectionId)
		const items: ContextMenuEntry[] = [
			{
				label: 'Open Data',
				action: () => handleTableClick(connectionId, schemaName, tableName, database),
			},
			{
				label: 'View Schema',
				action: () => {
					tabsStore.openTab({
						type: 'schema-viewer',
						title: `Schema — ${tableName}`,
						connectionId,
						schema: schemaName,
						table: tableName,
						database,
					})
				},
			},
		]

		items.push('separator', {
			label: 'Search in Table...',
			action: () => {
				window.dispatchEvent(
					new CustomEvent('dotaz:open-search', {
						detail: { connectionId, scope: 'tables', table: tableName, schema: schemaName, database },
					}),
				)
			},
		})

		if (!conn?.readOnly) {
			items.push('separator', {
				label: 'Import Data...',
				action: () => {
					handleTableClick(connectionId, schemaName, tableName, database)
					// Use a short delay to let the tab render, then dispatch open-import event
					setTimeout(() => {
						window.dispatchEvent(
							new CustomEvent('dotaz:open-import', {
								detail: { connectionId, schema: schemaName, table: tableName, database },
							}),
						)
					}, 100)
				},
			})
		}

		return items
	}

	function viewMenuItems(connectionId: string, view: SavedView, database?: string): ContextMenuEntry[] {
		return [
			{
				label: 'Open',
				action: () => handleViewClick(connectionId, view.schemaName, view.tableName, view, database),
			},
			{
				label: 'Rename',
				action: async () => {
					const newName = window.prompt('Rename view:', view.name)
					if (newName?.trim() && newName.trim() !== view.name) {
						try {
							await rpc.views.update({
								id: view.id,
								name: newName.trim(),
								config: view.config,
							})
							await viewsStore.refreshViews(connectionId)
						} catch {
							// Ignore rename errors
						}
					}
				},
			},
			'separator',
			{
				label: 'Delete',
				action: async () => {
					const confirmed = window.confirm(
						`Delete view "${view.name}"? This cannot be undone.`,
					)
					if (confirmed) {
						try {
							await rpc.views.delete({ id: view.id })
							await viewsStore.refreshViews(connectionId)
						} catch {
							// Ignore delete errors
						}
					}
				},
			},
		]
	}

	// ── Hover action builders ────────────────────────────

	function sqlConsoleAction(connectionId: string, label: string, database?: string): TreeItemAction {
		return {
			icon: <SquareTerminal size={14} />,
			title: 'New SQL Console',
			onClick: () => {
				const tabId = tabsStore.openTab({
					type: 'sql-console',
					title: `SQL — ${label}`,
					connectionId,
					database,
				})
				editorStore.initTab(tabId, connectionId, database)
			},
		}
	}

	// ── Table rendering helper with optional views ──────

	function renderTable(conn: ConnectionInfo, schema: SchemaInfo, table: TableInfo, baseLevel: number, database?: string) {
		const tKey = tableKey(conn.id, schema.name, table.name, database)
		const views = () => viewsStore.getViewsForTable(conn.id, schema.name, table.name)
		const hasViews = () => views().length > 0
		const tExpanded = () => isTableExpanded(tKey)

		return (
			<>
				<ConnectionTreeItem
					label={table.name}
					level={baseLevel}
					type="table"
					icon={table.type === 'view' ? <Eye size={14} /> : <Table size={14} />}
					expanded={hasViews() ? tExpanded() : undefined}
					hasChildren={hasViews()}
					onClick={() => handleTableClick(conn.id, schema.name, table.name, database)}
					onToggle={hasViews() ? () => toggleTable(tKey) : undefined}
					onContextMenu={(e) => showContextMenu(e, tableMenuItems(conn.id, schema.name, table.name, database))}
				/>
				<Show when={hasViews() && tExpanded()}>
					<For each={views()}>
						{(view) => (
							<ConnectionTreeItem
								label={view.name}
								level={baseLevel + 1}
								type="view"
								icon={<Bookmark size={14} />}
								onClick={() => handleViewClick(conn.id, schema.name, table.name, view, database)}
								onContextMenu={(e) => showContextMenu(e, viewMenuItems(conn.id, view, database))}
							/>
						)}
					</For>
				</Show>
			</>
		)
	}

	// ── Filter active check ───────────────────────────────
	const isFiltering = () => filterTerm().length > 0

	// ── Schema tree rendering (shared between database and non-database views) ──

	function renderSchemaTree(conn: ConnectionInfo, tree: SchemaTree, schemas: SchemaInfo[], baseLevel: number, database?: string) {
		return (
			<For each={schemas}>
				{(schema: SchemaInfo) => {
					const sKey = () => schemaKey(conn.id, schema.name, database)
					const tables = () => {
						const allTables = tree.tables[schema.name] ?? []
						return isFiltering() ? filteredTables(allTables) : allTables
					}
					const sExpanded = () => isFiltering() || isSchemaExpanded(sKey())

					// For SQLite with only "main" schema, skip schema level
					const isSingleSchema = () => schemas.length === 1 && schema.name === 'main'

					// Hide schema if filtering and no tables match
					const visible = () => !isFiltering() || schemaHasMatch(tree, schema.name)

					return (
						<Show when={visible()}>
							<Show
								when={!isSingleSchema()}
								fallback={
									<For each={tables()}>
										{(table: TableInfo) => renderTable(conn, schema, table, baseLevel, database)}
									</For>
								}
							>
								<ConnectionTreeItem
									label={schema.name}
									level={baseLevel}
									type="schema"
									icon={<FolderOpen size={14} />}
									expanded={sExpanded()}
									hasChildren={tables().length > 0}
									onToggle={() => toggleSchema(sKey())}
									onClick={() => toggleSchema(sKey())}
								/>

								<Show when={sExpanded()}>
									<For each={tables()}>
										{(table: TableInfo) => renderTable(conn, schema, table, baseLevel + 1, database)}
									</For>
								</Show>
							</Show>
						</Show>
					)
				}}
			</For>
		)
	}

	/** Connections that have at least one matching table (or all when not filtering) */
	const visibleConnections = () => {
		if (!isFiltering()) return connectionsStore.connections
		return connectionsStore.connections.filter((conn) => {
			// Always show disconnected/loading connections
			if (conn.state !== 'connected') return true
			// For multi-db connections, check all databases
			if (hasMultipleDatabases(conn)) {
				return connectionsStore.getActiveDatabaseNames(conn.id).some((db) => databaseHasMatch(conn.id, db))
			}
			return connectionHasMatch(conn.id)
		})
	}

	/** Check if any connection has matching tables — for empty state */
	const hasFilterResults = () => visibleConnections().length > 0

	return (
		<div class="connection-tree" onKeyDown={handleTreeKeyDown}>
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
				{/* ── Filter input ───────────────────────────── */}
				<div
					class="connection-tree__filter"
					classList={{ 'connection-tree__filter--active': filterInput().length > 0 }}
				>
					<Icon name="search" size={12} />
					<input
						ref={searchInputRef}
						type="text"
						class="connection-tree__filter-input"
						placeholder="Filter tables..."
						value={filterInput()}
						onInput={(e) => handleFilterInput(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === 'Escape') {
								e.preventDefault()
								e.stopPropagation()
								if (filterInput()) {
									handleClearFilter()
								} else {
									searchInputRef?.blur()
								}
							}
						}}
					/>
					<Show when={filterInput()}>
						<button
							class="connection-tree__filter-clear"
							onClick={handleClearFilter}
							title="Clear filter"
						>
							<Icon name="close" size={10} />
						</button>
					</Show>
				</div>

				{/* ── Empty filter state ─────────────────────── */}
				<Show when={isFiltering() && !hasFilterResults()}>
					<div class="connection-tree__no-results">
						No tables matching "{filterInput()}"
					</div>
				</Show>

				{/* ── Tree ───────────────────────────────────── */}
				<For each={visibleConnections()}>
					{(conn) => {
						const tree = () => connectionsStore.getSchemaTree(conn.id)
						const schemas = () => tree()?.schemas ?? []
						const expanded = () => isFiltering() || isConnectionExpanded(conn.id)
						const loading = () => isLoading(conn)
						const hasSchemas = () => conn.state === 'connected' && schemas().length > 0
						const multiDb = () => hasMultipleDatabases(conn)

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
									connectionColor={conn.color}
									loading={loading()}
									badge={conn.readOnly ? <Lock size={11} class="tree-item__lock" /> : undefined}
									actions={conn.state === 'connected'
										? [
											sqlConsoleAction(
												conn.id,
												conn.name,
												CONNECTION_TYPE_META[conn.config.type].supportsMultiDatabase ? getDefaultDatabase(conn.config) : undefined,
											),
										]
										: undefined}
									onClick={() => toggleConnection(conn)}
									onToggle={() => toggleConnection(conn)}
									onContextMenu={(e) => showContextMenu(e, connectionMenuItems(conn))}
								/>

								<Show when={expanded() && !loading() && hasSchemas()}>
									{/* PostgreSQL with multiple active databases: show database level */}
									<Show
										when={multiDb()}
										fallback={
											/* Single database or SQLite: render schemas directly at level 1+ */
											renderSchemaTree(conn, tree()!, schemas(), 1)
										}
									>
										<For each={connectionsStore.getActiveDatabaseNames(conn.id)}>
											{(dbName) => {
												const dbKey = () => databaseKey(conn.id, dbName)
												const dbTree = () => connectionsStore.getSchemaTree(conn.id, dbName)
												const dbSchemas = () => dbTree()?.schemas ?? []
												const dbExpanded = () => isFiltering() || isDatabaseExpanded(dbKey())
												const dbVisible = () => !isFiltering() || databaseHasMatch(conn.id, dbName)

												return (
													<Show when={dbVisible()}>
														<ConnectionTreeItem
															label={dbName}
															level={1}
															type="database"
															icon={<Database size={14} />}
															expanded={dbExpanded()}
															hasChildren={dbSchemas().length > 0}
															actions={[sqlConsoleAction(conn.id, dbName, dbName)]}
															onToggle={() => toggleDatabase(dbKey())}
															onClick={() => toggleDatabase(dbKey())}
															onContextMenu={(e) => showContextMenu(e, databaseMenuItems(conn.id, dbName, isDefault()))}
														/>

														<Show when={dbExpanded() && dbSchemas().length > 0}>
															{renderSchemaTree(conn, dbTree()!, dbSchemas(), 2, dbName)}
														</Show>
													</Show>
												)

												function isDefault() {
													return getDefaultDatabase(conn.config) === dbName
												}
											}}
										</For>
									</Show>
								</Show>
							</>
						)
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
	)
}
