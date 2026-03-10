import type { ConnectionInfo } from '@dotaz/shared/types/connection'
import { CONNECTION_TYPE_META, getDefaultDatabase } from '@dotaz/shared/types/connection'
import type { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import type { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { ConnectionTreeProvider } from '../views/connection-tree-provider'
import type { ConnectionTreeItem } from '../views/tree-items'
import type { SchemaCache } from '../state/schema-cache'
import type { StatusBar } from '../status/status-bar'
import * as vscode from 'vscode'

export function registerConnectionCommands(
	context: vscode.ExtensionContext,
	connectionManager: ConnectionManager,
	appDb: AppDatabase,
	schemaCache: SchemaCache,
	treeProvider: ConnectionTreeProvider,
	statusBar: StatusBar,
): void {
	// ── Connect ─────────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.connect', async (connectionIdOrItem?: string | ConnectionTreeItem) => {
			let connectionId: string | undefined

			if (typeof connectionIdOrItem === 'string') {
				connectionId = connectionIdOrItem
			} else if (connectionIdOrItem && 'conn' in connectionIdOrItem) {
				connectionId = connectionIdOrItem.conn.id
			}

			if (!connectionId) {
				// Show QuickPick to select a connection
				const connections = connectionManager.listConnections()
				const disconnected = connections.filter(
					(c) => c.state === 'disconnected' || c.state === 'error',
				)
				if (disconnected.length === 0) {
					vscode.window.showInformationMessage('No disconnected connections available.')
					return
				}

				const picked = await vscode.window.showQuickPick(
					disconnected.map((c) => ({
						label: c.name,
						description: c.config.type,
						connectionId: c.id,
					})),
					{ placeHolder: 'Select connection to connect' },
				)
				if (!picked) return
				connectionId = picked.connectionId
			}

			const conn = appDb.getConnectionById(connectionId)
			if (!conn) return

			// Prompt for password if needed
			let password: string | undefined
			const meta = CONNECTION_TYPE_META[conn.config.type]
			if (meta.hasPassword) {
				// Check if password is stored
				const hasStoredPassword = 'password' in conn.config && conn.config.password
				if (!hasStoredPassword) {
					const input = await vscode.window.showInputBox({
						prompt: `Enter password for ${conn.name}`,
						password: true,
					})
					if (input === undefined) return // Cancelled
					password = input
				}
			}

			try {
				await connectionManager.connect(connectionId, password ? { password } : undefined)
				const defaultDb = CONNECTION_TYPE_META[conn.config.type].supportsMultiDatabase ? getDefaultDatabase(conn.config) : undefined
				await schemaCache.loadAll(connectionId, getActiveDatabases(conn), defaultDb)
				treeProvider.refresh()
			} catch (err) {
				vscode.window.showErrorMessage(
					`Failed to connect to "${conn.name}": ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}),
	)

	// ── Disconnect ──────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.disconnect', async (connectionIdOrItem?: string | ConnectionTreeItem) => {
			let connectionId: string | undefined

			if (typeof connectionIdOrItem === 'string') {
				connectionId = connectionIdOrItem
			} else if (connectionIdOrItem && 'conn' in connectionIdOrItem) {
				connectionId = connectionIdOrItem.conn.id
			}

			if (!connectionId) {
				// Show QuickPick to select which to disconnect
				const connected = connectionManager.listConnections()
					.filter((c) => c.state === 'connected')
				if (connected.length === 0) {
					vscode.window.showInformationMessage('No active connections.')
					return
				}

				const picked = await vscode.window.showQuickPick(
					connected.map((c) => ({
						label: c.name,
						description: c.config.type,
						connectionId: c.id,
					})),
					{ placeHolder: 'Select connection to disconnect' },
				)
				if (!picked) return
				connectionId = picked.connectionId
			}

			try {
				await connectionManager.disconnect(connectionId)
				schemaCache.invalidate(connectionId)
				treeProvider.refresh()
			} catch (err) {
				vscode.window.showErrorMessage(
					`Failed to disconnect: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}),
	)

	// ── Refresh Connections ─────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.refreshConnections', async () => {
			const connections = connectionManager.listConnections()
			for (const conn of connections) {
				if (conn.state === 'connected') {
					const defaultDb = CONNECTION_TYPE_META[conn.config.type].supportsMultiDatabase ? getDefaultDatabase(conn.config) : undefined
					await schemaCache.loadAll(conn.id, getActiveDatabases(conn), defaultDb).catch(() => {})
				}
			}
			treeProvider.refresh()
		}),
	)

	// ── Switch Connection (status bar) ──────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.switchConnection', async () => {
			const connections = connectionManager.listConnections()
			const items = connections.map((c) => ({
				label: c.name,
				description: `${c.config.type} — ${c.state}`,
				connectionId: c.id,
			}))

			const picked = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select active connection',
			})
			if (!picked) return

			const conn = connections.find((c) => c.id === picked.connectionId)
			if (conn && conn.state !== 'connected') {
				await vscode.commands.executeCommand('dotaz.connect', picked.connectionId)
			}
			statusBar.setActiveConnection(picked.connectionId)
		}),
	)

	// ── Delete Connection ───────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.deleteConnection', async (item?: ConnectionTreeItem) => {
			if (!item || !('conn' in item)) return

			const confirmed = await vscode.window.showWarningMessage(
				`Delete connection "${item.conn.name}"? This cannot be undone.`,
				{ modal: true },
				'Delete',
			)
			if (confirmed !== 'Delete') return

			try {
				await connectionManager.deleteConnection(item.conn.id)
				schemaCache.invalidate(item.conn.id)
				treeProvider.refresh()
			} catch (err) {
				vscode.window.showErrorMessage(
					`Failed to delete connection: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}),
	)

	// ── Toggle Read-Only ────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.toggleReadOnly', async (item?: ConnectionTreeItem) => {
			if (!item || !('conn' in item)) return
			const newReadOnly = !item.conn.readOnly
			connectionManager.setConnectionReadOnly(item.conn.id, newReadOnly)
			treeProvider.refresh()
			statusBar.onStatusChanged({
				connectionId: item.conn.id,
				state: item.conn.state,
			})
		}),
	)
}

function getActiveDatabases(conn: ConnectionInfo): string[] | undefined {
	if ('activeDatabases' in conn.config) {
		return conn.config.activeDatabases
	}
	return undefined
}
