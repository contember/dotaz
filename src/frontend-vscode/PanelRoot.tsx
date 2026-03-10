import type { ConnectionInfo } from '@dotaz/shared/types/connection'
import type { TabType } from '@dotaz/shared/types/tab'
import { createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import ConnectionDialog from '@dotaz/frontend-shared/components/connection/ConnectionDialog'
import ToastContainer from '@dotaz/frontend-shared/components/common/Toast'
import ErDiagram from '@dotaz/frontend-shared/components/er-diagram/ErDiagram'
import ExportDialog from '@dotaz/frontend-shared/components/export/ExportDialog'
import DataGrid from '@dotaz/frontend-shared/components/grid/DataGrid'
import ImportDialog from '@dotaz/frontend-shared/components/import/ImportDialog'
import SchemaViewer from '@dotaz/frontend-shared/components/schema/SchemaViewer'
import DatabaseSearchDialog from '@dotaz/frontend-shared/components/search/DatabaseSearchDialog'
import { transport } from '@dotaz/frontend-shared/lib/transport'
import { connectionsStore, initConnectionsListener } from '@dotaz/frontend-shared/stores/connections'
import { editorStore } from '@dotaz/frontend-shared/stores/editor'
import type { OpenTabConfig } from '@dotaz/frontend-shared/stores/tabs'
import { tabsStore } from '@dotaz/frontend-shared/stores/tabs'

export interface DotazPanelContext {
	type: string
	connectionId?: string
	schema?: string
	table?: string
	database?: string
	savedViewId?: string
	searchTerm?: string
}

const TAB_PANEL_TYPES = new Set<string>(['data-grid', 'schema-viewer', 'er-diagram'])

function panelTypeToTabType(type: string): TabType {
	if (type === 'schema-viewer') return 'schema-viewer'
	if (type === 'er-diagram') return 'er-diagram'
	return 'data-grid'
}

/**
 * Intercepts tabsStore.openTab() calls and delegates to the extension host,
 * which opens a new VS Code WebviewPanel instead of an internal tab.
 */
function handleOpenTabIntercepted(config: OpenTabConfig): boolean {
	if (!TAB_PANEL_TYPES.has(config.type)) return false

	transport.call('vscode.openPanel', {
		type: config.type,
		title: config.title,
		connectionId: config.connectionId,
		schema: config.schema,
		table: config.table,
		database: config.database,
		viewId: config.viewId,
	})

	return true
}

export default function PanelRoot(props: { context: DotazPanelContext }) {
	const [ready, setReady] = createSignal(false)
	const tabId = crypto.randomUUID()

	onMount(async () => {
		const cleanup = initConnectionsListener()

		// Intercept tab opens → delegate to VS Code panels
		tabsStore.setOpenTabInterceptor(handleOpenTabIntercepted)

		onCleanup(() => {
			cleanup()
			tabsStore.setOpenTabInterceptor(null)
			connectionsStore.setOnTransactionLost(null)
		})

		connectionsStore.setOnTransactionLost((connectionId) => {
			editorStore.resetTransactionStateForConnection(connectionId)
		})

		await connectionsStore.loadConnections()

		const ctx = props.context

		// Create a synthetic tab for tab-based panel types
		if (TAB_PANEL_TYPES.has(ctx.type) && ctx.connectionId) {
			tabsStore.restoreTab({
				id: tabId,
				type: panelTypeToTabType(ctx.type),
				title: document.title || 'Dotaz',
				connectionId: ctx.connectionId,
				schema: ctx.schema,
				table: ctx.table,
				database: ctx.database,
				viewId: ctx.savedViewId,
			})
			tabsStore.setActiveTab(tabId)
		}

		// For export/import dialogs, also create a data-grid tab so the component can reference grid state
		if ((ctx.type === 'export-dialog' || ctx.type === 'import-dialog') && ctx.connectionId) {
			tabsStore.restoreTab({
				id: tabId,
				type: 'data-grid',
				title: document.title || 'Dotaz',
				connectionId: ctx.connectionId,
				schema: ctx.schema,
				table: ctx.table,
				database: ctx.database,
			})
			tabsStore.setActiveTab(tabId)
		}

		setReady(true)
	})

	const editConnection = (): ConnectionInfo | null => {
		if (!props.context.connectionId) return null
		return connectionsStore.connections.find((c) => c.id === props.context.connectionId) ?? null
	}

	return (
		<Show when={ready()}>
			<Switch>
				<Match when={props.context.type === 'data-grid'}>
					<DataGrid
						tabId={tabId}
						connectionId={props.context.connectionId!}
						schema={props.context.schema!}
						table={props.context.table!}
						database={props.context.database}
					/>
				</Match>
				<Match when={props.context.type === 'schema-viewer'}>
					<SchemaViewer
						tabId={tabId}
						connectionId={props.context.connectionId!}
						schema={props.context.schema!}
						table={props.context.table!}
						database={props.context.database}
					/>
				</Match>
				<Match when={props.context.type === 'er-diagram'}>
					<ErDiagram
						tabId={tabId}
						connectionId={props.context.connectionId!}
						schema={props.context.schema!}
						database={props.context.database}
					/>
				</Match>
				<Match when={props.context.type === 'connection-dialog'}>
					<ConnectionDialog
						open={true}
						connection={editConnection()}
						onClose={() => transport.call('vscode.closePanel', {})}
					/>
				</Match>
				<Match when={props.context.type === 'export-dialog'}>
					<ExportDialog
						open={true}
						tabId={tabId}
						connectionId={props.context.connectionId!}
						schema={props.context.schema!}
						table={props.context.table!}
						database={props.context.database}
						onClose={() => {}}
					/>
				</Match>
				<Match when={props.context.type === 'import-dialog'}>
					<ImportDialog
						open={true}
						connectionId={props.context.connectionId!}
						schema={props.context.schema!}
						table={props.context.table!}
						database={props.context.database}
						onClose={() => {}}
					/>
				</Match>
				<Match when={props.context.type === 'search-results'}>
					<DatabaseSearchDialog
						open={true}
						onClose={() => {}}
						initialConnectionId={props.context.connectionId}
					/>
				</Match>
			</Switch>
			<ToastContainer />
		</Show>
	)
}
