import { createHandlers } from '@dotaz/backend-shared/rpc/rpc-handlers'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { createLocalKey } from '@dotaz/backend-shared/services/encryption'
import { AppDatabase, setDefaultDbPath } from '@dotaz/backend-shared/storage/app-db'
import type { DotazRPC } from '@dotaz/backend-types'
import { BrowserView, BrowserWindow, Updater, Utils } from 'electrobun/bun'
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
const mainWindow = new BrowserWindow({
	title: 'Dotaz',
	titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
	transparent: false,
	url,
	rpc,
	frame: {
		width: 1280,
		height: 800,
		x: 200,
		y: 200,
	},
})

// Wire up BE→FE message emitter after window creation
emitToFrontend = (channel: string, payload: unknown) => {
	;(mainWindow as any).webview.rpc.send[channel](payload)
}

// Wire up BE→FE notifications after window creation
connectionManager.onStatusChanged((event) => {
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
