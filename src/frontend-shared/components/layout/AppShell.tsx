import { createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import appIcon from '../../../../assets/icon.png'
import type { ComparisonColumnMapping, ComparisonSource } from '../../../shared/types/comparison'
import type { ConnectionInfo } from '../../../shared/types/connection'
import type { SearchScope } from '../../../shared/types/rpc'
import type { WorkspaceState, WorkspaceTab } from '../../../shared/types/workspace'
import { getCapabilities } from '../../lib/capabilities'
import { registerAppCommands } from '../../lib/app-commands'
import { registerAppShortcuts } from '../../lib/app-shortcuts'
import { commandRegistry } from '../../lib/commands'
import type { ShortcutContext } from '../../lib/keyboard'
import { keyboardManager } from '../../lib/keyboard'
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
import { viewsStore } from '../../stores/views'
import BookmarksDialog from '../bookmarks/BookmarksDialog'
import CommandPalette from '../common/CommandPalette'
import DemoWarningDialog from '../common/DemoWarningDialog'
import KeyboardShortcutsDialog from '../common/KeyboardShortcutsDialog'
import type { SettingsSection } from '../common/SettingsDialog'
import SettingsDialog from '../common/SettingsDialog'
import TabSwitcher from '../common/TabSwitcher'
import Tips from '../common/Tips'
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
import type { TabStatus } from './TabBar'
import TabBar from './TabBar'
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

type CompareLeft = { connectionId: string; schema: string; table: string; database?: string }

type AppModal =
	| null
	| { type: 'history' }
	| { type: 'palette' }
	| { type: 'tab-switcher' }
	| { type: 'connection'; conn: ConnectionInfo | null }
	| { type: 'db-picker'; conn: ConnectionInfo }
	| { type: 'bookmarks'; sql?: string; connId?: string; db?: string }
	| { type: 'compare'; initialLeft?: CompareLeft }
	| { type: 'search'; connId?: string; scope?: SearchScope; schema?: string; table?: string; db?: string }
	| { type: 'settings'; section: SettingsSection }
	| { type: 'tx-warning'; tabId: string; context: 'close' | 'disconnect'; connId: string }
	| { type: 'keyboard-shortcuts' }
	| { type: 'demo-warning' }

export default function AppShell() {
	const [sidebarWidth, setSidebarWidth] = createSignal(DEFAULT_WIDTH)
	const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)
	const [modal, setModal] = createSignal<AppModal>(null)
	function modalAs<T extends NonNullable<AppModal>['type']>(type: T): Extract<NonNullable<AppModal>, { type: T }> | undefined {
		const m = modal()
		return m?.type === type ? m as Extract<NonNullable<AppModal>, { type: T }> : undefined
	}
	const [txLogOpen, setTxLogOpen] = createSignal(false)

	function handleResize(deltaX: number) {
		setSidebarWidth((w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + deltaX)))
		scheduleWorkspaceSave()
	}

	function toggleCollapse() {
		setSidebarCollapsed((c) => !c)
		scheduleWorkspaceSave()
	}

	function openAddConnectionDialog() {
		setModal({ type: 'connection', conn: null })
	}

	function openEditConnectionDialog(conn: ConnectionInfo) {
		setModal({ type: 'connection', conn })
	}

	function openManageDatabases(conn: ConnectionInfo) {
		setModal({ type: 'db-picker', conn })
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
		setModal(null)
	}

	function handleOpenCompare(e: Event) {
		const detail = (e as CustomEvent).detail
		setModal({ type: 'compare', initialLeft: detail || undefined })
	}

	function handleOpenSearch(e: Event) {
		const detail = (e as CustomEvent).detail as
			| {
				connectionId?: string
				scope?: SearchScope
				schema?: string
				table?: string
				database?: string
			}
			| undefined
		setModal({
			type: 'search',
			connId: detail?.connectionId,
			scope: detail?.scope,
			schema: detail?.schema,
			table: detail?.table,
			db: detail?.database,
		})
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
		console.error('Unhandled window error', {
			message: event.message,
			filename: event.filename,
			lineno: event.lineno,
			colno: event.colno,
			error: event.error,
		})
		uiStore.addToast(
			'error',
			friendlyErrorMessage(event.error ?? event.message),
		)
	}

	function handleUnhandledRejection(event: PromiseRejectionEvent) {
		event.preventDefault()
		console.error('Unhandled promise rejection', event.reason)
		uiStore.addToast('error', friendlyErrorMessage(event.reason))
	}

	onMount(async () => {
		await connectionsStore.loadConnections()
		settingsStore.loadSettings()
		registerAppCommands({
			toggleModal: (type) => setModal((m) => m?.type === type ? null : { type } as AppModal),
			setModal: (m) => setModal(m as AppModal),
			openAddConnectionDialog,
			toggleCollapse,
			sidebarCollapsed,
		})
		registerAppShortcuts()
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
				viewsStore.clearViews(event.connectionId)
			}
			if (event.transactionLost) {
				editorStore.resetTransactionStateForConnection(event.connectionId)
				uiStore.addToast(
					'warning',
					'Connection was lost. Active transactions have been discarded.',
				)
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

		// Show demo mode warning
		if (getCapabilities().isDemo) {
			setModal({ type: 'demo-warning' })
		}

		// Transaction warning on tab close — shows Commit/Rollback/Cancel dialog
		tabsStore.setBeforeCloseHook((tab) => {
			if (tab.type === 'sql-console') {
				const editorTab = editorStore.getTab(tab.id)
				if (editorTab?.inTransaction) {
					setModal({ type: 'tx-warning', tabId: tab.id, context: 'close', connId: tab.connectionId })
					return false // Prevent close — dialog will handle it
				}
			}
			return true
		})

		// Transaction warning on disconnect
		connectionsStore.setBeforeDisconnectHook((connectionId) => {
			for (const openTab of tabsStore.openTabs) {
				if (
					openTab.connectionId === connectionId
					&& openTab.type === 'sql-console'
				) {
					const editorTab = editorStore.getTab(openTab.id)
					if (editorTab?.inTransaction) {
						setModal({ type: 'tx-warning', tabId: openTab.id, context: 'disconnect', connId: connectionId })
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
					wsTab.editorSearchPath = editor.searchPath ?? undefined
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
		// Guard against duplicate restore (e.g. HMR re-mounts)
		if (tabsStore.openTabs.length > 0) return

		const workspace = await loadWorkspace()
		if (!workspace || workspace.tabs.length === 0) return

		const connectionIds = new Set(
			connectionsStore.connections.map((c) => c.id),
		)
		const tabConnectionIds = new Set<string>()

		// Collect which connections are needed and start reconnecting immediately
		for (const wsTab of workspace.tabs) {
			if (connectionIds.has(wsTab.connectionId)) {
				tabConnectionIds.add(wsTab.connectionId)
			}
		}

		// Auto-reconnect disconnected connections FIRST
		// (fire-and-forget — DataGrid waits reactively for connection state)
		for (const connId of tabConnectionIds) {
			const conn = connectionsStore.connections.find((c) => c.id === connId)
			if (conn && conn.state !== 'connected' && conn.state !== 'connecting') {
				connectionsStore.connectTo(connId)
			}
		}

		// Restore tabs
		for (const wsTab of workspace.tabs) {
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
				if (wsTab.editorSearchPath) {
					editorStore.setSearchPath(wsTab.id, wsTab.editorSearchPath)
				}
			}
		}

		// Restore active tab
		if (workspace.activeTabId) {
			const exists = tabsStore.openTabs.some(
				(t) => t.id === workspace.activeTabId,
			)
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
					onOpenSettings={() => setModal({ type: 'settings', section: 'data-format' })}
					onLogoClick={tabsStore.closeAllTabs}
				>
					<ConnectionTree
						onAddConnection={openAddConnectionDialog}
						onEditConnection={openEditConnectionDialog}
						onManageDatabases={openManageDatabases}
					/>
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
								const conn = connectionsStore.connections.find(
									(c) => c.id === tab.connectionId,
								)
								const status: TabStatus = {}
								if (conn?.color) status.color = conn.color
								if (connectionsStore.isReadOnly(tab.connectionId)) {
									status.readOnly = true
								}
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
								<img src={appIcon} alt="Dotaz" class="welcome-screen__icon" />
								<h2 class="welcome-screen__title">Dotaz</h2>
								<p class="welcome-screen__subtitle">
									Open a connection and select a table to get started.
								</p>
								<button
									class="btn btn--primary welcome-screen__cta"
									onClick={openAddConnectionDialog}
								>
									Add Connection
								</button>
								<div class="welcome-screen__tips">
									<Tips />
								</div>
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
												onOpenHistory={() => setModal({ type: 'history' })}
												onOpenBookmarks={() => setModal({ type: 'bookmarks', connId: tab.connectionId, db: tab.database })}
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
				open={modal()?.type === 'connection'}
				connection={modalAs('connection')?.conn ?? null}
				onClose={() => setModal(null)}
			/>

			<DatabasePicker
				open={modal()?.type === 'db-picker'}
				connection={modalAs('db-picker')?.conn ?? null}
				onClose={() => setModal(null)}
			/>

			<PasswordDialog />

			<QueryHistory
				open={modal()?.type === 'history'}
				onClose={() => setModal(null)}
			/>

			<BookmarksDialog
				open={modal()?.type === 'bookmarks'}
				onClose={() => setModal(null)}
				initialSql={modalAs('bookmarks')?.sql}
				initialConnectionId={modalAs('bookmarks')?.connId}
				initialDatabase={modalAs('bookmarks')?.db}
			/>

			<CommandPalette
				open={modal()?.type === 'palette'}
				onClose={() => setModal(null)}
			/>

			<TabSwitcher
				open={modal()?.type === 'tab-switcher'}
				onClose={() => setModal(null)}
			/>

			<DestructiveQueryDialog
				open={editorStore.pendingDestructiveQuery !== null}
				statements={editorStore.pendingDestructiveQuery?.statements ?? []}
				onConfirm={(suppress) => editorStore.confirmDestructiveQuery(suppress)}
				onCancel={() => editorStore.cancelDestructiveQuery()}
			/>

			<TransactionWarningDialog
				open={modal()?.type === 'tx-warning'}
				context={modalAs('tx-warning')?.context ?? 'close'}
				onCommit={async () => {
					const m = modal()
					if (m?.type !== 'tx-warning') return
					await editorStore.commitTransaction(m.tabId)
					setModal(null)
					if (m.context === 'close') {
						tabsStore.closeTab(m.tabId)
					} else if (m.context === 'disconnect') {
						connectionsStore.disconnectFrom(m.connId)
					}
				}}
				onRollback={async () => {
					const m = modal()
					if (m?.type !== 'tx-warning') return
					await editorStore.rollbackTransaction(m.tabId)
					setModal(null)
					if (m.context === 'close') {
						tabsStore.closeTab(m.tabId)
					} else if (m.context === 'disconnect') {
						connectionsStore.disconnectFrom(m.connId)
					}
				}}
				onCancel={() => setModal(null)}
			/>

			<ComparisonDialog
				open={modal()?.type === 'compare'}
				onClose={() => setModal(null)}
				onCompare={handleCompare}
				initialLeft={modalAs('compare')?.initialLeft}
			/>

			<DatabaseSearchDialog
				open={modal()?.type === 'search'}
				onClose={() => setModal(null)}
				initialConnectionId={modalAs('search')?.connId}
				initialScope={modalAs('search')?.scope}
				initialSchema={modalAs('search')?.schema}
				initialTable={modalAs('search')?.table}
				initialDatabase={modalAs('search')?.db}
			/>

			<SettingsDialog
				open={modal()?.type === 'settings'}
				onClose={() => setModal(null)}
				initialSection={modalAs('settings')?.section}
			/>

			<KeyboardShortcutsDialog
				open={modal()?.type === 'keyboard-shortcuts'}
				onClose={() => setModal(null)}
			/>

			<DemoWarningDialog
				open={modal()?.type === 'demo-warning'}
				onClose={() => setModal(null)}
			/>

			<ToastContainer />
		</div>
	)
}
