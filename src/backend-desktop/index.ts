import { createHandlers } from '@dotaz/backend-shared/rpc/rpc-handlers'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { createLocalKey } from '@dotaz/backend-shared/services/encryption'
import { AppDatabase, setDefaultDbPath } from '@dotaz/backend-shared/storage/app-db'
import type { DotazRPC } from '@dotaz/backend-types'
import { ApplicationMenu, BrowserView, BrowserWindow, Updater, Utils } from 'electrobun/bun'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DEV_SERVER_PORT = 6400
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel()
	if (channel === 'dev') {
		try {
			await fetch(DEV_SERVER_URL, { method: 'HEAD' })
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`)
			return DEV_SERVER_URL
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			)
		}
	}
	return 'views://mainview/index.html'
}

// Configure default DB path before initializing
setDefaultDbPath(() => {
	const dir = Utils.paths.userData
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true })
	}
	return join(dir, 'dotaz.db')
})

// Initialize backend services
const appDb = AppDatabase.getInstance()
const localKey = createLocalKey()
if (localKey) {
	appDb.setLocalKey(localKey)
}
const connectionManager = new ConnectionManager(appDb)

// Create RPC handlers with deferred message emitter (set after window creation)
let emitToFrontend: ((channel: string, payload: unknown) => void) | undefined
const userDataDir = Utils.paths.userData
// Demo DB: try dev-time path first, then bundled resource next to the executable
const devDemoPath = resolve(import.meta.dir, '../../scripts/seed/bookstore.db')
const bundledDemoPath = resolve(import.meta.dir, '../resources/bookstore.db')
const demoDbSourcePath = existsSync(devDemoPath) ? devDemoPath : bundledDemoPath
const { handlers, sessionManager } = createHandlers(connectionManager, undefined, appDb, Utils, {
	emitMessage: (channel, payload) => emitToFrontend?.(channel, payload),
	demoDbSourcePath,
	demoDbTargetPath: join(userDataDir, 'bookstore-demo.db'),
})
const rpc = BrowserView.defineRPC<DotazRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {
			...handlers,
			'update.apply': async () => {
				await Updater.applyUpdate()
			},
			'window.minimize': () => {
				mainWindow.minimize()
			},
			'window.maximize': () => {
				if (mainWindow.isMaximized()) mainWindow.unmaximize()
				else mainWindow.maximize()
			},
			'window.close': () => {
				mainWindow.close()
			},
		},
		messages: {},
	},
})

const url = await getMainViewUrl()

const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

// Set up native application menu (macOS only).
// The Edit menu with roles is required for clipboard shortcuts (Cmd+C/V/X/A)
// to work in webview text inputs.
// Items with `action` are forwarded to the frontend via menu.action RPC message.
if (isMac) {
	ApplicationMenu.setApplicationMenu([
		{
			label: 'Dotaz',
			submenu: [
				{ role: 'about' },
				{ type: 'divider' },
				{ label: 'Settings', action: 'settings', accelerator: 'Cmd+,' },
				{ type: 'divider' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'showAll' },
				{ type: 'divider' },
				{ role: 'quit' },
			],
		},
		{
			label: 'File',
			submenu: [
				{ label: 'New SQL Console', action: 'new-sql-console', accelerator: 'Cmd+N' },
				{ label: 'Close Tab', action: 'close-tab', accelerator: 'Cmd+W' },
			],
		},
		{
			label: 'Edit',
			submenu: [
				{ role: 'undo', accelerator: 'Cmd+Z' },
				{ role: 'redo', accelerator: 'Cmd+Shift+Z' },
				{ type: 'divider' },
				{ role: 'cut', accelerator: 'Cmd+X' },
				{ role: 'copy', accelerator: 'Cmd+C' },
				{ role: 'paste', accelerator: 'Cmd+V' },
				{ role: 'selectAll', accelerator: 'Cmd+A' },
				{ type: 'divider' },
				{ label: 'Add New Row', action: 'add-new-row' },
			],
		},
		{
			label: 'View',
			submenu: [
				{ label: 'Toggle Sidebar', action: 'toggle-sidebar', accelerator: 'Cmd+B' },
				{ label: 'Command Palette', action: 'command-palette', accelerator: 'Cmd+Shift+P' },
				{ type: 'divider' },
				{ label: 'Refresh Data', action: 'refresh-data', accelerator: 'F5' },
				{ type: 'divider' },
				{ label: 'Zoom In', action: 'zoom-in', accelerator: 'Cmd+=' },
				{ label: 'Zoom Out', action: 'zoom-out', accelerator: 'Cmd+-' },
				{ label: 'Reset Zoom', action: 'zoom-reset', accelerator: 'Cmd+0' },
			],
		},
		{
			label: 'Connection',
			submenu: [
				{ label: 'New Connection', action: 'new-connection' },
				{ label: 'Disconnect', action: 'disconnect' },
				{ type: 'divider' },
				{ label: 'Reconnect', action: 'reconnect' },
			],
		},
		{
			label: 'Query',
			submenu: [
				{ label: 'Run Query', action: 'run-query', accelerator: 'Cmd+Enter' },
				{ label: 'Cancel Query', action: 'cancel-query' },
				{ type: 'divider' },
				{ label: 'Format SQL', action: 'format-sql', accelerator: 'Cmd+Shift+F' },
			],
		},
		{
			label: 'Window',
			submenu: [
				{ role: 'minimize' },
				{ role: 'zoom' },
				{ role: 'toggleFullScreen' },
			],
		},
		{
			label: 'Help',
			submenu: [
				{ label: 'Keyboard Shortcuts', action: 'keyboard-shortcuts', accelerator: 'Cmd+/' },
			],
		},
	])

	// Forward menu action clicks to the frontend
	ApplicationMenu.on('application-menu-clicked', (event: any) => {
		const action = event?.action
		if (action && emitToFrontend) {
			emitToFrontend('menu.action', { action })
		}
	})
}

const mainWindow = new BrowserWindow({
	title: 'Dotaz',
	titleBarStyle: isMac ? 'hiddenInset' : isLinux ? 'default' : 'hidden',
	transparent: false,
	url,
	rpc,
	frame: {
		width: 1280,
		height: 800,
		x: 0,
		y: 0,
	},
})

// Maximize on startup so the window appears on the primary monitor at full size
mainWindow.maximize()

// Wire up BE→FE message emitter after window creation
emitToFrontend = (channel: string, payload: unknown) => {
	;(mainWindow as any).webview.rpc.send[channel](payload)
}

// Wire up BE→FE notifications after window creation
connectionManager.onSessionDead((event) => {
	sessionManager.handleSessionDead(event.sessionId)
	emitToFrontend!('session.changed', {
		connectionId: event.connectionId,
		sessions: sessionManager.listSessions(event.connectionId),
	})
})

connectionManager.onStatusChanged(async (event) => {
	emitToFrontend!('connections.statusChanged', {
		connectionId: event.connectionId,
		state: event.state,
		error: event.error,
		errorCode: event.errorCode,
		transactionLost: event.transactionLost,
	})

	// Clean up sessions on disconnect/error and notify frontend
	if (event.state === 'disconnected' || event.state === 'error') {
		sessionManager.handleConnectionLost(event.connectionId)
		emitToFrontend!('session.changed', {
			connectionId: event.connectionId,
			sessions: [],
		})
	}

	// Restore sessions after successful reconnect
	if (event.state === 'connected') {
		try {
			const restored = await sessionManager.handleConnectionRestored(event.connectionId)
			if (restored.length > 0) {
				emitToFrontend!('session.changed', {
					connectionId: event.connectionId,
					sessions: restored,
				})
			}
		} catch (err) {
			console.warn('Session restoration failed:', err instanceof Error ? err.message : err)
		}
	}
})

// ── Auto-update ──────────────────────────────────────────
const currentChannel = await Updater.localInfo.channel()
if (currentChannel !== 'dev') {
	setTimeout(async () => {
		try {
			const info = await Updater.checkForUpdate()
			if (info.updateAvailable) {
				console.log(`Update available: ${info.version}`)
				await Updater.downloadUpdate()
				emitToFrontend!('update.ready', { version: info.version })
			}
		} catch (e) {
			console.error('Update check failed:', e)
		}
	}, 10_000)
}

console.log('Dotaz started!')
