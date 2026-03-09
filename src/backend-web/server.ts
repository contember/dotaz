// Standalone web server entry point for Dotaz
// Serves the frontend via HTTP and handles RPC over WebSocket
// Each WebSocket connection gets its own isolated session (AppDatabase, ConnectionManager, handlers)

import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import { exportToStream } from '@dotaz/backend-shared/services/export-service'
import type { ExportParams, ExportWriter } from '@dotaz/backend-shared/services/export-service'
import { importFromStream } from '@dotaz/backend-shared/services/import-service'
import type { ImportStreamParams } from '@dotaz/backend-shared/services/import-service'
import { DatabaseError } from '@dotaz/shared/types/errors'
import type { ExportFormat } from '@dotaz/shared/types/export'
import { resolve } from 'node:path'
import {
	cleanupExpiredTokens,
	consumeStreamToken,
	createSession,
	createStreamToken,
	destroySession,
	getSessions,
	maybeDestroySession,
	releaseStream,
	type Session,
	SESSION_TTL_MS,
} from './session'

const PORT = Number(process.env.DOTAZ_PORT) || 6401
const HOST = process.env.DOTAZ_HOST || 'localhost'
const DIST_DIR = process.env.DOTAZ_DIST_DIR || resolve(import.meta.dir, '../../dist')

const ENCRYPTION_KEY = process.env.DOTAZ_ENCRYPTION_KEY
if (!ENCRYPTION_KEY) {
	console.error('DOTAZ_ENCRYPTION_KEY is required for web mode')
	process.exit(1)
}

// ── Periodic cleanup ───────────────────────────────────────

const ZOMBIE_SWEEP_INTERVAL_MS = 60_000 // 60 seconds

// Clean up expired tokens every 60 seconds
setInterval(() => {
	cleanupExpiredTokens()
}, 60_000)

// Periodic zombie session sweep — force-destroy sessions stuck with ws=null past TTL
setInterval(async () => {
	const now = Date.now()
	for (const [, session] of getSessions()) {
		if (session.disconnectedAt !== null && now - session.disconnectedAt > SESSION_TTL_MS) {
			await destroySession(session)
		}
	}
}, ZOMBIE_SWEEP_INTERVAL_MS)

// ── Content type mapping ───────────────────────────────────

const FORMAT_CONTENT_TYPES: Record<ExportFormat, string> = {
	csv: 'text/csv',
	json: 'application/json',
	sql: 'application/sql',
	markdown: 'text/markdown',
	sql_update: 'application/sql',
	html: 'text/html',
	xml: 'application/xml',
}

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
	csv: 'csv',
	json: 'json',
	sql: 'sql',
	markdown: 'md',
	sql_update: 'sql',
	html: 'html',
	xml: 'xml',
}

// ── HTTP stream endpoints ──────────────────────────────────

