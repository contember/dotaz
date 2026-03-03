import type { SessionInfo } from '../../shared/types/rpc'
import type { AppDatabase } from '../storage/app-db'
import { DEFAULT_SETTINGS } from '../storage/app-db'
import type { ConnectionManager } from './connection-manager'

export type { SessionInfo }

/**
 * Manages the lifecycle of pinned sessions — reserved database connections
 * that persist across multiple query executions.
 */
export class SessionManager {
	private cm: ConnectionManager
	private appDb: AppDatabase
	// connectionId → Map<sessionId, SessionInfo>
	private sessions = new Map<string, Map<string, SessionInfo>>()
	// Track label counters per connection for auto-naming
	private labelCounters = new Map<string, number>()

	constructor(cm: ConnectionManager, appDb: AppDatabase) {
		this.cm = cm
		this.appDb = appDb
	}

	async createSession(connectionId: string, database?: string): Promise<SessionInfo> {
		const maxSessions = this.appDb.getNumberSetting('maxSessionsPerConnection')
			?? Number(DEFAULT_SETTINGS.maxSessionsPerConnection)
		const connSessions = this.sessions.get(connectionId)
		const currentCount = connSessions?.size ?? 0

		if (maxSessions !== null && currentCount >= maxSessions) {
			throw new Error(
				`Maximum sessions per connection (${maxSessions}) reached. Destroy an existing session first.`,
			)
		}

		const sessionId = crypto.randomUUID()
		const driver = this.cm.getDriver(connectionId, database)
		await driver.reserveSession(sessionId)

		const counter = (this.labelCounters.get(connectionId) ?? 0) + 1
		this.labelCounters.set(connectionId, counter)

		const info: SessionInfo = {
			sessionId,
			connectionId,
			database,
			label: `Session ${counter}`,
			inTransaction: false,
			createdAt: Date.now(),
		}

		if (!this.sessions.has(connectionId)) {
			this.sessions.set(connectionId, new Map())
		}
		this.sessions.get(connectionId)!.set(sessionId, info)

		return info
	}

	async destroySession(sessionId: string): Promise<void> {
		const info = this.findSession(sessionId)
		if (!info) {
			throw new Error(`Session not found: ${sessionId}`)
		}

		const driver = this.cm.getDriver(info.connectionId, info.database)
		await driver.releaseSession(sessionId)

		const connSessions = this.sessions.get(info.connectionId)
		if (connSessions) {
			connSessions.delete(sessionId)
			if (connSessions.size === 0) {
				this.sessions.delete(info.connectionId)
			}
		}
	}

	listSessions(connectionId: string): SessionInfo[] {
		const connSessions = this.sessions.get(connectionId)
		if (!connSessions) return []

		const result: SessionInfo[] = []
		for (const info of connSessions.values()) {
			// Refresh inTransaction state from driver
			try {
				const driver = this.cm.getDriver(info.connectionId, info.database)
				info.inTransaction = driver.inTransaction(info.sessionId)
			} catch {
				// Driver may be disconnected — keep last known state
			}
			result.push({ ...info })
		}
		return result
	}

	getSession(sessionId: string): SessionInfo | undefined {
		const info = this.findSession(sessionId)
		if (!info) return undefined

		// Refresh inTransaction state from driver
		try {
			const driver = this.cm.getDriver(info.connectionId, info.database)
			info.inTransaction = driver.inTransaction(info.sessionId)
		} catch {
			// Driver may be disconnected — keep last known state
		}
		return { ...info }
	}

	handleConnectionLost(connectionId: string): void {
		this.sessions.delete(connectionId)
	}

	private findSession(sessionId: string): SessionInfo | undefined {
		for (const connSessions of this.sessions.values()) {
			const info = connSessions.get(sessionId)
			if (info) return info
		}
		return undefined
	}
}
