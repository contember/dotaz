import type { SessionInfo } from '@dotaz/shared/types/rpc'
import type { AppDatabase } from '../storage/app-db'
import { DEFAULT_SETTINGS } from '../storage/app-db'
import type { ConnectionManager } from './connection-manager'

export type { SessionInfo }

const IDLE_CHECK_INTERVAL_MS = 30_000
const DEFAULT_TX_KEY = '__default_tx__'

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
	// Saved session metadata for restoration after reconnect
	private pendingRestore = new Map<string, Array<{ database?: string; label: string }>>()
	// Track when we first observed a session with an active transaction
	private txFirstSeen = new Map<string, number>()
	private idleCheckTimer: ReturnType<typeof setInterval> | null = null
	private idleCheckRunning = false
	private onTransactionRollback?: (connectionId: string, database?: string, sessionId?: string) => void

	constructor(cm: ConnectionManager, appDb: AppDatabase, onTransactionRollback?: (connectionId: string, database?: string, sessionId?: string) => void) {
		this.cm = cm
		this.appDb = appDb
		this.onTransactionRollback = onTransactionRollback
		this.startIdleTransactionCheck()
	}

	dispose(): void {
		this.stopIdleTransactionCheck()
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
		try { await driver.cancel(sessionId) } catch { /* best effort */ }
		await driver.releaseSession(sessionId)

		this.txFirstSeen.delete(sessionId)

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
		const connSessions = this.sessions.get(connectionId)
		if (connSessions) {
			for (const sessionId of connSessions.keys()) {
				this.txFirstSeen.delete(sessionId)
			}
			if (connSessions.size > 0) {
				this.pendingRestore.set(
					connectionId,
					Array.from(connSessions.values()).map((s) => ({ database: s.database, label: s.label })),
				)
			}
		}
		// Clean up all default tx keys for this connection (any database)
		const prefix = `${DEFAULT_TX_KEY}:${connectionId}:`
		for (const key of this.txFirstSeen.keys()) {
			if (key.startsWith(prefix)) {
				this.txFirstSeen.delete(key)
			}
		}
		this.sessions.delete(connectionId)
	}

	async handleConnectionRestored(connectionId: string): Promise<SessionInfo[]> {
		const specs = this.pendingRestore.get(connectionId)
		this.pendingRestore.delete(connectionId)
		if (!specs || specs.length === 0) return []

		const restored: SessionInfo[] = []
		for (const spec of specs) {
			let reserved = false
			let sessionId: string | undefined
			let driver: ReturnType<typeof this.cm.getDriver> | undefined
			try {
				driver = this.cm.getDriver(connectionId, spec.database)
				sessionId = crypto.randomUUID()
				await driver.reserveSession(sessionId)
				reserved = true

				const info: SessionInfo = {
					sessionId,
					connectionId,
					database: spec.database,
					label: spec.label,
					inTransaction: false,
					createdAt: Date.now(),
				}

				if (!this.sessions.has(connectionId)) {
					this.sessions.set(connectionId, new Map())
				}
				this.sessions.get(connectionId)!.set(sessionId, info)
				restored.push(info)
			} catch {
				// Session restoration is best-effort — skip on failure
				if (reserved && driver && sessionId) {
					try { await driver.releaseSession(sessionId) } catch {}
				}
			}
		}

		// Update label counter to max restored label number to avoid duplicates
		let maxLabel = this.labelCounters.get(connectionId) ?? 0
		for (const info of restored) {
			const match = info.label.match(/^Session (\d+)$/)
			if (match) {
				maxLabel = Math.max(maxLabel, Number(match[1]))
			}
		}
		this.labelCounters.set(connectionId, maxLabel)

		return restored
	}

	private startIdleTransactionCheck(): void {
		this.idleCheckTimer = setInterval(() => {
			this.checkIdleTransactions()
		}, IDLE_CHECK_INTERVAL_MS)
	}

	private stopIdleTransactionCheck(): void {
		if (this.idleCheckTimer) {
			clearInterval(this.idleCheckTimer)
			this.idleCheckTimer = null
		}
	}

	private async checkIdleTransactions(): Promise<void> {
		if (this.idleCheckRunning) return
		this.idleCheckRunning = true
		try {
			const timeoutMs = this.appDb.getNumberSetting('idleTransactionTimeoutMs')
				?? Number(DEFAULT_SETTINGS.idleTransactionTimeoutMs)
			if (!timeoutMs || timeoutMs <= 0) return

			const now = Date.now()

			for (const [, connSessions] of this.sessions) {
				for (const [sessionId, info] of connSessions) {
					let inTx = false
					let iterating = false
					try {
						const driver = this.cm.getDriver(info.connectionId, info.database)
						inTx = driver.inTransaction(sessionId)
						iterating = driver.isIterating(sessionId)
					} catch {
						this.txFirstSeen.delete(sessionId)
						continue
					}

					// Skip sessions that are actively iterating — rollback would fail
					if (iterating) continue

					if (inTx) {
						if (!this.txFirstSeen.has(sessionId)) {
							this.txFirstSeen.set(sessionId, now)
						} else {
							const elapsed = now - this.txFirstSeen.get(sessionId)!
							if (elapsed >= timeoutMs) {
								try {
									const driver = this.cm.getDriver(info.connectionId, info.database)
									await driver.rollback(sessionId)
								} catch { /* best effort */ }
								try {
									this.onTransactionRollback?.(info.connectionId, info.database, sessionId)
								} catch { /* best effort */ }
								this.txFirstSeen.delete(sessionId)
							}
						}
					} else {
						this.txFirstSeen.delete(sessionId)
					}
				}
			}

			// Also check default (sessionless) transactions on each connected driver
			// Iterate all active databases to catch non-default database transactions
			for (const conn of this.cm.listConnections()) {
				if (conn.state !== 'connected') continue
				const databases = this.cm.getActiveDatabases(conn.id)
				for (const database of databases) {
					const key = `${DEFAULT_TX_KEY}:${conn.id}:${database}`
					let inTx = false
					let iterating = false
					try {
						const driver = this.cm.getDriver(conn.id, database)
						inTx = driver.inTransaction()
						iterating = driver.isIterating()
					} catch {
						this.txFirstSeen.delete(key)
						continue
					}

					// Skip if actively iterating — rollback would fail
					if (iterating) continue

					if (inTx) {
						if (!this.txFirstSeen.has(key)) {
							this.txFirstSeen.set(key, now)
						} else {
							const elapsed = now - this.txFirstSeen.get(key)!
							if (elapsed >= timeoutMs) {
								try {
									const driver = this.cm.getDriver(conn.id, database)
									await driver.rollback()
								} catch { /* best effort */ }
								try {
									this.onTransactionRollback?.(conn.id, database)
								} catch { /* best effort */ }
								this.txFirstSeen.delete(key)
							}
						}
					} else {
						this.txFirstSeen.delete(key)
					}
				}
			}
		} finally {
			this.idleCheckRunning = false
		}
	}

	private findSession(sessionId: string): SessionInfo | undefined {
		for (const connSessions of this.sessions.values()) {
			const info = connSessions.get(sessionId)
			if (info) return info
		}
		return undefined
	}
}