async function handleExportStream(req: Request, token: string): Promise<Response> {
	const entry = consumeStreamToken(token, 'export')
	if (!entry) {
		return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const { session, connectionId, database, params } = entry
	const exportParams = params as ExportParams

	let driver: DatabaseDriver
	try {
		driver = session.connectionManager.getDriver(connectionId, database)
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err?.message ?? 'Failed to get driver' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	session.activeStreams++

	const contentType = FORMAT_CONTENT_TYPES[exportParams.format] ?? 'application/octet-stream'
	const ext = FORMAT_EXTENSIONS[exportParams.format] ?? 'dat'
	const filename = `${exportParams.table}.${ext}`

	const abortController = new AbortController()
	// When the client disconnects, abort the export
	req.signal.addEventListener('abort', () => abortController.abort())

	const stream = new ReadableStream({
		async start(controller) {
			const writer: ExportWriter = {
				write(chunk) {
					if (typeof chunk === 'string') {
						controller.enqueue(new TextEncoder().encode(chunk))
					} else {
						controller.enqueue(chunk)
					}
				},
				async end() {
					// No-op; we close the controller after exportToStream completes
				},
			}

			try {
				const result = await exportToStream(driver, exportParams, writer, abortController.signal, (rowCount) => {
					// Send progress via WS (parallel channel)
					if (session.ws) {
						session.ws.send(JSON.stringify({
							type: 'message',
							channel: 'export.progress',
							payload: { rowCount },
						}))
					}
				})

				// Signal completion via WS
				if (session.ws) {
					session.ws.send(JSON.stringify({
						type: 'message',
						channel: 'export.complete',
						payload: { rowCount: result.rowCount },
					}))
				}

				controller.close()
			} catch (err: any) {
				// If the client disconnected, just close
				if (abortController.signal.aborted) {
					try {
						controller.close()
					} catch { /* already closed */ }
				} else {
					controller.error(err)
				}
			} finally {
				await releaseStream(session)
			}
		},
	})

	return new Response(stream, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="${filename}"`,
		},
	})
}

async function handleImportStream(req: Request, token: string): Promise<Response> {
	const entry = consumeStreamToken(token, 'import')
	if (!entry) {
		return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const { session, connectionId, database, params } = entry
	const importParams = params as ImportStreamParams

	let driver: DatabaseDriver
	try {
		driver = session.connectionManager.getDriver(connectionId, database)
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err?.message ?? 'Failed to get driver' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	if (!req.body) {
		return new Response(JSON.stringify({ error: 'Request body is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	session.activeStreams++

	const abortController = new AbortController()
	req.signal.addEventListener('abort', () => abortController.abort())

	try {
		const result = await importFromStream(driver, req.body, importParams, abortController.signal, (rowCount) => {
			// Send progress via WS (parallel channel)
			if (session.ws) {
				session.ws.send(JSON.stringify({
					type: 'message',
					channel: 'import.progress',
					payload: { rowCount },
				}))
			}
		})

		return new Response(JSON.stringify({ rowCount: result.rowCount }), {
			headers: { 'Content-Type': 'application/json' },
		})
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err?.message ?? 'Import failed' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		})
	} finally {
		await releaseStream(session)
	}
}

// ── Server ─────────────────────────────────────────────────

const server = Bun.serve<Session>({
	port: PORT,
	hostname: HOST,

	async fetch(req, server) {
		const url = new URL(req.url)

		// Upgrade WebSocket requests at /rpc
		if (url.pathname === '/rpc') {
			// Pass an empty data object; real session is created in open()
			if (server.upgrade(req, { data: {} as Session })) {
				return undefined as any
			}
			return new Response('WebSocket upgrade failed', { status: 400 })
		}

		// ── Stream endpoints ──────────────────────────────
		const exportMatch = url.pathname.match(/^\/api\/stream\/export\/([a-f0-9-]+)$/)
		if (exportMatch && req.method === 'GET') {
			return handleExportStream(req, exportMatch[1])
		}

		const importMatch = url.pathname.match(/^\/api\/stream\/import\/([a-f0-9-]+)$/)
		if (importMatch && req.method === 'POST') {
			return handleImportStream(req, importMatch[1])
		}

		// ── Menu action endpoint (Electron → frontend) ──
		if (url.pathname === '/api/menu-action' && req.method === 'POST') {
			try {
				const body = await req.json() as { action?: string }
				const action = body?.action
				if (!action) {
					return new Response(JSON.stringify({ error: 'Missing action' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					})
				}
				// Broadcast to all connected WebSocket sessions
				for (const [, session] of getSessions()) {
					if (session.ws) {
						session.ws.send(JSON.stringify({
							type: 'message',
							channel: 'menu.action',
							payload: { action },
						}))
					}
				}
				return new Response(JSON.stringify({ ok: true }), {
					headers: { 'Content-Type': 'application/json' },
				})
			} catch {
				return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				})
			}
		}

		// Static file serving from dist/
		let filePath = resolve(DIST_DIR, url.pathname.slice(1))

		// Try exact file first
		let file = Bun.file(filePath)
		if (await file.exists()) {
			return new Response(file)
		}

		// SPA fallback: serve index.html for non-file routes
		filePath = resolve(DIST_DIR, 'index.html')
		file = Bun.file(filePath)
		if (await file.exists()) {
			return new Response(file, {
				headers: { 'Content-Type': 'text/html' },
			})
		}

		return new Response('Not found', { status: 404 })
	},

	websocket: {
		open(ws) {
			const session = createSession(ws, ENCRYPTION_KEY!)
			// Replace the placeholder data with the real session
			Object.assign(ws.data, session)
		},
		async close(ws) {
			await maybeDestroySession(ws.data)
		},
		async message(ws, data) {
			let msg: any
			try {
				msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data))
			} catch {
				ws.send(JSON.stringify({ type: 'response', id: 0, success: false, error: 'Invalid JSON' }))
				return
			}

			if (msg.type === 'request') {
				// ── Web-specific stream token handlers ─────────
				if (msg.method === 'stream.createExportToken') {
					const { connectionId, database, ...exportParams } = msg.params
					const token = createStreamToken(ws.data, 'export', connectionId, database, exportParams)
					ws.send(JSON.stringify({ type: 'response', id: msg.id, success: true, payload: { token } }))
					return
				}

				if (msg.method === 'stream.createImportToken') {
					const { connectionId, database, ...importParams } = msg.params
					const token = createStreamToken(ws.data, 'import', connectionId, database, importParams)
					ws.send(JSON.stringify({ type: 'response', id: msg.id, success: true, payload: { token } }))
					return
				}

				const handler = (ws.data.handlers as any)[msg.method]
				if (!handler) {
					ws.send(JSON.stringify({
						type: 'response',
						id: msg.id,
						success: false,
						error: `Unknown method: ${msg.method}`,
					}))
					return
				}

				try {
					const result = await handler(msg.params)
					ws.send(JSON.stringify({
						type: 'response',
						id: msg.id,
						success: true,
						payload: result,
					}))
				} catch (err: any) {
					ws.send(JSON.stringify({
						type: 'response',
						id: msg.id,
						success: false,
						error: err?.message ?? String(err),
						errorCode: err instanceof DatabaseError ? err.code : undefined,
					}))
				}
			}
		},
	},
})

console.log(`Dotaz web server running at http://${HOST}:${server.port}`)
