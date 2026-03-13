import { parseErrorPosition, splitStatements } from '@dotaz/shared/sql/statements'
import { DatabaseError } from '@dotaz/shared/types/errors'
import type { ExplainNode, ExplainResult, QueryResult } from '@dotaz/shared/types/query'
import type { TransactionLogEntry, TransactionLogStatus } from '@dotaz/shared/types/rpc'
import type { DatabaseDriver } from '../db/driver'
import { withEphemeralSession } from '../db/ephemeral-session'
import type { AppDatabase } from '../storage/app-db'
import type { ConnectionManager } from './connection-manager'

// Re-export shared SQL utilities for backward compatibility
export type { GeneratedStatement, WhereClauseResult } from '@dotaz/shared/sql/builders'
export {
	buildCountQuery,
	buildOrderByClause,
	buildQuickSearchClause,
	buildSelectQuery,
	buildWhereClause,
	generateChangePreview,
	generateChangesPreview,
	generateChangeSql,
	generateDelete,
	generateInsert,
	generateUpdate,
} from '@dotaz/shared/sql/builders'
export { detectDestructiveWithoutWhere, offsetToLineColumn, parseErrorPosition, splitStatements } from '@dotaz/shared/sql/statements'

// ── Session Log ───────────────────────────────────────────

/** In-memory, per-connection session log of executed statements. Not persisted. */
export class SessionLog {
	/** Map from connectionId (or connectionId:database) to log entries. */
	private logs = new Map<string, TransactionLogEntry[]>()
	/** Track statement count since last BEGIN/COMMIT/ROLLBACK per connection. */
	private pendingCounts = new Map<string, number>()

	private key(connectionId: string, database?: string): string {
		return database ? `${connectionId}:${database}` : connectionId
	}

	private pendingKey(connectionId: string, database?: string, sessionId?: string): string {
		const base = this.key(connectionId, database)
		return sessionId ? `${base}:${sessionId}` : base
	}

	add(
		connectionId: string,
		sql: string,
		status: TransactionLogStatus,
		durationMs: number,
		rowCount: number,
		errorMessage?: string,
		database?: string,
		sessionId?: string,
	): void {
		const k = this.key(connectionId, database)
		if (!this.logs.has(k)) {
			this.logs.set(k, [])
		}
		this.logs.get(k)!.push({
			id: crypto.randomUUID(),
			sql,
			status,
			durationMs,
			rowCount,
			errorMessage,
			executedAt: new Date().toISOString(),
		})
		// Increment pending count (statements within an active transaction)
		const pk = this.pendingKey(connectionId, database, sessionId)
		this.pendingCounts.set(pk, (this.pendingCounts.get(pk) ?? 0) + 1)

		// Reset pending count on raw transaction-control statements
		const upper = sql.trim().toUpperCase()
		if (/^(COMMIT|END|ROLLBACK)\b/.test(upper) && !/^ROLLBACK\s+TO\b/.test(upper)) {
			this.resetPendingCount(connectionId, database, sessionId)
		} else if (/^(BEGIN|START\s+TRANSACTION)\b/.test(upper)) {
			this.resetPendingCount(connectionId, database, sessionId)
		}
	}

	getEntries(connectionId: string, database?: string): TransactionLogEntry[] {
		return this.logs.get(this.key(connectionId, database)) ?? []
	}

	getPendingCount(connectionId: string, database?: string, sessionId?: string): number {
		return this.pendingCounts.get(this.pendingKey(connectionId, database, sessionId)) ?? 0
	}

	/** Reset pending count (called on COMMIT/ROLLBACK). */
	resetPendingCount(connectionId: string, database?: string, sessionId?: string): void {
		this.pendingCounts.delete(this.pendingKey(connectionId, database, sessionId))
	}

	clear(connectionId: string, database?: string): void {
		const k = this.key(connectionId, database)
		this.logs.delete(k)
		this.pendingCounts.delete(k)
		// Also clean up session-scoped pending counts (e.g. ephemeral sessions)
		const prefix = `${k}:`
		for (const key of this.pendingCounts.keys()) {
			if (key.startsWith(prefix)) {
				this.pendingCounts.delete(key)
			}
		}
	}
}

// ── QueryExecutor ──────────────────────────────────────────

interface RunningQuery {
	queryId: string
	connectionId: string
	database?: string
	cancelled: boolean
	sessionId?: string
	poolQueryKey?: symbol
}

