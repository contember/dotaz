import { createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import type { ComparisonColumnMapping, ComparisonSource } from '../../../shared/types/comparison'
import type { ConnectionInfo } from '../../../shared/types/connection'
import type { SearchScope } from '../../../shared/types/rpc'
import type { WorkspaceState, WorkspaceTab } from '../../../shared/types/workspace'
import { commandRegistry } from '../../lib/commands'
import { keyboardManager, platformShortcut } from '../../lib/keyboard'
import type { ShortcutContext } from '../../lib/keyboard'
import { friendlyErrorMessage, messages } from '../../lib/rpc'
import { loadWorkspace, saveWorkspaceNow, scheduleWorkspaceSave, setWorkspaceStateCollector } from '../../lib/workspace'
import { getComparisonParams, removeComparisonParams, setComparisonParams } from '../../stores/comparison'
import { connectionsStore } from '../../stores/connections'
import { editorStore } from '../../stores/editor'
import { gridStore } from '../../stores/grid'
import { navigationStore } from '../../stores/navigation'
import { sessionStore } from '../../stores/session'
import { settingsStore } from '../../stores/settings'
import { tabsStore } from '../../stores/tabs'
import { uiStore } from '../../stores/ui'
import BookmarksDialog from '../bookmarks/BookmarksDialog'
import CommandPalette from '../common/CommandPalette'
import Icon from '../common/Icon'
import SettingsDialog from '../common/SettingsDialog'
import type { SettingsSection } from '../common/SettingsDialog'
import TabSwitcher from '../common/TabSwitcher'
import ToastContainer from '../common/Toast'
import ComparisonDialog from '../comparison/ComparisonDialog'
import ComparisonView from '../comparison/ComparisonView'
import ConnectionDialog from '../connection/ConnectionDialog'
import ConnectionTree from '../connection/ConnectionTree'
import DatabasePicker from '../connection/DatabasePicker'
import PasswordDialog from '../connection/PasswordDialog'
import RowDetailTab from '../edit/RowDetailTab'
import AiPrompt from '../editor/AiPrompt'
import DestructiveQueryDialog from '../editor/DestructiveQueryDialog'
import QueryToolbar from '../editor/QueryToolbar'
import SqlEditor from '../editor/SqlEditor'
import SqlResultPanel from '../editor/SqlResultPanel'
import TransactionLog from '../editor/TransactionLog'
import TransactionWarningDialog from '../editor/TransactionWarningDialog'
import DataGrid from '../grid/DataGrid'
import QueryHistory from '../history/QueryHistory'
import SchemaViewer from '../schema/SchemaViewer'
import DatabaseSearchDialog from '../search/DatabaseSearchDialog'
import Resizer from './Resizer'
import Sidebar, { SidebarExpandButton } from './Sidebar'
import TabBar from './TabBar'
import type { TabStatus } from './TabBar'
import './AppShell.css'

// Clean up grid/editor/comparison/session/navigation state when tabs are closed
tabsStore.onTabClosed((tabId) => {
	gridStore.removeTab(tabId)
	editorStore.removeTab(tabId)
	removeComparisonParams(tabId)
	sessionStore.handleTabClosed(tabId)
	navigationStore.handleTabClosed(tabId)
})

const MIN_WIDTH = 150
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 250

export default function AppShell() {
	const [sidebarWidth, setSidebarWidth] = createSignal(DEFAULT_WIDTH)
	const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)
	const [dialogOpen, setDialogOpen] = createSignal(false)
	const [connectionToEdit, setConnectionToEdit] = createSignal<ConnectionInfo | null>(null)
	const [dbPickerOpen, setDbPickerOpen] = createSignal(false)
	const [dbPickerConnection, setDbPickerConnection] = createSignal<ConnectionInfo | null>(null)
	const [historyOpen, setHistoryOpen] = createSignal(false)
	const [bookmarksOpen, setBookmarksOpen] = createSignal(false)
	const [bookmarksInitialSql, setBookmarksInitialSql] = createSignal<string | undefined>(undefined)
	const [bookmarksInitialConn, setBookmarksInitialConn] = createSignal<string | undefined>(undefined)
	const [paletteOpen, setPaletteOpen] = createSignal(false)
	const [tabSwitcherOpen, setTabSwitcherOpen] = createSignal(false)
	const [compareOpen, setCompareOpen] = createSignal(false)
	const [compareInitialLeft, setCompareInitialLeft] = createSignal<
		{ connectionId: string; schema: string; table: string; database?: string } | undefined
	>(undefined)
	const [searchOpen, setSearchOpen] = createSignal(false)
	const [searchInitialConn, setSearchInitialConn] = createSignal<string | undefined>(undefined)
	const [searchInitialScope, setSearchInitialScope] = createSignal<SearchScope | undefined>(undefined)
	const [searchInitialSchema, setSearchInitialSchema] = createSignal<string | undefined>(undefined)
	const [searchInitialTable, setSearchInitialTable] = createSignal<string | undefined>(undefined)
	const [searchInitialDatabase, setSearchInitialDatabase] = createSignal<string | undefined>(undefined)
	const [settingsOpen, setSettingsOpen] = createSignal(false)
	const [settingsSection, setSettingsSection] = createSignal<SettingsSection>('data-format')
	const [txLogOpen, setTxLogOpen] = createSignal(false)
	const [txWarningOpen, setTxWarningOpen] = createSignal(false)
	const [txWarningTabId, setTxWarningTabId] = createSignal<string | null>(null)
	const [txWarningContext, setTxWarningContext] = createSignal<'close' | 'disconnect'>('close')
	const [txWarningConnectionId, setTxWarningConnectionId] = createSignal<string | null>(null)

	function handleResize(deltaX: number) {
		setSidebarWidth((w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + deltaX)))
		scheduleWorkspaceSave()
	}

	function toggleCollapse() {
		setSidebarCollapsed((c) => !c)
		scheduleWorkspaceSave()
	}

	function openAddConnectionDialog() {
		setConnectionToEdit(null)
		setDialogOpen(true)
	}

	function openEditConnectionDialog(conn: ConnectionInfo) {
		setConnectionToEdit(conn)
		setDialogOpen(true)
	}

	function openManageDatabases(conn: ConnectionInfo) {
		setDbPickerConnection(conn)
		setDbPickerOpen(true)
	}

	function handleCompare(
		left: ComparisonSource,
		right: ComparisonSource,
		keyColumns: ComparisonColumnMapping[],
		columnMappings: ComparisonColumnMapping[],
	) {
		const params = { left, right, keyColumns, columnMappings }
		const tabId = tabsStore.openTab({
			type: 'comparison',
			title: 'Compare',
			connectionId: left.connectionId,
		})
		setComparisonParams(tabId, params)
		setCompareOpen(false)
	}

	function handleOpenCompare(e: Event) {
		const detail = (e as CustomEvent).detail
		if (detail) {
			setCompareInitialLeft(detail)
		} else {
			setCompareInitialLeft(undefined)
		}
		setCompareOpen(true)
	}

	function handleOpenSearch(e: Event) {
		const detail = (e as CustomEvent).detail as {
			connectionId?: string
			scope?: SearchScope
			schema?: string
			table?: string
			database?: string
		} | undefined
		setSearchInitialConn(detail?.connectionId)
		setSearchInitialScope(detail?.scope)
		setSearchInitialSchema(detail?.schema)
		setSearchInitialTable(detail?.table)
		setSearchInitialDatabase(detail?.database)
		setSearchOpen(true)
	}

	let removeMenuListener: (() => void) | undefined
	let removeSessionListener: (() => void) | undefined
	let removeStatusListener: (() => void) | undefined
	let removeResizeListener: (() => void) | undefined

	function handleDuplicateTab(tabId: string) {
		const sourceTab = tabsStore.openTabs.find((t) => t.id === tabId)
		if (!sourceTab) return

		if (sourceTab.type === 'sql-console') {
			const editorTab = editorStore.getTab(tabId)
			const newTabId = tabsStore.openTab({
				type: 'sql-console',
				title: sourceTab.title,
				connectionId: sourceTab.connectionId,
				database: sourceTab.database,
			})
			editorStore.initTab(newTabId, sourceTab.connectionId, sourceTab.database)
			if (editorTab?.content) {
				editorStore.setContent(newTabId, editorTab.content)
			}
		} else if (sourceTab.type === 'data-grid') {
			tabsStore.openTab({
				type: 'data-grid',
				title: sourceTab.title,
				connectionId: sourceTab.connectionId,
				schema: sourceTab.schema,
				table: sourceTab.table,
				database: sourceTab.database,
			})
		} else if (sourceTab.type === 'schema-viewer') {
			tabsStore.openTab({
				type: 'schema-viewer',
				title: sourceTab.title,
				connectionId: sourceTab.connectionId,
				schema: sourceTab.schema,
				table: sourceTab.table,
				database: sourceTab.database,
			})
		} else if (sourceTab.type === 'row-detail') {
			tabsStore.openTab({
				type: 'row-detail',
				title: sourceTab.title,
				connectionId: sourceTab.connectionId,
				schema: sourceTab.schema,
				table: sourceTab.table,
				database: sourceTab.database,
				primaryKeys: sourceTab.primaryKeys,
			})
		}
	}

	// ── Global error handlers ─────────────────────────────
	function handleUnhandledError(event: ErrorEvent) {
		event.preventDefault()
		uiStore.addToast('error', friendlyErrorMessage(event.error ?? event.message))
	}

	function handleUnhandledRejection(event: PromiseRejectionEvent) {
		event.preventDefault()
		uiStore.addToast('error', friendlyErrorMessage(event.reason))
	}

	onMount(async () => {
		connectionsStore.loadConnections()
		settingsStore.loadSettings()
		registerCommands()
		registerShortcuts()
		keyboardManager.setContextProvider((): ShortcutContext => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'data-grid') return 'data-grid'
			if (tab?.type === 'sql-console') return 'sql-console'
			return 'global'
		})
		keyboardManager.init()
		navigationStore.init()

		// ── Workspace persistence ────────────────────────
		setWorkspaceStateCollector(collectWorkspaceState)
		restoreWorkspace()
		window.addEventListener('beforeunload', handleBeforeUnload)

		// Listen for menu actions from backend
		removeMenuListener = messages.onMenuAction(({ action }) => {
			commandRegistry.execute(action)
		})

		// Listen for session changes from backend (e.g. connection lost)
		removeSessionListener = messages.onSessionChanged((event) => {
			sessionStore.handleSessionChanged(event)
		})

		// Listen for connection status changes to clear sessions on disconnect
		removeStatusListener = messages.onConnectionStatusChanged((event) => {
			if (event.state === 'disconnected' || event.state === 'error') {
				sessionStore.clearSessionsForConnection(event.connectionId)
			}
			if (event.transactionLost) {
				editorStore.resetTransactionStateForConnection(event.connectionId)
				uiStore.addToast('warning', 'Connection was lost. Active transactions have been discarded.')
			}
		})

		// Global error catching — prevents app crash on unhandled errors
		window.addEventListener('error', handleUnhandledError)
		window.addEventListener('unhandledrejection', handleUnhandledRejection)
		window.addEventListener('dotaz:open-compare', handleOpenCompare)
		window.addEventListener('dotaz:open-search', handleOpenSearch)

		// Responsive: auto-collapse sidebar under 600px
		const mediaQuery = window.matchMedia('(max-width: 600px)')
		function handleMediaChange(e: MediaQueryListEvent | MediaQueryList) {
			if (e.matches && !sidebarCollapsed()) {
				setSidebarCollapsed(true)
			}
		}
		handleMediaChange(mediaQuery)
		mediaQuery.addEventListener('change', handleMediaChange)
		removeResizeListener = () => mediaQuery.removeEventListener('change', handleMediaChange)

		// Transaction warning on tab close — shows Commit/Rollback/Cancel dialog
		tabsStore.setBeforeCloseHook((tab) => {
			if (tab.type === 'sql-console') {
				const editorTab = editorStore.getTab(tab.id)
				if (editorTab?.inTransaction) {
					setTxWarningTabId(tab.id)
					setTxWarningConnectionId(tab.connectionId)
					setTxWarningContext('close')
					setTxWarningOpen(true)
					return false // Prevent close — dialog will handle it
				}
			}
			return true
		})

		// Transaction warning on disconnect
		connectionsStore.setBeforeDisconnectHook((connectionId) => {
			for (const openTab of tabsStore.openTabs) {
				if (openTab.connectionId === connectionId && openTab.type === 'sql-console') {
					const editorTab = editorStore.getTab(openTab.id)
					if (editorTab?.inTransaction) {
						setTxWarningTabId(openTab.id)
						setTxWarningConnectionId(connectionId)
						setTxWarningContext('disconnect')
						setTxWarningOpen(true)
						return false // Prevent disconnect — dialog will handle it
					}
				}
			}
			return true
		})
	})

	onCleanup(() => {
		commandRegistry.clear()
		keyboardManager.destroy()
		navigationStore.destroy()
		removeMenuListener?.()
		removeSessionListener?.()
		removeStatusListener?.()
		removeResizeListener?.()
		tabsStore.setBeforeCloseHook(null)
		connectionsStore.setBeforeDisconnectHook(null)
		window.removeEventListener('error', handleUnhandledError)
		window.removeEventListener('unhandledrejection', handleUnhandledRejection)
		window.removeEventListener('dotaz:open-compare', handleOpenCompare)
		window.removeEventListener('dotaz:open-search', handleOpenSearch)
		window.removeEventListener('beforeunload', handleBeforeUnload)
	})

	// ── Workspace persistence ──────────────────────────────

	function collectWorkspaceState(): WorkspaceState {
		const tabs: WorkspaceTab[] = tabsStore.openTabs.map((tab) => {
			const wsTab: WorkspaceTab = {
				id: tab.id,
				type: tab.type,
				title: tab.title,
				connectionId: tab.connectionId,
				schema: tab.schema,
				table: tab.table,
				database: tab.database,
				viewId: tab.viewId,
				viewName: tab.viewName,
			}
			if (tab.type === 'row-detail') {
				wsTab.primaryKeys = tab.primaryKeys
			}
			if (tab.type === 'sql-console') {
				const editor = editorStore.getTab(tab.id)
				if (editor) {
					wsTab.editorContent = editor.content
					wsTab.editorCursorPosition = editor.cursorPosition
					wsTab.editorTxMode = editor.txMode
				}
			}
			if (tab.type === 'data-grid') {
				const grid = gridStore.getTab(tab.id)
				if (grid) {
					wsTab.gridPage = grid.currentPage
					wsTab.gridPageSize = grid.pageSize
					wsTab.gridSort = grid.sort.length > 0 ? [...grid.sort] : undefined
					wsTab.gridFilters = grid.filters.length > 0 ? [...grid.filters] : undefined
				}
			}
			return wsTab
		})
		return {
			tabs,
			activeTabId: tabsStore.activeTabId,
			layout: {
				sidebarWidth: sidebarWidth(),
				sidebarCollapsed: sidebarCollapsed(),
			},
		}
	}

	async function restoreWorkspace() {
		const workspace = await loadWorkspace()
		if (!workspace || workspace.tabs.length === 0) return

		const connectionIds = new Set(connectionsStore.connections.map((c) => c.id))

		for (const wsTab of workspace.tabs) {
			// Skip tabs referencing deleted connections
			if (!connectionIds.has(wsTab.connectionId)) continue

			tabsStore.restoreTab({
				id: wsTab.id,
				type: wsTab.type,
				title: wsTab.title,
				connectionId: wsTab.connectionId,
				schema: wsTab.schema,
				table: wsTab.table,
				database: wsTab.database,
				viewId: wsTab.viewId,
				viewName: wsTab.viewName,
				primaryKeys: wsTab.primaryKeys,
			})

			// Restore editor state for SQL console tabs
			if (wsTab.type === 'sql-console') {
				editorStore.initTab(wsTab.id, wsTab.connectionId, wsTab.database)
				if (wsTab.editorContent) {
					editorStore.setContent(wsTab.id, wsTab.editorContent)
				}
				if (wsTab.editorCursorPosition != null) {
					editorStore.setCursorPosition(wsTab.id, wsTab.editorCursorPosition)
				}
				if (wsTab.editorTxMode === 'manual') {
					editorStore.setTxMode(wsTab.id, 'manual')
				}
			}
		}

		// Restore active tab
		if (workspace.activeTabId) {
			const exists = tabsStore.openTabs.some((t) => t.id === workspace.activeTabId)
			if (exists) {
				tabsStore.setActiveTab(workspace.activeTabId)
			}
		}

		// Restore layout
		if (workspace.layout) {
			if (workspace.layout.sidebarWidth > 0) {
				setSidebarWidth(workspace.layout.sidebarWidth)
			}
			setSidebarCollapsed(workspace.layout.sidebarCollapsed)
		}
	}

	function handleBeforeUnload() {
		saveWorkspaceNow()
	}

	// ── Command registration ──────────────────────────────
	function registerCommands() {
		commandRegistry.register({
			id: 'command-palette',
			label: 'Command Palette',
			shortcut: 'Ctrl+Shift+P',
			category: 'Navigation',
			handler: () => setPaletteOpen((v) => !v),
		})

		commandRegistry.register({
			id: 'tab-switcher',
			label: 'Switch Tab',
			shortcut: platformShortcut('tab-switcher'),
			category: 'Navigation',
			handler: () => setTabSwitcherOpen((v) => !v),
		})

		commandRegistry.register({
			id: 'new-sql-console',
			label: 'New SQL Console',
			shortcut: platformShortcut('new-sql-console'),
			category: 'Query',
			handler: () => {
				const conn = connectionsStore.activeConnection
				if (!conn) return
				const tabId = tabsStore.openTab({
					type: 'sql-console',
					title: `SQL — ${conn.name}`,
					connectionId: conn.id,
				})
				editorStore.initTab(tabId, conn.id)
			},
		})

		commandRegistry.register({
			id: 'close-tab',
			label: 'Close Tab',
			shortcut: platformShortcut('close-tab'),
			category: 'Navigation',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab) tabsStore.closeTab(tab.id)
			},
		})

		commandRegistry.register({
			id: 'close-all-tabs',
			label: 'Close All Tabs',
			category: 'Navigation',
			handler: () => tabsStore.closeAllTabs(),
		})

		commandRegistry.register({
			id: 'next-tab',
			label: 'Next Tab',
			shortcut: platformShortcut('next-tab'),
			category: 'Navigation',
			handler: () => tabsStore.activateNextTab(),
		})

		commandRegistry.register({
			id: 'prev-tab',
			label: 'Previous Tab',
			shortcut: platformShortcut('prev-tab'),
			category: 'Navigation',
			handler: () => tabsStore.activatePrevTab(),
		})

		commandRegistry.register({
			id: 'navigate-back',
			label: 'Navigate Back',
			shortcut: 'Alt+ArrowLeft',
			category: 'Navigation',
			handler: () => navigationStore.goBack(),
		})

		commandRegistry.register({
			id: 'navigate-forward',
			label: 'Navigate Forward',
			shortcut: 'Alt+ArrowRight',
			category: 'Navigation',
			handler: () => navigationStore.goForward(),
		})

		commandRegistry.register({
			id: 'connect',
			label: 'Connect',
			category: 'Connection',
			handler: () => {
				const conn = connectionsStore.activeConnection
				if (conn && conn.state === 'disconnected') {
					connectionsStore.connectTo(conn.id)
				}
			},
		})

		commandRegistry.register({
			id: 'disconnect',
			label: 'Disconnect',
			category: 'Connection',
			handler: () => {
				const conn = connectionsStore.activeConnection
				if (conn && conn.state === 'connected') {
					connectionsStore.disconnectFrom(conn.id)
				}
			},
		})

		commandRegistry.register({
			id: 'format-sql',
			label: 'Format SQL',
			shortcut: 'Ctrl+Shift+F',
			category: 'Query',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'sql-console') {
					editorStore.formatSql(tab.id)
				}
			},
		})

		commandRegistry.register({
			id: 'bookmark-query',
			label: 'Bookmark Query',
			shortcut: 'Ctrl+D',
			category: 'Query',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'sql-console') {
					const editorTab = editorStore.getTab(tab.id)
					const sql = editorTab?.content.trim()
					setBookmarksInitialSql(sql || undefined)
					setBookmarksInitialConn(tab.connectionId)
					setBookmarksOpen(true)
				}
			},
		})

		commandRegistry.register({
			id: 'open-bookmarks',
			label: 'Open Bookmarks',
			category: 'Query',
			handler: () => {
				const tab = tabsStore.activeTab
				setBookmarksInitialSql(undefined)
				setBookmarksInitialConn(tab?.connectionId)
				setBookmarksOpen(true)
			},
		})

		commandRegistry.register({
			id: 'run-query',
			label: 'Run Query',
			shortcut: 'Ctrl+Enter',
			category: 'Query',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'sql-console') {
					editorStore.executeQuery(tab.id)
				}
			},
		})

		commandRegistry.register({
			id: 'cancel-query',
			label: 'Cancel Query',
			shortcut: 'Escape',
			category: 'Query',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'sql-console') {
					editorStore.cancelQuery(tab.id)
				}
			},
		})

		commandRegistry.register({
			id: 'commit-transaction',
			label: 'Commit Transaction',
			shortcut: 'Ctrl+Shift+Enter',
			category: 'Query',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'sql-console') {
					editorStore.commitTransaction(tab.id)
				}
			},
		})

		commandRegistry.register({
			id: 'rollback-transaction',
			label: 'Rollback Transaction',
			shortcut: 'Ctrl+Shift+R',
			category: 'Query',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'sql-console') {
					editorStore.rollbackTransaction(tab.id)
				}
			},
		})

		commandRegistry.register({
			id: 'refresh-data',
			label: 'Refresh Data',
			shortcut: 'F5',
			category: 'Grid',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'data-grid') {
					gridStore.refreshData(tab.id)
				}
			},
		})

		commandRegistry.register({
			id: 'toggle-sidebar',
			label: 'Toggle Sidebar',
			shortcut: 'Ctrl+B',
			category: 'View',
			handler: () => toggleCollapse(),
		})

		commandRegistry.register({
			id: 'focus-navigator-filter',
			label: 'Filter in Navigator',
			shortcut: 'Ctrl+Shift+L',
			category: 'Navigation',
			handler: () => {
				// Ensure sidebar is visible first
				if (sidebarCollapsed()) toggleCollapse()
				window.dispatchEvent(new CustomEvent('dotaz:focus-navigator-filter'))
			},
		})

		commandRegistry.register({
			id: 'save-view',
			label: 'Save View',
			shortcut: 'Ctrl+S',
			category: 'Grid',
			handler: () => {
				// Dispatched as custom event so DataGrid (which owns the save dialog) can handle it
				const tab = tabsStore.activeTab
				if (tab?.type === 'data-grid') {
					window.dispatchEvent(new CustomEvent('dotaz:save-view', { detail: { tabId: tab.id } }))
				}
			},
		})

		commandRegistry.register({
			id: 'inline-edit',
			label: 'Edit Cell',
			shortcut: 'F2',
			category: 'Grid',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type !== 'data-grid') return
				const gridTab = gridStore.getTab(tab.id)
				if (!gridTab?.focusedCell) return
				if (gridStore.isRowDeleted(tab.id, gridTab.focusedCell.row)) return
				gridStore.startEditing(tab.id, gridTab.focusedCell.row, gridTab.focusedCell.column)
			},
		})

		commandRegistry.register({
			id: 'delete-rows',
			label: 'Delete Selected Rows',
			shortcut: 'Delete',
			category: 'Grid',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'data-grid') {
					gridStore.deleteSelectedRows(tab.id)
				}
			},
		})

		commandRegistry.register({
			id: 'export-data',
			label: 'Export Data',
			category: 'Grid',
			handler: () => {
				// Export is managed by the ExportDialog within DataGrid
			},
		})

		commandRegistry.register({
			id: 'toggle-transpose',
			label: 'Toggle Transpose View',
			shortcut: 'Ctrl+Shift+T',
			category: 'Grid',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'data-grid') {
					gridStore.toggleTranspose(tab.id)
				}
			},
		})

		commandRegistry.register({
			id: 'toggle-value-editor',
			label: 'Toggle Value Editor Panel',
			shortcut: 'Ctrl+Shift+E',
			category: 'Grid',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'data-grid') {
					gridStore.toggleValueEditor(tab.id)
				}
			},
		})

		commandRegistry.register({
			id: 'compare-data',
			label: 'Compare Data',
			category: 'Grid',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'data-grid' && tab.schema && tab.table) {
					setCompareInitialLeft({
						connectionId: tab.connectionId,
						schema: tab.schema,
						table: tab.table,
						database: tab.database,
					})
				} else {
					setCompareInitialLeft(undefined)
				}
				setCompareOpen(true)
			},
		})

		commandRegistry.register({
			id: 'search-database',
			label: 'Search Database',
			category: 'Connection',
			handler: () => {
				const conn = connectionsStore.activeConnection
				setSearchInitialConn(conn?.id)
				setSearchInitialScope(undefined)
				setSearchInitialSchema(undefined)
				setSearchInitialTable(undefined)
				setSearchInitialDatabase(undefined)
				setSearchOpen(true)
			},
		})

		commandRegistry.register({
			id: 'new-connection',
			label: 'New Connection',
			category: 'Connection',
			handler: () => openAddConnectionDialog(),
		})

		commandRegistry.register({
			id: 'reconnect',
			label: 'Reconnect',
			category: 'Connection',
			handler: async () => {
				const conn = connectionsStore.activeConnection
				if (!conn) return
				if (conn.state === 'connected') {
					await connectionsStore.disconnectFrom(conn.id)
				}
				connectionsStore.connectTo(conn.id)
			},
		})

		commandRegistry.register({
			id: 'zoom-in',
			label: 'Zoom In',
			category: 'View',
			shortcut: 'Ctrl+=',
			handler: () => {
				const current = parseFloat(document.documentElement.style.zoom || '1')
				document.documentElement.style.zoom = String(Math.min(current + 0.1, 2))
			},
		})

		commandRegistry.register({
			id: 'zoom-out',
			label: 'Zoom Out',
			category: 'View',
			shortcut: 'Ctrl+-',
			handler: () => {
				const current = parseFloat(document.documentElement.style.zoom || '1')
				document.documentElement.style.zoom = String(Math.max(current - 0.1, 0.5))
			},
		})

		commandRegistry.register({
			id: 'zoom-reset',
			label: 'Reset Zoom',
			category: 'View',
			shortcut: 'Ctrl+0',
			handler: () => {
				document.documentElement.style.zoom = '1'
			},
		})

		commandRegistry.register({
			id: 'about',
			label: 'About Dotaz',
			category: 'Help',
			handler: () => {
				uiStore.addToast('info', 'Dotaz — Desktop Database Client')
			},
		})

		commandRegistry.register({
			id: 'settings',
			label: 'Settings',
			category: 'View',
			handler: () => {
				setSettingsSection('data-format')
				setSettingsOpen(true)
			},
		})

		commandRegistry.register({
			id: 'settings-data-format',
			label: 'Settings: Data Format',
			category: 'View',
			handler: () => {
				setSettingsSection('data-format')
				setSettingsOpen(true)
			},
		})

		commandRegistry.register({
			id: 'ai-generate-sql',
			label: 'Generate SQL with AI',
			shortcut: 'Ctrl+G',
			category: 'Query',
			handler: () => {
				const tab = tabsStore.activeTab
				if (tab?.type === 'sql-console') {
					editorStore.toggleAiPrompt(tab.id)
				}
			},
		})

		commandRegistry.register({
			id: 'ai-settings',
			label: 'Settings: AI',
			category: 'View',
			handler: () => {
				setSettingsSection('ai')
				setSettingsOpen(true)
			},
		})

		commandRegistry.register({
			id: 'session-settings',
			label: 'Settings: Session',
			category: 'View',
			handler: () => {
				setSettingsSection('session')
				setSettingsOpen(true)
			},
		})
	}

	// ── Shortcut registration ──────────────────────────────
	function registerShortcuts() {
		// Global shortcuts
		keyboardManager.register('Ctrl+Shift+P', 'command-palette')
		keyboardManager.register('Ctrl+B', 'toggle-sidebar')

		// Platform-aware shortcuts (Ctrl-based in desktop, Alt-based in browser)
		for (const cmdId of ['new-sql-console', 'close-tab', 'next-tab', 'prev-tab', 'tab-switcher'] as const) {
			keyboardManager.register(platformShortcut(cmdId), cmdId)
		}
		keyboardManager.register('Ctrl+Shift+L', 'focus-navigator-filter')
		keyboardManager.register('Alt+ArrowLeft', 'navigate-back')
		keyboardManager.register('Alt+ArrowRight', 'navigate-forward')

		// SQL console context
		keyboardManager.register('Ctrl+Enter', 'run-query', 'sql-console')
		keyboardManager.register('Ctrl+Shift+F', 'format-sql', 'sql-console')
		keyboardManager.register('Ctrl+D', 'bookmark-query', 'sql-console')
		keyboardManager.register('Ctrl+Shift+Enter', 'commit-transaction', 'sql-console')
		keyboardManager.register('Ctrl+Shift+R', 'rollback-transaction', 'sql-console')
		keyboardManager.register('Ctrl+G', 'ai-generate-sql', 'sql-console')

		// Data grid context
		keyboardManager.register('F5', 'refresh-data', 'data-grid')
		keyboardManager.register('F2', 'inline-edit', 'data-grid')
		keyboardManager.register('Delete', 'delete-rows', 'data-grid')
		keyboardManager.register('Ctrl+S', 'save-view', 'data-grid')
		keyboardManager.register('Ctrl+Shift+T', 'toggle-transpose', 'data-grid')
		keyboardManager.register('Ctrl+Shift+E', 'toggle-value-editor', 'data-grid')
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
					onOpenSettings={() => {
						setSettingsSection('data-format')
						setSettingsOpen(true)
					}}
				>
					<ConnectionTree onAddConnection={openAddConnectionDialog} onEditConnection={openEditConnectionDialog} onManageDatabases={openManageDatabases} />
				</Sidebar>

				<Show when={!sidebarCollapsed()}>
					<Resizer onResize={handleResize} />
				</Show>

				<div class="app-shell__main">
					<TabBar
						tabs={tabsStore.openTabs}
						activeTabId={tabsStore.activeTabId}
						pinnedTabIds={new Set(
							Object.entries(sessionStore.tabSessions)
								.filter(([, sid]) => sid != null)
								.map(([tabId]) => tabId),
						)}
						tabStatuses={(() => {
							const map = new Map<string, TabStatus>()
							// Pre-compute which connections have active transactions
							const connTx = new Set<string>()
							for (const tab of tabsStore.openTabs) {
								if (tab.type === 'sql-console') {
									const et = editorStore.getTab(tab.id)
									if (et?.inTransaction) connTx.add(tab.connectionId)
								}
							}
							for (const tab of tabsStore.openTabs) {
								const conn = connectionsStore.connections.find(c => c.id === tab.connectionId)
								const status: TabStatus = {}
								if (conn?.color) status.color = conn.color
								if (connectionsStore.isReadOnly(tab.connectionId)) status.readOnly = true
								if (connTx.has(tab.connectionId)) status.inTransaction = true
								if (status.color || status.readOnly || status.inTransaction) {
									map.set(tab.id, status)
								}
							}
							return map
						})()}
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
								<button class="btn btn--primary welcome-screen__cta" onClick={openAddConnectionDialog}>
									Add Connection
								</button>
							</div>
						</Show>
						<Show when={tabsStore.activeTab} keyed>
							{(tab) => (
								<Switch>
									<Match when={tab.type === 'data-grid'}>
										<DataGrid
											tabId={tab.id}
											connectionId={tab.connectionId}
											schema={tab.schema!}
											table={tab.table!}
											database={tab.database}
										/>
									</Match>
									<Match when={tab.type === 'sql-console'}>
										<div class="sql-console">
											<QueryToolbar
												tabId={tab.id}
												connectionId={tab.connectionId}
												database={tab.database}
												onOpenHistory={() => setHistoryOpen(true)}
												onOpenBookmarks={() => {
													setBookmarksInitialSql(undefined)
													setBookmarksInitialConn(tab.connectionId)
													setBookmarksOpen(true)
												}}
												onToggleTransactionLog={() => setTxLogOpen((v) => !v)}
												transactionLogOpen={txLogOpen()}
											/>
											<Show when={editorStore.getTab(tab.id)?.aiPromptOpen}>
												<AiPrompt tabId={tab.id} />
											</Show>
											<SqlEditor
												tabId={tab.id}
												connectionId={tab.connectionId}
												database={tab.database}
											/>
											<Show when={txLogOpen()}>
												<TransactionLog
													connectionId={tab.connectionId}
													database={tab.database}
												/>
											</Show>
											<SqlResultPanel
												tabId={tab.id}
												connectionId={tab.connectionId}
											/>
										</div>
									</Match>
									<Match when={tab.type === 'schema-viewer'}>
										<SchemaViewer
											tabId={tab.id}
											connectionId={tab.connectionId}
											schema={tab.schema!}
											table={tab.table!}
											database={tab.database}
										/>
									</Match>
									<Match when={tab.type === 'row-detail'}>
										<RowDetailTab
											tabId={tab.id}
											connectionId={tab.connectionId}
											schema={tab.schema!}
											table={tab.table!}
											database={tab.database}
											primaryKeys={tab.primaryKeys!}
										/>
									</Match>
									<Match when={tab.type === 'comparison'}>
										<ComparisonView
											tabId={tab.id}
											initialParams={getComparisonParams(tab.id)}
										/>
									</Match>
								</Switch>
							)}
						</Show>
					</main>
				</div>
			</div>

			<ConnectionDialog
				open={dialogOpen()}
				connection={connectionToEdit()}
				onClose={() => setDialogOpen(false)}
			/>

			<DatabasePicker
				open={dbPickerOpen()}
				connection={dbPickerConnection()}
				onClose={() => setDbPickerOpen(false)}
			/>

			<PasswordDialog />

			<QueryHistory
				open={historyOpen()}
				onClose={() => setHistoryOpen(false)}
			/>

			<BookmarksDialog
				open={bookmarksOpen()}
				onClose={() => setBookmarksOpen(false)}
				initialSql={bookmarksInitialSql()}
				initialConnectionId={bookmarksInitialConn()}
			/>

			<CommandPalette
				open={paletteOpen()}
				onClose={() => setPaletteOpen(false)}
			/>

			<TabSwitcher
				open={tabSwitcherOpen()}
				onClose={() => setTabSwitcherOpen(false)}
			/>

			<DestructiveQueryDialog
				open={editorStore.pendingDestructiveQuery !== null}
				statements={editorStore.pendingDestructiveQuery?.statements ?? []}
				onConfirm={(suppress) => editorStore.confirmDestructiveQuery(suppress)}
				onCancel={() => editorStore.cancelDestructiveQuery()}
			/>

			<TransactionWarningDialog
				open={txWarningOpen()}
				context={txWarningContext()}
				onCommit={async () => {
					const tabId = txWarningTabId()
					const connId = txWarningConnectionId()
					if (tabId) {
						await editorStore.commitTransaction(tabId)
					}
					setTxWarningOpen(false)
					// Now complete the original action
					if (txWarningContext() === 'close' && tabId) {
						tabsStore.closeTab(tabId)
					} else if (txWarningContext() === 'disconnect' && connId) {
						connectionsStore.disconnectFrom(connId)
					}
				}}
				onRollback={async () => {
					const tabId = txWarningTabId()
					const connId = txWarningConnectionId()
					if (tabId) {
						await editorStore.rollbackTransaction(tabId)
					}
					setTxWarningOpen(false)
					// Now complete the original action
					if (txWarningContext() === 'close' && tabId) {
						tabsStore.closeTab(tabId)
					} else if (txWarningContext() === 'disconnect' && connId) {
						connectionsStore.disconnectFrom(connId)
					}
				}}
				onCancel={() => setTxWarningOpen(false)}
			/>

			<ComparisonDialog
				open={compareOpen()}
				onClose={() => setCompareOpen(false)}
				onCompare={handleCompare}
				initialLeft={compareInitialLeft()}
			/>

			<DatabaseSearchDialog
				open={searchOpen()}
				onClose={() => setSearchOpen(false)}
				initialConnectionId={searchInitialConn()}
				initialScope={searchInitialScope()}
				initialSchema={searchInitialSchema()}
				initialTable={searchInitialTable()}
				initialDatabase={searchInitialDatabase()}
			/>

			<SettingsDialog
				open={settingsOpen()}
				onClose={() => setSettingsOpen(false)}
				initialSection={settingsSection()}
			/>

			<ToastContainer />
		</div>
	)
}
