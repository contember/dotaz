import type { ConnectionInfo, ConnectionState, ConnectionType } from '@dotaz/shared/types/connection'
import { CONNECTION_TYPE_META, getDefaultDatabase } from '@dotaz/shared/types/connection'
import type { SchemaInfo, TableInfo } from '@dotaz/shared/types/database'
import type { SavedView } from '@dotaz/shared/types/rpc'
import Bookmark from 'lucide-solid/icons/bookmark'
import Database from 'lucide-solid/icons/database'
import Eye from 'lucide-solid/icons/eye'
import Folder from 'lucide-solid/icons/folder'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Lock from 'lucide-solid/icons/lock'
import Plus from 'lucide-solid/icons/plus'
import SquareTerminal from 'lucide-solid/icons/square-terminal'
import Table from 'lucide-solid/icons/table'
import { siMysql, siPostgresql, siSqlite } from 'simple-icons'
import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js'
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
import { connectionMenuItems, databaseMenuItems, schemaMenuItems, tableMenuItems, type TreeMenuCallbacks, viewMenuItems } from './connectionTreeMenus'
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
	const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())
	const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null)
	const [dragOverFolder, setDragOverFolder] = createSignal<string | null | undefined>(undefined)

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

	onMount(() => {
		window.addEventListener('dotaz:focus-navigator-filter', handleFocusFilter)
	})

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

	// ── Folder management ─────────────────────────────────

	function isFolderExpanded(name: string): boolean {
		return expandedFolders().has(name)
	}

	function toggleFolder(name: string) {
		setExpandedFolders((prev) => {
			const next = new Set(prev)
			if (next.has(name)) {
				next.delete(name)
			} else {
				next.add(name)
			}
			return next
		})
	}

	const isFiltering = () => filterTerm().length > 0

	/** Connections that have at least one matching table (or all when not filtering) */
	const visibleConnectionsRaw = () => {
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
	const hasFilterResults = () => visibleConnectionsRaw().length > 0

	/** Group connections by folder. Returns { folders, ungrouped }. */
	const groupedConnections = createMemo(() => {
		const conns = isFiltering() ? visibleConnectionsRaw() : connectionsStore.connections
		const folders = new Map<string, ConnectionInfo[]>()
		const ungrouped: ConnectionInfo[] = []

		for (const conn of conns) {
			if (conn.groupName) {
				let arr = folders.get(conn.groupName)
				if (!arr) {
					arr = []
					folders.set(conn.groupName, arr)
				}
				arr.push(conn)
			} else {
				ungrouped.push(conn)
			}
		}

		const sortedFolders = Array.from(folders.entries()).sort(([a], [b]) => a.localeCompare(b))
		return { folders: sortedFolders, ungrouped }
	})

	const hasAnyFolders = createMemo(() => {
		return connectionsStore.connections.some((c) => c.groupName)
	})

	function folderMenuItems(folderName: string): ContextMenuEntry[] {
		return [
			{
				label: 'Rename Group',
				action: () => {
					const newName = window.prompt('Rename group:', folderName)
					if (newName?.trim() && newName.trim() !== folderName) {
						connectionsStore.renameConnectionGroup(folderName, newName.trim())
					}
				},
			},
			'separator',
			{
				label: 'Ungroup All',
				action: () => {
					const confirmed = window.confirm(`Ungroup all connections in "${folderName}"?`)
					if (confirmed) {
						connectionsStore.deleteConnectionGroup(folderName)
					}
				},
			},
		]
	}

	// ── Drag and drop ─────────────────────────────────────

	function handleConnectionDragStart(e: DragEvent, conn: ConnectionInfo) {
		e.dataTransfer?.setData('text/x-connection-id', conn.id)
		e.dataTransfer!.effectAllowed = 'move'
	}

	function handleFolderDragOver(e: DragEvent, folderName: string | null) {
		if (e.dataTransfer?.types.includes('text/x-connection-id')) {
			e.preventDefault()
			e.dataTransfer.dropEffect = 'move'
			setDragOverFolder(folderName)
		}
	}

	function handleFolderDragLeave() {
		setDragOverFolder(undefined)
	}

	function handleFolderDrop(e: DragEvent, folderName: string | null) {
		e.preventDefault()
		setDragOverFolder(undefined)
		const connectionId = e.dataTransfer?.getData('text/x-connection-id')
		if (connectionId) {
			connectionsStore.setConnectionGroup(connectionId, folderName)
		}
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

	// ── Context menu ─────────────────────────────────────

	function showContextMenu(e: MouseEvent, items: ContextMenuEntry[]) {
		e.preventDefault()
		e.stopPropagation()
		setContextMenu({ x: e.clientX, y: e.clientY, items })
	}

	const menuCallbacks: TreeMenuCallbacks = {
		onEditConnection: (conn) => props.onEditConnection(conn),
		onManageDatabases: (conn) => props.onManageDatabases?.(conn),
		handleTableClick,
		handleViewClick,
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
					icon={table.type === 'view' ? <Eye size={14} /> : table.type === 'materialized-view' ? <Database size={14} /> : <Table size={14} />}
					expanded={hasViews() ? tExpanded() : undefined}
					hasChildren={hasViews()}
					onClick={() => handleTableClick(conn.id, schema.name, table.name, database)}
					onToggle={hasViews() ? () => toggleTable(tKey) : undefined}
					onContextMenu={(e) => showContextMenu(e, tableMenuItems(conn.id, schema.name, table.name, menuCallbacks, database))}
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
								onContextMenu={(e) => showContextMenu(e, viewMenuItems(conn.id, view, menuCallbacks, database))}
							/>
						)}
					</For>
				</Show>
			</>
		)
	}

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
									onContextMenu={(e) => showContextMenu(e, schemaMenuItems(conn.id, schema.name, database))}
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

	// ── Connection item rendering ─────────────────────────

	function renderConnectionItem(conn: ConnectionInfo, level: number) {
		const tree = () => connectionsStore.getSchemaTree(conn.id)
		const schemas = () => tree()?.schemas ?? []
		const expanded = () => isFiltering() || isConnectionExpanded(conn.id)
		const loading = () => isLoading(conn)
		const hasSchemas = () => conn.state === 'connected' && schemas().length > 0
		const multiDb = () => hasMultipleDatabases(conn)
		const schemaLevel = level + 1

		return (
			<>
				<div
					draggable={true}
					onDragStart={(e) => handleConnectionDragStart(e, conn)}
				>
					<ConnectionTreeItem
						label={conn.name}
						level={level}
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
						onContextMenu={(e) => showContextMenu(e, connectionMenuItems(conn, menuCallbacks))}
					/>
				</div>

				<Show when={expanded() && !loading() && hasSchemas()}>
					<Show
						when={multiDb()}
						fallback={renderSchemaTree(conn, tree()!, schemas(), schemaLevel)}
					>
						<For each={connectionsStore.getActiveDatabaseNames(conn.id)}>
							{(dbName) => {
								const dbK = () => databaseKey(conn.id, dbName)
								const dbTree = () => connectionsStore.getSchemaTree(conn.id, dbName)
								const dbSchemas = () => dbTree()?.schemas ?? []
								const dbExp = () => isFiltering() || isDatabaseExpanded(dbK())
								const dbVis = () => !isFiltering() || databaseHasMatch(conn.id, dbName)

								return (
									<Show when={dbVis()}>
										<ConnectionTreeItem
											label={dbName}
											level={schemaLevel}
											type="database"
											icon={<Database size={14} />}
											expanded={dbExp()}
											hasChildren={dbSchemas().length > 0}
											actions={[sqlConsoleAction(conn.id, dbName, dbName)]}
											onToggle={() => toggleDatabase(dbK())}
											onClick={() => toggleDatabase(dbK())}
											onContextMenu={(e) => showContextMenu(e, databaseMenuItems(conn.id, dbName, getDefaultDatabase(conn.config) === dbName))}
										/>

										<Show when={dbExp() && dbSchemas().length > 0}>
											{renderSchemaTree(conn, dbTree()!, dbSchemas(), schemaLevel + 1, dbName)}
										</Show>
									</Show>
								)
							}}
						</For>
					</Show>
				</Show>
			</>
		)
	}

	function renderConnectionList() {
		const grouped = groupedConnections()

		// If no folders exist, render flat list
		if (!hasAnyFolders() && !isFiltering()) {
			return (
				<div
					onDragOver={(e) => handleFolderDragOver(e, null)}
					onDragLeave={handleFolderDragLeave}
					onDrop={(e) => handleFolderDrop(e, null)}
				>
					<For each={visibleConnectionsRaw()}>
						{(conn) => renderConnectionItem(conn, 0)}
					</For>
				</div>
			)
		}

		return (
			<>
				{/* Folders */}
				<For each={grouped.folders}>
					{([folderName, connections]) => {
						const folderExp = () => isFiltering() || isFolderExpanded(folderName)

						return (
							<div
								classList={{ 'tree-item--drag-over': dragOverFolder() === folderName }}
								onDragOver={(e) => handleFolderDragOver(e, folderName)}
								onDragLeave={handleFolderDragLeave}
								onDrop={(e) => handleFolderDrop(e, folderName)}
							>
								<ConnectionTreeItem
									label={folderName}
									level={0}
									type="folder"
									icon={folderExp() ? <FolderOpen size={14} /> : <Folder size={14} />}
									expanded={folderExp()}
									hasChildren={connections.length > 0}
									onToggle={() => toggleFolder(folderName)}
									onClick={() => toggleFolder(folderName)}
									onContextMenu={(e) => showContextMenu(e, folderMenuItems(folderName))}
								/>
								<Show when={folderExp()}>
									<For each={connections}>
										{(conn) => renderConnectionItem(conn, 1)}
									</For>
								</Show>
							</div>
						)
					}}
				</For>

				{/* Ungrouped connections */}
				<div
					onDragOver={(e) => handleFolderDragOver(e, null)}
					onDragLeave={handleFolderDragLeave}
					onDrop={(e) => handleFolderDrop(e, null)}
					classList={{ 'tree-item--drag-over': dragOverFolder() === null }}
				>
					<For each={grouped.ungrouped}>
						{(conn) => renderConnectionItem(conn, 0)}
					</For>
				</div>
			</>
		)
	}

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
				{renderConnectionList()}
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