export class QueryExecutor {
	private connectionManager: ConnectionManager
	private runningQueries = new Map<string, RunningQuery>()
	private defaultTimeoutMs: number
	private appDb?: AppDatabase
	readonly sessionLog = new SessionLog()

	constructor(connectionManager: ConnectionManager, defaultTimeoutMs = 30_000, appDb?: AppDatabase) {
		this.connectionManager = connectionManager
		this.defaultTimeoutMs = defaultTimeoutMs
		this.appDb = appDb
	}

	/**
	 * Execute one or more SQL statements against a connection.
	 * Multi-statement SQL is split by semicolons and executed sequentially.
	 * Returns an array of results (one per statement).
	 */
	async executeQuery(
		connectionId: string,
		sql: string,
		params?: unknown[],
		timeoutMs?: number,
		queryId?: string,
		database?: string,
		sessionId?: string,
		searchPath?: string,
	): Promise<QueryResult[]> {
		const driver = this.connectionManager.getDriver(connectionId, database)
		const statements = splitStatements(sql)

		if (statements.length === 0) {
			return []
		}

		// Reject transaction-control statements without a session — running
		// BEGIN/COMMIT/ROLLBACK on the pool sends each to a different connection,
		// giving false transactional semantics and poisoning the pool.
		if (!sessionId && statements.length === 1) {
			const upper = statements[0].trim().toUpperCase()
			if (/^(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)\b/.test(upper) && !/^ROLLBACK\s+TO\b/.test(upper)) {
				return [{
					columns: [],
					rows: [],
					rowCount: 0,
					durationMs: 0,
					error: 'Transaction control statements (BEGIN, COMMIT, ROLLBACK) require a session. Open a session tab to use manual transactions.',
				}]
			}
		}

		const runWithSession = async (effectiveSessionId: string | undefined) => {
			const id = queryId ?? crypto.randomUUID()
			const entry: RunningQuery = { queryId: id, connectionId, database, cancelled: false, sessionId: effectiveSessionId }
			this.runningQueries.set(id, entry)

			const timeout = timeoutMs ?? this.defaultTimeoutMs
			const results: QueryResult[] = []

			let savedSearchPath: string | undefined
			try {
				// Set search_path if requested (save original for restore)
				if (searchPath && effectiveSessionId !== undefined) {
					const spResult = await driver.execute('SHOW search_path', undefined, effectiveSessionId)
					savedSearchPath = spResult.rows[0]?.['search_path'] as string | undefined
					const quotedSearchPath = quoteSearchPath(searchPath, driver)
					await driver.execute(`SET search_path TO ${quotedSearchPath}`, undefined, effectiveSessionId)
				}

				for (const stmt of statements) {
					if (entry.cancelled) {
						results.push(makeCancelledResult())
						break
					}

					const result = await this.executeSingle(
						driver,
						stmt,
						// Only pass params for the first (or only) statement
						statements.length === 1 ? params : undefined,
						timeout,
						entry,
						effectiveSessionId,
					)
					results.push(result)

					if (result.error) {
						break
					}
				}
			} finally {
				// Restore original search_path (re-quote to avoid interpolating raw SHOW output)
				if (savedSearchPath !== undefined && effectiveSessionId !== undefined) {
					try {
						const quotedRestore = quoteSearchPath(savedSearchPath, driver)
						await driver.execute(`SET search_path TO ${quotedRestore}`, undefined, effectiveSessionId)
					} catch { /* best effort */ }
				}
				this.runningQueries.delete(id)
				this.logHistory(connectionId, sql, results, database, sessionId)
			}

			return results
		}

		// Auto-reserve an ephemeral session for multi-statement batches
		// or when search_path needs to be set/restored on the same connection.
		if (!sessionId && (statements.length > 1 || searchPath)) {
			return withEphemeralSession(driver, runWithSession)
		}
		return runWithSession(sessionId)
	}

	/**
	 * Cancel a running query by its queryId.
	 */
	async cancelQuery(queryId: string): Promise<boolean> {
		const entry = this.runningQueries.get(queryId)
		if (!entry) {
			return false
		}

		entry.cancelled = true

		try {
			const driver = this.connectionManager.getDriver(entry.connectionId, entry.database)
			if (entry.sessionId !== undefined) {
				await driver.cancel(entry.sessionId)
			} else {
				await driver.cancel(undefined, entry.poolQueryKey)
			}
		} catch (err) {
			console.debug('Cancel query failed (driver may have completed):', err instanceof Error ? err.message : err)
		}

		return true
	}

