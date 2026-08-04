import { createHandlers } from '@dotaz/backend-shared/rpc/rpc-handlers'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { createLocalKey, loadOrCreateMasterKey } from '@dotaz/backend-shared/services/encryption'
import { AppDatabase, setDefaultDbPath } from '@dotaz/backend-shared/storage/app-db'
import type { DotazRPC } from '@dotaz/backend-types'
import { ApplicationMenu, BrowserView, BrowserWindow, Updater, Utils } from 'electrobun/bun'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type ControlServerHandle, startControlServer } from './control-server'

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
// Master key lives in the OS keychain (Bun.secrets). The legacy hostname-derived
// key is passed in so existing entries from older versions get re-encrypted on
// first launch.
const masterKey = await loadOrCreateMasterKey()
if (masterKey) {
	appDb.setLocalKey(masterKey, createLocalKey())
}
const connectionManager = new ConnectionManager(appDb)

// Create RPC handlers with deferred message emitter (set after window creation)
let emitToFrontend: ((channel: string, payload: unknown) => void) | undefined
const userDataDir = Utils.paths.userData
// Demo DB: try dev-time path first, then bundled resource next to the executable
const devDemoPath = resolve(import.meta.dir, '../../scripts/seed/bookstore.db')
const bundledDemoPath = resolve(import.meta.dir, '../resources/bookstore.db')
const demoDbSourcePath = existsSync(devDemoPath) ? devDemoPath : bundledDemoPath
const appVersion = await Updater.localInfo.version()
const { handlers, sessionManager } = createHandlers(connectionManager, undefined, appDb, Utils, {
	emitMessage: (channel, payload) => emitToFrontend?.(channel, payload),
	demoDbSourcePath,
	demoDbTargetPath: join(userDataDir, 'bookstore-demo.db'),
	appVersion,
	mode: 'desktop',
})

// ── CLI control endpoint (see docs/agent-cli.md) ─────────
// Off unless the user opts in, and started/stopped live so the Settings toggle
// takes effect without a restart.
let controlServer: ControlServerHandle | null = null

function cliAccessEnabled(): boolean {
	return process.env.DOTAZ_CLI === '1' || appDb.getBooleanSetting('cli.enabled') === true
}

async function syncControlServer(): Promise<void> {
	const enabled = cliAccessEnabled()
	if (enabled && !controlServer) {
		try {
			controlServer = await startControlServer({ handlers, userDataDir, appVersion })
			const { address } = controlServer
			console.log(`CLI endpoint listening on ${address.transport === 'unix' ? address.socket : `127.0.0.1:${address.port}`}`)
		} catch (err) {
			console.error('CLI endpoint failed to start:', err instanceof Error ? err.message : err)
		}
	} else if (!enabled && controlServer) {
		await controlServer.stop()
		controlServer = null
		console.log('CLI endpoint stopped')
	}
}
const rpc = BrowserView.defineRPC<DotazRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {
			...handlers,
			'settings.set': (params: { key: string; value: string }) => {
				handlers['settings.set'](params)
				if (params.key === 'cli.enabled') void syncControlServer()
			},
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
			'window.setTitle': (params: { title: string }) => {
				mainWindow.setTitle(params.title)
			},
		},
		messages: {},
	},
})

const url = await getMainViewUrl()

const isMac = process.platform === 'darwin'

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

// ── Window geometry persistence ──────────────────────────
// Restore the user's last frame on launch and persist resize/move events so
// the app behaves like a normal desktop app on every platform.

const SAVED_FRAME_KEY = 'window.frame'

interface SavedFrame {
	x: number
	y: number
	width: number
	height: number
}

function loadSavedFrame(): SavedFrame | null {
	const raw = appDb.getSetting(SAVED_FRAME_KEY)
	if (!raw) return null
	try {
		const parsed = JSON.parse(raw) as Partial<SavedFrame>
		if (
			typeof parsed.x !== 'number'
			|| typeof parsed.y !== 'number'
			|| typeof parsed.width !== 'number'
			|| typeof parsed.height !== 'number'
			|| !Number.isFinite(parsed.x)
			|| !Number.isFinite(parsed.y)
			|| parsed.width < 480
			|| parsed.height < 320
			|| parsed.width > 20000
			|| parsed.height > 20000
		) {
			return null
		}
		return parsed as SavedFrame
	} catch {
		return null
	}
}

const DEFAULT_FRAME: SavedFrame = { x: 100, y: 100, width: 1280, height: 800 }
const initialFrame = loadSavedFrame() ?? DEFAULT_FRAME

const mainWindow = new BrowserWindow({
	title: 'Dotaz',
	titleBarStyle: isMac ? 'hiddenInset' : 'default',
	transparent: false,
	url,
	rpc,
	frame: initialFrame,
})

// Persist the frame on resize / move so it survives restart. Debounced so we
// don't write to the settings table on every pixel the user drags.
let frameSaveTimer: ReturnType<typeof setTimeout> | undefined
function persistFrame() {
	try {
		const frame = mainWindow.getFrame()
		appDb.setSetting(SAVED_FRAME_KEY, JSON.stringify(frame))
	} catch (err) {
		console.warn('Window frame save failed:', err instanceof Error ? err.message : err)
	}
}
function scheduleFrameSave() {
	if (frameSaveTimer) clearTimeout(frameSaveTimer)
	frameSaveTimer = setTimeout(() => {
		frameSaveTimer = undefined
		persistFrame()
	}, 500)
}
function flushFrameSave() {
	if (!frameSaveTimer) return
	clearTimeout(frameSaveTimer)
	frameSaveTimer = undefined
	persistFrame()
}

mainWindow.on('resize', scheduleFrameSave)
mainWindow.on('move', scheduleFrameSave)
// Flush any pending debounced save before the window goes away so a quick
// resize-then-quit doesn't lose the last change.
mainWindow.on('close', flushFrameSave)

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

// Started after the window exists so backend → frontend messages have somewhere to land
await syncControlServer()

mainWindow.on('close', () => {
	void controlServer?.stop()
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
