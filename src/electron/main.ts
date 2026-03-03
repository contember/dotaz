import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { createApplicationMenu } from './menu'

const IS_DEV = !app.isPackaged
const VITE_DEV_PORT = 6404
const PROJECT_ROOT = IS_DEV ? process.cwd() : app.getAppPath()
const BACKEND_SCRIPT = resolve(PROJECT_ROOT, 'src/backend-web/server.ts')

let isQuitting = false

function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address()
			if (addr && typeof addr === 'object') {
				const port = addr.port
				server.close(() => resolve(port))
			} else {
				server.close(() => reject(new Error('Failed to get port')))
			}
		})
		server.on('error', reject)
	})
}

async function waitForServer(port: number, timeoutMs = 30_000): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}`)
			if (res.ok || res.status === 404) return // Server is up
		} catch {
			// Not ready yet
		}
		await new Promise((r) => setTimeout(r, 200))
	}
	throw new Error(`Backend server did not start within ${timeoutMs}ms`)
}

let bunProcess: ReturnType<typeof spawn> | null = null

app.whenReady().then(async () => {
	const backendPort = IS_DEV ? 6405 : await findFreePort()
	const encryptionKey = randomBytes(32).toString('hex')

	// In dev mode, the backend is started separately by concurrently
	if (!IS_DEV) {
		bunProcess = spawn('bun', ['run', BACKEND_SCRIPT], {
			env: {
				...process.env,
				DOTAZ_PORT: String(backendPort),
				DOTAZ_ENCRYPTION_KEY: encryptionKey,
			},
			stdio: 'inherit',
		})

		bunProcess.on('exit', (code) => {
			console.error(`Bun backend exited with code ${code}`)
			if (!isQuitting) {
				app.quit()
			}
		})

		await waitForServer(backendPort)
	}

	createApplicationMenu(backendPort)

	const mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		title: 'Dotaz',
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
		},
	})

	const url = IS_DEV
		? `http://localhost:${VITE_DEV_PORT}`
		: `http://127.0.0.1:${backendPort}`

	mainWindow.loadURL(url)

	mainWindow.on('closed', () => {
		if (!isQuitting) {
			app.quit()
		}
	})
})

app.on('before-quit', () => {
	isQuitting = true
	if (bunProcess && !bunProcess.killed) {
		bunProcess.kill()
		bunProcess = null
	}
})

app.on('window-all-closed', () => {
	app.quit()
})