	/**
	 * Cancel all running queries for a given connection.
	 * Used during session teardown to prevent orphaned queries.
	 */
	async cancelAllForConnection(connectionId: string): Promise<number> {
		const toCancel: string[] = []
		for (const [queryId, entry] of this.runningQueries) {
			if (entry.connectionId === connectionId) {
				toCancel.push(queryId)
			}
		}
		let cancelled = 0
		for (const queryId of toCancel) {
			if (await this.cancelQuery(queryId)) {
				cancelled++
			}
		}
		return cancelled
	}

	/**
	 * Get the list of currently running query IDs.
	 */
	getRunningQueryIds(): string[] {
		return [...this.runningQueries.keys()]
	}

	/**
	 * Run EXPLAIN on a SQL statement and return a parsed plan tree.
	 */
	async explainQuery(
		connectionId: string,
		sql: string,
		analyze: boolean,
		database?: string,
		sessionId?: string,
		searchPath?: string,
	): Promise<ExplainResult> {
		const driver = this.connectionManager.getDriver(connectionId, database)
		const driverType = driver.getDriverType()
		const start = performance.now()

		const runWithSession = async (effectiveSessionId: string | undefined): Promise<ExplainResult> => {
			let savedSearchPath: string | undefined

			try {
				// Set search_path if requested
				if (searchPath && effectiveSessionId !== undefined) {
					const spResult = await driver.execute('SHOW search_path', undefined, effectiveSessionId)
					savedSearchPath = spResult.rows[0]?.['search_path'] as string | undefined
					const quotedSearchPath = quoteSearchPath(searchPath, driver)
					await driver.execute(`SET search_path TO ${quotedSearchPath}`, undefined, effectiveSessionId)
				}
				if (driverType === 'sqlite') {
					const result = effectiveSessionId !== undefined
						? await driver.execute(`EXPLAIN QUERY PLAN ${sql}`, undefined, effectiveSessionId)
						: await driver.execute(`EXPLAIN QUERY PLAN ${sql}`)
					const durationMs = Math.round(performance.now() - start)
					const nodes = parseSqliteExplain(result.rows)
					const rawText = result.rows
						.map((r) => `${r.id}|${r.parent}|${r.notused ?? 0}|${r.detail}`)
						.join('\n')
					return { nodes, rawText, durationMs }
				}

				// PostgreSQL / MySQL — use JSON format
				const isMysql = driverType === 'mysql'
				const prefix = isMysql
					? (analyze ? 'EXPLAIN ANALYZE' : 'EXPLAIN FORMAT=JSON')
					: (analyze ? 'EXPLAIN (ANALYZE, FORMAT JSON)' : 'EXPLAIN (FORMAT JSON)')
				const result = effectiveSessionId !== undefined
					? await driver.execute(`${prefix} ${sql}`, undefined, effectiveSessionId)
					: await driver.execute(`${prefix} ${sql}`)
				const durationMs = Math.round(performance.now() - start)

				// PG returns a single row with a column named "QUERY PLAN";
				// MySQL EXPLAIN FORMAT=JSON returns "EXPLAIN" column;
				// MySQL EXPLAIN ANALYZE returns a text plan (no JSON).
				let plan: unknown
				let nodes: ExplainNode[]
				let rawText: string

				if (isMysql && analyze) {
					// MySQL EXPLAIN ANALYZE returns text rows, not JSON
					rawText = result.rows.map((r) => Object.values(r)[0]).join('\n')
					nodes = [{ operation: rawText, children: [] }]
					return { nodes, rawText, durationMs }
				}

				const jsonStr = result.rows[0]?.['QUERY PLAN']
					?? result.rows[0]?.EXPLAIN
					?? JSON.stringify(result.rows)
				plan = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
				const planArray = Array.isArray(plan) ? plan : [plan]
				nodes = planArray.map((p: Record<string, unknown>) => parsePostgresNode(p.Plan as Record<string, unknown> ?? p))

				// Build raw text — re-run only for non-ANALYZE (no side effects).
				// For ANALYZE, format the JSON result as text to avoid executing the query twice
				// (EXPLAIN ANALYZE on DML would double the side effects).
				if (analyze) {
					rawText = JSON.stringify(plan, null, 2)
				} else {
					try {
						const textPrefix = 'EXPLAIN'
						const textResult = effectiveSessionId !== undefined
							? await driver.execute(`${textPrefix} ${sql}`, undefined, effectiveSessionId)
							: await driver.execute(`${textPrefix} ${sql}`)
						rawText = textResult.rows
							.map((r) => Object.values(r)[0])
							.join('\n')
					} catch {
						rawText = JSON.stringify(plan, null, 2)
					}
				}

				return { nodes, rawText, durationMs }
			} catch (err) {
				const durationMs = Math.round(performance.now() - start)
				return {
					nodes: [],
					rawText: '',
					durationMs,
					error: err instanceof Error ? err.message : String(err),
				}
			} finally {
				if (savedSearchPath !== undefined && effectiveSessionId !== undefined) {
					try {
						const quotedRestore = quoteSearchPath(savedSearchPath, driver)
						await driver.execute(`SET search_path TO ${quotedRestore}`, undefined, effectiveSessionId)
					} catch { /* best effort */ }
				}
			}
		}

		// Reserve ephemeral session for search_path wrapping
		if (!sessionId && searchPath) {
			return withEphemeralSession(driver, runWithSession)
		}
		return runWithSession(sessionId)
	}

