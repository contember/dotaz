import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import { CONNECTION_TYPE_META, getDefaultDatabase } from '@dotaz/shared/types/connection'
import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import { LoggingDriver } from '@dotaz/backend-shared/db/logging-driver'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { QueryExecutor } from '@dotaz/backend-shared/services/query-executor'
import { SessionManager } from '@dotaz/backend-shared/services/session-manager'
import { createLocalKey } from '@dotaz/backend-shared/services/encryption'
import { createHandlers } from '@dotaz/backend-shared/rpc/handlers'
import { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import { createSqlJsSqlite } from './sqljs-sqlite'
import { NodeMysqlDriver } from './node-mysql-driver'
import { NodePostgresDriver } from './node-postgres-driver'
import { NodeSqliteDriver } from './node-sqlite-driver'
import { createSshTunnel } from './node-ssh-tunnel'
import { VscodeBackendAdapter } from './vscode-backend-adapter'
import { ConnectionTreeProvider } from './views/connection-tree-provider'
import { SchemaCache } from './state/schema-cache'
import { StatusBar } from './status/status-bar'
import { WebviewRpcManager } from './webviews/webview-rpc-manager'
import { registerConnectionCommands } from './commands/connection-commands'
import { registerQueryCommands } from './commands/query-commands'
import { registerTransactionCommands } from './commands/transaction-commands'
import { registerNavigationCommands } from './commands/navigation-commands'
import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'

let appDb: AppDatabase | null = null
let connectionManager: ConnectionManager | null = null

function createNodeDriver(config: ConnectionConfig): DatabaseDriver {
	let driver: DatabaseDriver
	switch (config.type) {
		case 'postgresql':
			driver = new NodePostgresDriver()
			break
		case 'sqlite':
			driver = new NodeSqliteDriver()
			break
		case 'mysql':
			driver = new NodeMysqlDriver()
			break
		default:
			throw new Error(`Unsupported connection type: ${(config as any).type}`)
	}
	if (process.env.DEBUG_SQL) {
		driver = new LoggingDriver(driver)
	}
	return driver
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// Ensure global storage directory exists
	const storagePath = context.globalStorageUri.fsPath
	fs.mkdirSync(storagePath, { recursive: true })

	const dbPath = path.join(storagePath, 'dotaz.db')
	const sqlite = await createSqlJsSqlite(dbPath)
	appDb = AppDatabase.create(sqlite)

	// Set up local encryption key for password storage
	const localKey = createLocalKey()
	if (localKey) {
		appDb.setLocalKey(localKey)
	}

	connectionManager = new ConnectionManager(appDb, {}, createNodeDriver, createSshTunnel)
	const queryExecutor = new QueryExecutor(connectionManager, undefined, appDb)
	const sessionManager = new SessionManager(connectionManager, appDb)

	// ── Schema cache ────────────────────────────────────────
	const schemaCache = new SchemaCache(connectionManager)

	// ── WebviewRpcManager ───────────────────────────────────
	const adapter = new VscodeBackendAdapter(
		connectionManager,
		queryExecutor,
		appDb,
		{
			emitMessage: (channel, payload) => rpcManager.broadcast(channel, payload),
			sessionManager,
			vscodeWindow: vscode.window,
		},
	)
	const handlers: Record<string, (params: any) => any> = { ...createHandlers(adapter) }

	// Wrap connection create/update handlers to refresh tree after save
	const origCreate = handlers['connections.create']
	handlers['connections.create'] = async (params: any) => {
		const result = await origCreate(params)
		treeProvider.refresh()
		vscode.window.showInformationMessage(`Connection "${params.name}" created.`)
		return result
	}

	const origUpdate = handlers['connections.update']
	handlers['connections.update'] = async (params: any) => {
		const result = await origUpdate(params)
		treeProvider.refresh()
		return result
	}

	// VS Code-specific handler: webview requests to open a new panel
	handlers['vscode.openPanel'] = (params: {
		type: string
		title: string
		connectionId?: string
		schema?: string
		table?: string
		database?: string
		viewId?: string
	}) => {
		createWebviewPanel(context, rpcManager, params.type, params.title, {
			connectionId: params.connectionId,
			schema: params.schema,
			table: params.table,
			database: params.database,
			savedViewId: params.viewId,
		})
	}

	const rpcManager = new WebviewRpcManager(handlers)

	// ── TreeView ────────────────────────────────────────────
	const treeProvider = new ConnectionTreeProvider(connectionManager, appDb, schemaCache)
	const treeView = vscode.window.createTreeView('dotaz.connections', {
		treeDataProvider: treeProvider,
		showCollapseAll: true,
	})
	context.subscriptions.push(treeView)

	// ── Status Bar ──────────────────────────────────────────
	const statusBar = new StatusBar(connectionManager)
	context.subscriptions.push(statusBar)

	// ── Connection status listener ──────────────────────────
	connectionManager.onStatusChanged((event) => {
		// Update TreeView
		treeProvider.refresh()

		// Update StatusBar
		statusBar.onStatusChanged(event)

		// Broadcast to webviews
		rpcManager.broadcast('connection.status', event)

		// Load schema on connect (including all active databases for multi-db)
		if (event.state === 'connected') {
			const conn = connectionManager.listConnections().find((c) => c.id === event.connectionId)
			const activeDbs = conn && 'activeDatabases' in conn.config ? conn.config.activeDatabases : undefined
			const defaultDb = conn && CONNECTION_TYPE_META[conn.config.type].supportsMultiDatabase ? getDefaultDatabase(conn.config) : undefined
			schemaCache.loadAll(event.connectionId, activeDbs, defaultDb).then(() => {
				treeProvider.refresh()
			}).catch(() => {})
		}

		// Clear schema cache on disconnect
		if (event.state === 'disconnected') {
			schemaCache.invalidate(event.connectionId)
		}
	})

	// ── Register Commands ───────────────────────────────────
	registerConnectionCommands(context, connectionManager, appDb, schemaCache, treeProvider, statusBar)
	registerQueryCommands(context, connectionManager, queryExecutor, statusBar)
	registerTransactionCommands(context, connectionManager, statusBar)
	registerNavigationCommands(
		context,
		connectionManager,
		appDb,
		schemaCache,
		treeProvider,
		rpcManager,
		(type, title, panelContext) => {
			createWebviewPanel(context, rpcManager, type, title, panelContext)
		},
	)

	// ── Legacy "dotaz.open" command (full-app webview) ───────
	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.open', () => {
			createWebviewPanel(context, rpcManager, 'full-app', 'Dotaz', {})
		}),
	)
}

