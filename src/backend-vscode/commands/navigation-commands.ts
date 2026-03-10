import type { SavedView } from '@dotaz/shared/types/rpc'
import type { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import type { SchemaCache } from '../state/schema-cache'
import type { WebviewRpcManager } from '../webviews/webview-rpc-manager'
import type { GroupTreeItem, SchemaTreeItem, DatabaseTreeItem } from '../views/tree-items'
import type { ConnectionTreeProvider } from '../views/connection-tree-provider'
import * as vscode from 'vscode'

export function registerNavigationCommands(
	context: vscode.ExtensionContext,
	connectionManager: ConnectionManager,
	appDb: AppDatabase,
	schemaCache: SchemaCache,
	treeProvider: ConnectionTreeProvider,
	_rpcManager: WebviewRpcManager,
	createWebviewPanel: (type: string, title: string, context: Record<string, unknown>) => void,
): void {
	// ── Open Table (data grid) ──────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'dotaz.openTable',
			(connectionId: string, schema: string, table: string, database?: string) => {
				createWebviewPanel('data-grid', `${table}`, {
					connectionId,
					schema,
					table,
					database,
				})
			},
		),
	)

	// ── Open Saved View ─────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'dotaz.openSavedView',
			(connectionId: string, savedView: SavedView, database?: string) => {
				createWebviewPanel('data-grid', `${savedView.tableName} — ${savedView.name}`, {
					connectionId,
					schema: savedView.schemaName,
					table: savedView.tableName,
					database,
					savedViewId: savedView.id,
				})
			},
		),
	)

	// ── View Schema ─────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'dotaz.viewSchema',
			(connectionId: string, schema: string, table: string, database?: string) => {
				createWebviewPanel('schema-viewer', `Schema — ${table}`, {
					connectionId,
					schema,
					table,
					database,
				})
			},
		),
	)

	// ── ER Diagram ──────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.erDiagram', (connectionIdOrItem?: string | SchemaTreeItem | DatabaseTreeItem, schemaOrDatabase?: string, database?: string) => {
			let connectionId: string
			let schemaName: string

			if (typeof connectionIdOrItem === 'string') {
				connectionId = connectionIdOrItem
				schemaName = schemaOrDatabase ?? 'public'
			} else if (connectionIdOrItem && 'type' in connectionIdOrItem) {
				if (connectionIdOrItem.type === 'schema') {
					connectionId = connectionIdOrItem.connectionId
					schemaName = connectionIdOrItem.schemaName
					database = connectionIdOrItem.database
				} else if (connectionIdOrItem.type === 'database') {
					connectionId = connectionIdOrItem.connectionId
					database = connectionIdOrItem.dbInfo.name
					// Get first schema from cache
					const cached = schemaCache.get(connectionId, database)
					schemaName = cached?.schemas?.[0]?.name ?? 'public'
				} else {
					return
				}
			} else {
				return
			}

			createWebviewPanel('er-diagram', `ER — ${schemaName}`, {
				connectionId,
				schema: schemaName,
				database,
			})
		}),
	)

	// ── New SQL Console ─────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.newSqlConsole', async (connectionIdOrItem?: string | { connectionId?: string; conn?: { id: string } }) => {
			let connectionId: string | undefined

			if (typeof connectionIdOrItem === 'string') {
				connectionId = connectionIdOrItem
			} else if (connectionIdOrItem && 'conn' in connectionIdOrItem) {
				connectionId = connectionIdOrItem.conn?.id
			} else if (connectionIdOrItem && 'connectionId' in connectionIdOrItem) {
				connectionId = connectionIdOrItem.connectionId
			}

			if (!connectionId) {
				// Use active connection or prompt
				const connections = connectionManager.listConnections()
					.filter((c) => c.state === 'connected')
				if (connections.length === 0) {
					vscode.window.showWarningMessage('No active connections. Connect to a database first.')
					return
				}
				if (connections.length === 1) {
					connectionId = connections[0].id
				} else {
					const picked = await vscode.window.showQuickPick(
						connections.map((c) => ({ label: c.name, connectionId: c.id })),
						{ placeHolder: 'Select connection for SQL console' },
					)
					if (!picked) return
					connectionId = picked.connectionId
				}
			}

			// Phase 2 will create a virtual document with dotaz:// scheme.
			// For now, create a new untitled SQL file.
			const doc = await vscode.workspace.openTextDocument({
				language: 'sql',
				content: '-- SQL Console\n',
			})
			await vscode.window.showTextDocument(doc)
		}),
	)

	// ── Add Connection ──────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.addConnection', () => {
			createWebviewPanel('connection-dialog', 'New Connection', {})
		}),
	)

	// ── Edit Connection ─────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.editConnection', (item?: { conn?: { id: string } }) => {
			if (!item?.conn) return
			createWebviewPanel('connection-dialog', 'Edit Connection', {
				connectionId: item.conn.id,
			})
		}),
	)

	// ── Export Table ─────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'dotaz.exportTable',
			(connectionId: string, schema: string, table: string, database?: string) => {
				createWebviewPanel('export-dialog', `Export — ${table}`, {
					connectionId,
					schema,
					table,
					database,
				})
			},
		),
	)

	// ── Import Table ────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'dotaz.importTable',
			(connectionId: string, schema: string, table: string, database?: string) => {
				createWebviewPanel('import-dialog', `Import — ${table}`, {
					connectionId,
					schema,
					table,
					database,
				})
			},
		),
	)

	// ── Search Database ─────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.searchDatabase', async (connectionIdOrItem?: string | { conn?: { id: string } }) => {
			let connectionId: string | undefined

			if (typeof connectionIdOrItem === 'string') {
				connectionId = connectionIdOrItem
			} else if (connectionIdOrItem && 'conn' in connectionIdOrItem) {
				connectionId = connectionIdOrItem.conn?.id
			}

			if (!connectionId) {
				const connections = connectionManager.listConnections()
					.filter((c) => c.state === 'connected')
				if (connections.length === 0) {
					vscode.window.showWarningMessage('No active connections.')
					return
				}
				if (connections.length === 1) {
					connectionId = connections[0].id
				} else {
					const picked = await vscode.window.showQuickPick(
						connections.map((c) => ({ label: c.name, connectionId: c.id })),
						{ placeHolder: 'Select connection to search' },
					)
					if (!picked) return
					connectionId = picked.connectionId
				}
			}

			const searchTerm = await vscode.window.showInputBox({
				prompt: 'Search database content',
				placeHolder: 'Enter search term...',
			})
			if (!searchTerm) return

			createWebviewPanel('search-results', `Search — ${searchTerm}`, {
				connectionId,
				searchTerm,
			})
		}),
	)

	// ── Move to Group ───────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.moveToGroup', async (item?: { conn?: { id: string } }) => {
			if (!item?.conn) return

			const groups = appDb.listConnectionGroups()
			const items: { label: string; groupName: string | null }[] = [
				{ label: '(No Group)', groupName: null },
				...groups.map((g) => ({ label: g, groupName: g })),
			]

			const picked = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select group (or type a new name)',
			})

			if (picked) {
				appDb.setConnectionGroup(item.conn.id, picked.groupName)
				treeProvider.refresh()
			} else {
				// User might want to type a new group name
				const newName = await vscode.window.showInputBox({
					prompt: 'Enter group name',
				})
				if (newName !== undefined) {
					appDb.setConnectionGroup(item.conn.id, newName.trim() || null)
					treeProvider.refresh()
				}
			}
		}),
	)

	// ── Rename Group ────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.renameGroup', async (item?: GroupTreeItem) => {
			if (!item || !('groupName' in item)) return
			const newName = await vscode.window.showInputBox({
				prompt: 'New group name',
				value: item.groupName,
			})
			if (newName !== undefined && newName.trim() && newName.trim() !== item.groupName) {
				appDb.renameConnectionGroup(item.groupName, newName.trim())
				treeProvider.refresh()
			}
		}),
	)

	// ── Ungroup All ─────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.ungroupAll', async (item?: GroupTreeItem) => {
			if (!item || !('groupName' in item)) return
			appDb.deleteConnectionGroup(item.groupName)
			treeProvider.refresh()
		}),
	)
}