	private async executeSingle(
		driver: DatabaseDriver,
		sql: string,
		params: unknown[] | undefined,
		timeoutMs: number,
		entry: RunningQuery,
		sessionId?: string,
	): Promise<QueryResult> {
		const start = performance.now()
		const timeout = this.createTimeout(timeoutMs)
		const poolQueryKey = sessionId === undefined ? Symbol() : undefined
		entry.poolQueryKey = poolQueryKey

		try {
			const result = await Promise.race([
				sessionId !== undefined
					? driver.execute(sql, params, sessionId)
					: driver.execute(sql, params, undefined, poolQueryKey),
				timeout.promise,
			])

			if (entry.cancelled) {
				return makeCancelledResult(performance.now() - start)
			}

			return {
				...result,
				durationMs: Math.round(performance.now() - start),
			}
		} catch (err) {
			const durationMs = Math.round(performance.now() - start)

			// If timeout fired, cancel the still-running server-side query
			if (timeout.fired) {
				try {
					if (sessionId !== undefined) {
						await driver.cancel(sessionId)
					} else {
						await driver.cancel(undefined, poolQueryKey)
					}
				} catch { /* best effort */ }
			}

			if (entry.cancelled) {
				return makeCancelledResult(durationMs)
			}

			// If a COMMIT/END timed out or hit a connection error, the server may
			// have committed successfully — surface COMMIT_UNCERTAIN so the user
			// knows to verify data before retrying.
			if (timeout.fired) {
				const upper = sql.trim().toUpperCase()
				if (/^(COMMIT|END)\b/.test(upper)) {
					return {
						columns: [],
						rows: [],
						rowCount: 0,
						durationMs,
						errorCode: 'COMMIT_UNCERTAIN',
						error: 'Connection lost or timed out during COMMIT — the transaction may have been committed. Verify your data before retrying.',
					}
				}
				if (/^(INSERT|UPDATE|DELETE|MERGE)\b/.test(upper)) {
					return {
						columns: [],
						rows: [],
						rowCount: 0,
						durationMs,
						errorCode: 'STATEMENT_UNCERTAIN',
						error: 'Statement timed out but may have been executed by the server. Verify your data before retrying.',
					}
				}
			}

			const errorPosition = parseErrorPosition(err, sql)
			const errorCode = err instanceof DatabaseError ? err.code : undefined

			return {
				columns: [],
				rows: [],
				rowCount: 0,
				durationMs,
				error: err instanceof Error ? err.message : String(err),
				errorCode,
				errorPosition,
			}
		} finally {
			timeout.cancel()
		}
	}

