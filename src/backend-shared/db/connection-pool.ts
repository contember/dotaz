import { SQL } from 'bun'

/** How long an idle connection is kept before being closed (ms). */
const IDLE_TIMEOUT_MS = 30_000

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

	constructor(
		private readonly url: string,
		private readonly resetFn?: (conn: SQL) => Promise<void>,
	) {}

	/** Create the system connection and verify connectivity. */
	async connect(): Promise<void> {
		this.systemConn = this.createSql()
		this.connections.add(this.systemConn)
		await this.systemConn.unsafe('SELECT 1')
	}

	/** The persistent system connection for ping, schema loading, ad-hoc queries. */
	getSystemConnection(): SQL {
		if (!this.systemConn) {
			throw new Error('ConnectionPool is not connected')
		}
		return this.systemConn
	}

	/** Create a new dedicated connection for pinned sessions. */
	createConnection(): SQL {
		const conn = this.createSql()
		this.connections.add(conn)
		return conn
	}

	/**
	 * Acquire a connection for temporary use (iterate, default tx).
	 * Reuses an idle connection if available, otherwise creates a new one.
	 */
	acquireConnection(): SQL {
		if (this.idleConn) {
			const conn = this.idleConn
			this.idleConn = null
			this.clearIdleTimer()
			return conn
		}
		return this.createConnection()
	}

	/**
	 * Release a temporarily acquired connection.
	 * Keeps one idle for reuse, destroys the rest.
	 */
	async releaseConnection(conn: SQL): Promise<void> {
		if (!this.idleConn) {
			if (this.resetFn) {
				try {
					await this.resetFn(conn)
				} catch {
					await this.destroyConnection(conn)
					return
				}
			}
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
		this.connections.delete(conn)
		try {
			await conn.close()
		} catch {
			// already dead
		}
	}

	/** Replace a dead system connection with a fresh one. */
	async reconnectSystemConnection(): Promise<void> {
		if (this.systemConn) {
			this.connections.delete(this.systemConn)
			try { await this.systemConn.close() } catch { /* already dead */ }
		}
		this.systemConn = this.createSql()
		this.connections.add(this.systemConn)
		await this.systemConn.unsafe('SELECT 1')
	}

	/** Close everything — system conn + all tracked connections. */
	async disconnectAll(): Promise<void> {
		this.clearIdleTimer()
		this.idleConn = null
		const all = [...this.connections]
		this.connections.clear()
		this.systemConn = null
		await Promise.allSettled(all.map(conn => conn.close()))
	}

	private createSql(): SQL {
		return new SQL({ url: this.url, max: 1 })
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
