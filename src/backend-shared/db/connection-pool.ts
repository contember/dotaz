import { SQL } from 'bun'

/** How long an idle connection is kept before being closed (ms). */
const IDLE_TIMEOUT_MS = 30_000

export type PoolConnectionRole = 'system' | 'idle' | 'leased'

export interface PoolConnectionSnapshot {
	handleId: string
	role: PoolConnectionRole
	createdAt: number
	lastUsedAt: number
}

interface PoolConnectionMeta extends PoolConnectionSnapshot {}

/**
 * Manages database connections as individual SQL({max:1}) instances.
 * Each instance = exactly 1 TCP connection, created lazily on first query.
 *
 * Avoids Bun's built-in pool which opens all `max` connections at once.
 */
export class ConnectionPool {
	private systemConn: SQL | null = null
	/** Idle connection available for temporary use (iterate, default tx). */
	private idleConn: SQL | null = null
	private idleTimer: ReturnType<typeof setTimeout> | null = null
	private connections = new Set<SQL>()
	private metadata = new Map<SQL, PoolConnectionMeta>()
	private nextHandleNumber = 1

	constructor(
		private readonly url: string,
		private readonly resetFn?: (conn: SQL) => Promise<void>,
		/**
		 * Optional session-setup callback run after every physical connection is
		 * established (and re-applied after `resetFn` on release). Lets callers
		 * re-establish session state that DISCARD ALL would otherwise wipe.
		 */
		private readonly initFn?: (conn: SQL) => Promise<void>,
	) {}

	/** Create the system connection and verify connectivity. */
	async connect(): Promise<void> {
		this.systemConn = this.createSql('system')
		this.connections.add(this.systemConn)
		await this.systemConn.unsafe('SELECT 1')
		if (this.initFn) await this.initFn(this.systemConn)
	}

	/** The persistent system connection for ping, schema loading, ad-hoc queries. */
	getSystemConnection(): SQL {
		if (!this.systemConn) {
			throw new Error('ConnectionPool is not connected')
		}
		this.markUsed(this.systemConn)
		return this.systemConn
	}

	/** Create a new dedicated connection for pinned sessions. */
	async createConnection(): Promise<SQL> {
		const conn = this.createSql('leased')
		this.connections.add(conn)
		// Establish the (lazy) connection and apply session setup before first use.
		if (this.initFn) {
			try {
				await this.initFn(conn)
			} catch (err) {
				await this.destroyConnection(conn)
				throw err
			}
		}
		return conn
	}

	/**
	 * Acquire a connection for temporary use (iterate, default tx).
	 * Reuses an idle connection if available, otherwise creates a new one.
	 */
	async acquireConnection(): Promise<SQL> {
		if (this.idleConn) {
			// Idle connections were already initialized on release.
			const conn = this.idleConn
			this.idleConn = null
			this.clearIdleTimer()
			this.setRole(conn, 'leased')
			this.markUsed(conn)
			return conn
		}
		return this.createConnection()
	}

	/**
	 * Release a temporarily acquired connection.
	 * Keeps one idle for reuse, destroys the rest.
	 */
	async releaseConnection(conn: SQL): Promise<void> {
		if (!this.connections.has(conn)) {
			try {
				await conn.close()
			} catch { /* already dead */ }
			return
		}
		if (!this.idleConn) {
			if (this.resetFn || this.initFn) {
				try {
					// Reset leaked state, then re-establish session setup.
					if (this.resetFn) await this.resetFn(conn)
					if (this.initFn) await this.initFn(conn)
				} catch {
					await this.destroyConnection(conn)
					return
				}
			}
			this.setRole(conn, 'idle')
			this.markUsed(conn)
			this.idleConn = conn
			this.scheduleIdleTimeout()
		} else {
			await this.destroyConnection(conn)
		}
	}

	/** Close and remove a dedicated connection. */
	async destroyConnection(conn: SQL): Promise<void> {
		if (this.idleConn === conn) {
			this.idleConn = null
			this.clearIdleTimer()
		}
		if (this.systemConn === conn) {
			this.systemConn = null
		}
		this.connections.delete(conn)
		this.metadata.delete(conn)
		try {
			await conn.close()
		} catch {
			// already dead
		}
	}

	/** Replace a dead system connection with a fresh one. */
	async reconnectSystemConnection(): Promise<void> {
		if (this.systemConn) {
			await this.destroyConnection(this.systemConn)
		}
		// Build into a local first; only publish as systemConn once it is fully
		// initialized, so a failed init never leaves a live but un-setup connection
		// that would silently serve unscoped data.
		const conn = this.createSql('system')
		this.connections.add(conn)
		try {
			await conn.unsafe('SELECT 1')
			if (this.initFn) await this.initFn(conn)
		} catch (err) {
			await this.destroyConnection(conn)
			throw err
		}
		this.systemConn = conn
	}

	/** Close everything — system conn + all tracked connections. */
	async disconnectAll(): Promise<void> {
		this.clearIdleTimer()
		this.idleConn = null
		const all = [...this.connections]
		this.connections.clear()
		this.metadata.clear()
		this.systemConn = null
		await Promise.allSettled(all.map(conn => conn.close()))
	}

	getConnectionId(conn: SQL): string | undefined {
		return this.metadata.get(conn)?.handleId
	}

	snapshot(): PoolConnectionSnapshot[] {
		return [...this.connections]
			.map((conn) => this.metadata.get(conn))
			.filter((meta): meta is PoolConnectionMeta => meta !== undefined)
			.map((meta) => ({ ...meta }))
	}

	async terminateConnection(handleId: string): Promise<boolean> {
		const conn = this.findConnectionByHandleId(handleId)
		if (!conn) return false
		if (conn === this.systemConn) {
			await this.reconnectSystemConnection()
			return true
		}
		await this.destroyConnection(conn)
		return true
	}

	private createSql(role: PoolConnectionRole): SQL {
		const conn = new SQL({ url: this.url, max: 1 })
		const now = Date.now()
		this.metadata.set(conn, {
			handleId: `pool-${this.nextHandleNumber}`,
			role,
			createdAt: now,
			lastUsedAt: now,
		})
		this.nextHandleNumber += 1
		return conn
	}

	private findConnectionByHandleId(handleId: string): SQL | undefined {
		for (const conn of this.connections) {
			if (this.metadata.get(conn)?.handleId === handleId) {
				return conn
			}
		}
		return undefined
	}

	private markUsed(conn: SQL): void {
		const meta = this.metadata.get(conn)
		if (!meta) return
		meta.lastUsedAt = Date.now()
	}

	private setRole(conn: SQL, role: PoolConnectionRole): void {
		const meta = this.metadata.get(conn)
		if (!meta) return
		meta.role = role
	}

	private scheduleIdleTimeout(): void {
		this.clearIdleTimer()
		this.idleTimer = setTimeout(() => {
			if (this.idleConn) {
				this.destroyConnection(this.idleConn)
			}
		}, IDLE_TIMEOUT_MS)
	}

	private clearIdleTimer(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer)
			this.idleTimer = null
		}
	}
}
