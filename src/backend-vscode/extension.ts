import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import { LoggingDriver } from '@dotaz/backend-shared/db/logging-driver'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { QueryExecutor } from '@dotaz/backend-shared/services/query-executor'
import { SessionManager } from '@dotaz/backend-shared/services/session-manager'
import { createLocalKey } from '@dotaz/backend-shared/services/encryption'
import { createHandlers } from '@dotaz/backend-shared/rpc/handlers'
import { NodeAppDatabase } from './node-app-db'
import { NodePostgresDriver } from './node-postgres-driver'
import { NodeSqliteDriver } from './node-sqlite-driver'
import { createSshTunnel } from './node-ssh-tunnel'
import { VscodeBackendAdapter } from './vscode-backend-adapter'
import { RpcServer } from './rpc-server'
import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'

let appDb: NodeAppDatabase | null = null
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
		default:
			throw new Error(`Unsupported connection type: ${(config as any).type}`)
	}
	if (process.env.DEBUG_SQL) {
		driver = new LoggingDriver(driver)
	}
	return driver
}

export function activate(context: vscode.ExtensionContext): void {
	// Ensure global storage directory exists
	const storagePath = context.globalStorageUri.fsPath
	fs.mkdirSync(storagePath, { recursive: true })

	const dbPath = path.join(storagePath, 'dotaz.db')
	appDb = NodeAppDatabase.create(dbPath)

	// Set up local encryption key for password storage
	const localKey = createLocalKey()
	if (localKey) {
		appDb.setLocalKey(localKey)
	}

	connectionManager = new ConnectionManager(appDb as any, {}, createNodeDriver, createSshTunnel)
	const queryExecutor = new QueryExecutor(connectionManager, undefined, appDb as any)
	const sessionManager = new SessionManager(connectionManager, appDb as any)

	// Forward connection status changes as messages
	let rpcServer: RpcServer | null = null

	const emitMessage = (channel: string, payload: unknown) => {
		rpcServer?.emitMessage(channel, payload)
	}

	connectionManager.onStatusChanged((event) => {
		emitMessage('connection.status', event)
	})

	const adapter = new VscodeBackendAdapter(
		connectionManager,
		queryExecutor,
		appDb,
		{
			emitMessage,
			sessionManager,
			vscodeWindow: vscode.window,
		},
	)
	const handlers = createHandlers(adapter)

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.open', () => {
			const panel = createPanel(context)
			rpcServer = new RpcServer(panel, handlers)
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

function createPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
	const panel = vscode.window.createWebviewPanel(
		'dotaz',
		'Dotaz',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, 'dist-vscode', 'webview'),
			],
		},
	)

	const webviewDir = vscode.Uri.joinPath(context.extensionUri, 'dist-vscode', 'webview')

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
		.replace(/(href|src)="(?!https?:\/\/)/g, `$1="${baseUri}/`)
		.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i, '')

	// Inject CSP meta tag
	const csp = [
		`default-src 'none'`,
		`style-src ${panel.webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
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

	panel.webview.html = html

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