export async function deactivate(): Promise<void> {
	if (connectionManager) {
		await connectionManager.disconnectAll()
		connectionManager = null
	}
	if (appDb) {
		appDb.close()
		appDb = null
	}
}

// ── Webview Panel Factory ──────────────────────────────────

function createWebviewPanel(
	context: vscode.ExtensionContext,
	rpcManager: WebviewRpcManager,
	type: string,
	title: string,
	panelContext: Record<string, unknown>,
): vscode.WebviewPanel {
	const panel = vscode.window.createWebviewPanel(
		`dotaz.${type}`,
		title,
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, 'webview'),
			],
		},
	)

	const webviewDir = vscode.Uri.joinPath(context.extensionUri, 'webview')

	// Read the built index.html and rewrite asset paths for the webview
	const indexPath = vscode.Uri.joinPath(webviewDir, 'index.html')
	let html: string
	try {
		html = fs.readFileSync(indexPath.fsPath, 'utf-8')
	} catch {
		html = getFallbackHtml()
	}

	// Generate CSP nonce
	const nonce = getNonce()

	// Rewrite asset paths to use webview URIs
	const baseUri = panel.webview.asWebviewUri(webviewDir)
	html = html
		.replace(/(href|src)="\.?\/?/g, `$1="${baseUri}/`)
		.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i, '')

	// Inject CSP meta tag
	const csp = [
		`default-src 'none'`,
		`style-src ${panel.webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}' ${panel.webview.cspSource}`,
		`font-src ${panel.webview.cspSource}`,
		`img-src ${panel.webview.cspSource} data:`,
		`connect-src ${panel.webview.cspSource}`,
	].join('; ')

	html = html.replace(
		'<head>',
		`<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`,
	)

	// Add nonce to script tags
	html = html.replace(/<script\b/g, `<script nonce="${nonce}"`)

	// Inject panel context as initial data (include panel type for routing)
	const contextScript = `<script nonce="${nonce}">window.__DOTAZ_CONTEXT__ = ${JSON.stringify({ ...panelContext, type })};</script>`
	html = html.replace('</head>', `${contextScript}\n</head>`)

	panel.webview.html = html

	// Register with RPC manager
	const panelId = crypto.randomUUID()
	context.subscriptions.push(rpcManager.register(panelId, panel))

	return panel
}

function getNonce(): string {
	let text = ''
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length))
	}
	return text
}

function getFallbackHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Dotaz</title>
</head>
<body>
	<div id="app">
		<p style="color: #ccc; padding: 20px;">
			Dotaz webview assets not found. Run the build first.
		</p>
	</div>
</body>
</html>`
}
