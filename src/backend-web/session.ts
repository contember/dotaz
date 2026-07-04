// Session management and token registry for the web server
// Extracted from server.ts for testability

import type { createHandlers as createSharedHandlers } from '@dotaz/backend-shared/rpc/handlers'
import { createHandlers } from '@dotaz/backend-shared/rpc/rpc-handlers'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { EncryptionService } from '@dotaz/backend-shared/services/encryption'
import type { ExportParams } from '@dotaz/backend-shared/services/export-service'
import type { ImportStreamParams } from '@dotaz/backend-shared/services/import-service'
import { QueryExecutor } from '@dotaz/backend-shared/services/query-executor'
import type { SessionManager } from '@dotaz/backend-shared/services/session-manager'
import { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import { stripSecrets } from '@dotaz/shared/types/connection'
import type { ConnectionInfo } from '@dotaz/shared/types/connection'
import { ENV_CONNECTION_ID, parseEnvConnection } from './env-connection'

export const SESSION_TTL_MS = 5 * 60 * 1000 // 5 minutes
export const TOKEN_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes

// ── Session management ─────────────────────────────────────

export interface Session {
	id: string
	appDb: AppDatabase
	connectionManager: ConnectionManager
	queryExecutor: QueryExecutor
	handlers: ReturnType<typeof createSharedHandlers>
	sessionManager: SessionManager
	serverManagedIds: Set<string>
	unsubscribe: () => void
	ws: { send(data: string): void } | null
	activeStreams: number
	disconnectedAt: number | null
	ttlTimer: ReturnType<typeof setTimeout> | null
}

const sessions = new Map<string, Session>()

// Databases the user toggled on (Manage Databases…) for the DATABASE_URL
// connection, remembered across sessions. Each session gets a fresh in-memory
// app DB and the env connection is recreated from DATABASE_URL on every
// WebSocket, so without this the extra databases vanish on page reload.
// Process-scoped: shared by all sessions of the single shared env connection,
// and reset when the server restarts.
const envActiveDatabases = new Set<string>()

function exposeConnection(conn: ConnectionInfo, serverManagedIds: Set<string>): ConnectionInfo {
	if (!serverManagedIds.has(conn.id)) return conn
	return { ...conn, config: stripSecrets(conn.config), serverManaged: true }
}

export function getSessions(): Map<string, Session> {
	return sessions
}

export function createSession(
	ws: { send(data: string): void },
	encryptionKey: string,
): Session {
	const id = crypto.randomUUID()
	const appDb = AppDatabase.create(':memory:')
	const connectionManager = new ConnectionManager(appDb)
	const queryExecutor = new QueryExecutor(connectionManager, undefined, appDb)
	const encryption = new EncryptionService(encryptionKey)

	const emitMessage = (channel: string, payload: unknown) => {
		if (session.ws) {
			session.ws.send(JSON.stringify({ type: 'message', channel, payload }))
		}
	}

	const { handlers, sessionManager } = createHandlers(connectionManager, queryExecutor, appDb, undefined, {
		encryption,
		emitMessage,
		allowServerFileAccess: false,
	})

	const serverManagedIds = new Set<string>()
	const envConnection = parseEnvConnection()

	// Auto-create env connection if DATABASE_URL is set
	if (envConnection) {
		// Restore databases toggled on in an earlier session so they survive a
		// page reload — the fire-and-forget auto-connect below reconnects them.
		const config = envActiveDatabases.size > 0
			? { ...envConnection.config, activeDatabases: [...envActiveDatabases] }
			: envConnection.config
		appDb.createConnectionWithId(ENV_CONNECTION_ID, {
			name: envConnection.name,
			config,
		})
		serverManagedIds.add(ENV_CONNECTION_ID)

		// Wrap connections.list to add serverManaged flag
		const originalList = handlers['connections.list']
		;(handlers as Record<string, unknown>)['connections.list'] = () => {
			const list = originalList()
			return list.map(conn => exposeConnection(conn, serverManagedIds))
		}

		// Remember activate/deactivate on the env connection across sessions so a
		// reload restores the same set of databases (see envActiveDatabases).
		const originalActivate = handlers['databases.activate']
		;(handlers as Record<string, unknown>)['databases.activate'] = async (params: { connectionId: string; database: string }) => {
			const result = await originalActivate(params)
			if (params.connectionId === ENV_CONNECTION_ID) envActiveDatabases.add(params.database)
			return result
		}
		const originalDeactivate = handlers['databases.deactivate']
		;(handlers as Record<string, unknown>)['databases.deactivate'] = async (params: { connectionId: string; database: string }) => {
			const result = await originalDeactivate(params)
			if (params.connectionId === ENV_CONNECTION_ID) envActiveDatabases.delete(params.database)
			return result
		}
	}

	const unsubSessionDead = connectionManager.onSessionDead((event) => {
		sessionManager.handleSessionDead(event.sessionId)
		if (session.ws) {
			session.ws.send(JSON.stringify({
				type: 'message',
				channel: 'session.changed',
				payload: {
					connectionId: event.connectionId,
					sessions: sessionManager.listSessions(event.connectionId),
				},
			}))
		}
	})

	const unsubscribe = connectionManager.onStatusChanged(async (event) => {
		if (session.ws) {
			session.ws.send(JSON.stringify({
				type: 'message',
				channel: 'connections.statusChanged',
				payload: {
					connectionId: event.connectionId,
					state: event.state,
					error: event.error,
					errorCode: event.errorCode,
					transactionLost: event.transactionLost,
				},
			}))
		}

		// Clean up sessions on disconnect/error and notify frontend
		if (event.state === 'disconnected' || event.state === 'error') {
			sessionManager.handleConnectionLost(event.connectionId)
			if (session.ws) {
				session.ws.send(JSON.stringify({
					type: 'message',
					channel: 'session.changed',
					payload: { connectionId: event.connectionId, sessions: [] },
				}))
			}
		}

		// Restore sessions after successful reconnect
		if (event.state === 'connected') {
			try {
				const restored = await sessionManager.handleConnectionRestored(event.connectionId)
				if (restored.length > 0 && session.ws) {
					session.ws.send(JSON.stringify({
						type: 'message',
						channel: 'session.changed',
						payload: { connectionId: event.connectionId, sessions: restored },
					}))
				}
			} catch (err) {
				console.warn('Session restoration failed:', err instanceof Error ? err.message : err)
			}
		}
	})

	const session: Session = {
		id,
		appDb,
		connectionManager,
		queryExecutor,
		handlers,
		sessionManager,
		serverManagedIds,
		unsubscribe: () => {
			unsubSessionDead()
			unsubscribe()
		},
		ws,
		activeStreams: 0,
		disconnectedAt: null,
		ttlTimer: null,
	}
	sessions.set(id, session)

	// Fire-and-forget auto-connect for env connection
	if (envConnection) {
		connectionManager.connect(ENV_CONNECTION_ID).catch((err) => {
			console.warn('DATABASE_URL auto-connect failed:', err?.message ?? err)
		})
	}

	return session
}

export async function destroySession(session: Session): Promise<void> {
	sessions.delete(session.id)
	if (session.ttlTimer) {
		clearTimeout(session.ttlTimer)
		session.ttlTimer = null
	}
	session.unsubscribe()
	session.sessionManager.dispose()
	for (const queryId of session.queryExecutor.getRunningQueryIds()) {
		await session.queryExecutor.cancelQuery(queryId)
	}
	await session.connectionManager.disconnectAll()
	session.appDb.close()
}

/** Delayed session cleanup: only destroy if no active streams reference it. */
export async function maybeDestroySession(session: Session): Promise<void> {
	session.ws = null
	session.disconnectedAt = Date.now()
	if (session.activeStreams === 0) {
		await destroySession(session)
	} else {
		session.ttlTimer = setTimeout(async () => {
			if (sessions.has(session.id)) {
				await destroySession(session)
			}
		}, SESSION_TTL_MS)
	}
}

export async function releaseStream(session: Session): Promise<void> {
	session.activeStreams--
	if (session.ws === null && session.activeStreams === 0) {
		await destroySession(session)
	}
}

// ── Token registry ─────────────────────────────────────────

export interface StreamToken {
	session: Session
	connectionId: string
	database?: string
	params: ExportParams | ImportStreamParams
	type: 'export' | 'import'
	createdAt: number
}

const streamTokens = new Map<string, StreamToken>()

export function getStreamTokens(): Map<string, StreamToken> {
	return streamTokens
}

export function createStreamToken(
	session: Session,
	type: 'export' | 'import',
	connectionId: string,
	database: string | undefined,
	params: ExportParams | ImportStreamParams,
): string {
	const token = crypto.randomUUID()
	streamTokens.set(token, { session, connectionId, database, params, type, createdAt: Date.now() })
	return token
}

export function consumeStreamToken(token: string, expectedType: 'export' | 'import'): StreamToken | null {
	const entry = streamTokens.get(token)
	if (!entry) return null
	if (entry.type !== expectedType) return null
	if (Date.now() - entry.createdAt > TOKEN_EXPIRY_MS) {
		streamTokens.delete(token)
		return null
	}
	streamTokens.delete(token) // One-time use
	return entry
}

export function cleanupExpiredTokens(): void {
	const now = Date.now()
	for (const [token, entry] of streamTokens) {
		if (now - entry.createdAt > TOKEN_EXPIRY_MS) {
			streamTokens.delete(token)
		}
	}
}