	private createTimeout(ms: number): { promise: Promise<never>; cancel: () => void; fired: boolean } {
		let timer: ReturnType<typeof setTimeout>
		let fired = false
		const promise = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				fired = true
				reject(new Error(`Query timed out after ${ms}ms`))
			}, ms)
		})
		return { promise, cancel: () => clearTimeout(timer!), get fired() { return fired } }
	}

	private logHistory(connectionId: string, sql: string, results: QueryResult[], database?: string, sessionId?: string): void {
		const hasError = results.some((r) => r.error)
		const totalDuration = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0)
		const totalRows = results.reduce((sum, r) => sum + (r.affectedRows ?? r.rowCount), 0)
		const errorMessage = results.find((r) => r.error)?.error

		// Always add to session log (in-memory)
		this.sessionLog.add(
			connectionId,
			sql,
			hasError ? 'error' : 'success',
			Math.round(totalDuration),
			totalRows,
			errorMessage,
			database,
			sessionId,
		)

		if (!this.appDb) return

		try {
			this.appDb.addHistory({
				connectionId,
				database,
				sql,
				status: hasError ? 'error' : 'success',
				durationMs: Math.round(totalDuration),
				rowCount: totalRows,
				errorMessage,
			})
		} catch (err) {
			console.debug('History logging failed:', err instanceof Error ? err.message : err)
		}
	}
}

function makeCancelledResult(durationMs = 0): QueryResult {
	return {
		columns: [],
		rows: [],
		rowCount: 0,
		durationMs: Math.round(durationMs),
		error: 'Query was cancelled',
	}
}

// ── search_path helpers ─────────────────────────────────────

/**
 * Quote each schema name in a comma-separated search_path string.
 * Handles SHOW search_path output (e.g. `"$user", public`) by stripping
 * existing double-quotes before re-quoting with the driver's quoteIdentifier.
 */
function quoteSearchPath(raw: string, driver: DatabaseDriver): string {
	return raw.split(',').map((s) => {
		let name = s.trim()
		// Strip existing double-quotes (SHOW output may include them)
		if (name.startsWith('"') && name.endsWith('"')) {
			name = name.slice(1, -1).replace(/""/g, '"')
		}
		return driver.quoteIdentifier(name)
	}).join(', ')
}

// ── EXPLAIN parsers ──────────────────────────────────────────

function parsePostgresNode(plan: Record<string, unknown>): ExplainNode {
	const children = (plan.Plans as Record<string, unknown>[] | undefined) ?? []
	const { 'Node Type': _, 'Relation Name': __, 'Plans': ___, ...rest } = plan
	return {
		operation: String(plan['Node Type'] ?? 'Unknown'),
		relation: plan['Relation Name'] ? String(plan['Relation Name']) : undefined,
		cost: typeof plan['Total Cost'] === 'number' ? plan['Total Cost'] : undefined,
		actualTime: typeof plan['Actual Total Time'] === 'number' ? plan['Actual Total Time'] : undefined,
		estimatedRows: typeof plan['Plan Rows'] === 'number' ? plan['Plan Rows'] : undefined,
		actualRows: typeof plan['Actual Rows'] === 'number' ? plan['Actual Rows'] : undefined,
		extra: Object.keys(rest).length > 0 ? rest : undefined,
		children: children.map((c) => parsePostgresNode(c)),
	}
}

function parseSqliteExplain(rows: Record<string, unknown>[]): ExplainNode[] {
	// SQLite EXPLAIN QUERY PLAN returns: id, parent, notused, detail
	const nodeMap = new Map<number, ExplainNode>()
	const childMap = new Map<number, ExplainNode[]>()

	for (const row of rows) {
		const id = Number(row.id ?? row.selectid ?? 0)
		const parent = Number(row.parent ?? 0)
		const detail = String(row.detail ?? '')

		const node: ExplainNode = {
			operation: detail,
			children: [],
		}

		// Parse operation details like "SCAN users" or "SEARCH users USING INDEX ..."
		const scanMatch = detail.match(/^(SCAN|SEARCH|USE TEMP B-TREE)\s+(.*)/i)
		if (scanMatch) {
			node.operation = scanMatch[1]
			const tablePart = scanMatch[2]
			const tableMatch = tablePart.match(/^(\S+)/)
			if (tableMatch) {
				node.relation = tableMatch[1]
			}
		}

		nodeMap.set(id, node)
		if (!childMap.has(parent)) {
			childMap.set(parent, [])
		}
		childMap.get(parent)!.push(node)
	}

	// Attach children
	for (const [id, node] of nodeMap) {
		node.children = childMap.get(id) ?? []
	}

	// Return root nodes (parent = 0 or nodes whose parent doesn't exist in the map)
	return childMap.get(0) ?? [...nodeMap.values()].filter((_, i) => {
		const row = rows[i]
		const parent = Number(row?.parent ?? 0)
		return !nodeMap.has(parent)
	})
}
