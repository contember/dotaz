import type { ConnectionInfo } from '@dotaz/shared/types/connection'
import { CONNECTION_TYPE_META, getDefaultDatabase } from '@dotaz/shared/types/connection'
import type { SavedView } from '@dotaz/shared/types/rpc'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import { editorStore } from '../../stores/editor'
import { tabsStore } from '../../stores/tabs'
import { viewsStore } from '../../stores/views'
import type { ContextMenuEntry } from '../common/ContextMenu'

export interface TreeMenuCallbacks {
	onEditConnection: (conn: ConnectionInfo) => void
	onManageDatabases?: (conn: ConnectionInfo) => void
	handleTableClick: (connectionId: string, schema: string, table: string, database?: string) => void
	handleViewClick: (connectionId: string, schema: string, table: string, view: SavedView, database?: string) => void
}

export function connectionMenuItems(conn: ConnectionInfo, callbacks: TreeMenuCallbacks): ContextMenuEntry[] {
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
			action: () => callbacks.onManageDatabases?.(conn),
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

	if (!supportsMultiDb) {
		const schema = connectionsStore.getSchemaTree(conn.id)?.schemas?.[0]?.name ?? 'main'
		items.push({
			label: 'ER Diagram',
			action: () => {
				tabsStore.openTab({
					type: 'er-diagram',
					title: `ER — ${conn.name}`,
					connectionId: conn.id,
					schema,
				})
			},
			disabled: !isConnected,
		})
	}

	items.push(
		'separator',
		{
			label: conn.readOnly ? 'Disable Read-Only' : 'Enable Read-Only',
			action: () => connectionsStore.setReadOnly(conn.id, !conn.readOnly),
		},
		'separator',
		{
			label: 'Move to Group...',
			action: () => {
				const existingGroups = Array.from(
					new Set(
						connectionsStore.connections
							.map((c) => c.groupName)
							.filter((g): g is string => !!g && g !== conn.groupName),
					),
				).sort()

				const options = existingGroups.length > 0
					? `Existing groups: ${existingGroups.join(', ')}\n\nEnter group name (or leave empty to remove from group):`
					: 'Enter group name:'

				const name = window.prompt(options, conn.groupName ?? '')
				if (name !== null) {
					connectionsStore.setConnectionGroup(conn.id, name.trim() || null)
				}
			},
		},
		'separator',
		{
			label: 'Edit',
			action: () => callbacks.onEditConnection(conn),
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

export function databaseMenuItems(connectionId: string, dbName: string, isDefault: boolean): ContextMenuEntry[] {
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

	const schema = connectionsStore.getSchemaTree(connectionId, dbName)?.schemas?.[0]?.name ?? 'public'
	items.push('separator', {
		label: 'ER Diagram',
		action: () => {
			tabsStore.openTab({
				type: 'er-diagram',
				title: `ER — ${dbName}`,
				connectionId,
				schema,
				database: dbName,
			})
		},
	})

	if (!isDefault) {
		items.push('separator')
		items.push({
			label: 'Deactivate',
			action: () => connectionsStore.deactivateDatabase(connectionId, dbName),
		})
	}

	return items
}

export function tableMenuItems(
	connectionId: string,
	schemaName: string,
	tableName: string,
	callbacks: TreeMenuCallbacks,
	database?: string,
): ContextMenuEntry[] {
	const conn = connectionsStore.connections.find((c) => c.id === connectionId)
	const items: ContextMenuEntry[] = [
		{
			label: 'Open Data',
			action: () => callbacks.handleTableClick(connectionId, schemaName, tableName, database),
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
				callbacks.handleTableClick(connectionId, schemaName, tableName, database)
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

export function schemaMenuItems(connectionId: string, schemaName: string, database?: string): ContextMenuEntry[] {
	return [
		{
			label: 'ER Diagram',
			action: () => {
				tabsStore.openTab({
					type: 'er-diagram',
					title: `ER — ${schemaName}`,
					connectionId,
					schema: schemaName,
					database,
				})
			},
		},
	]
}

export function viewMenuItems(connectionId: string, view: SavedView, callbacks: TreeMenuCallbacks, database?: string): ContextMenuEntry[] {
	return [
		{
			label: 'Open',
			action: () => callbacks.handleViewClick(connectionId, view.schemaName, view.tableName, view, database),
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
