import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import type { SchemaData } from '@dotaz/shared/types/database'
import type { QueryResult } from '@dotaz/shared/types/query'
import type { DatabaseDriver } from './driver'

/**
 * A DatabaseDriver wrapper that logs all SQL queries to the console.
 * Wrap any driver with this to enable debug logging:
 *
 *   new LoggingDriver(driver)
 *
 * Demo mode: activated via URL param ?debug_sql=1
 * Backend: activated via DEBUG_SQL=1 env var
 */
export class LoggingDriver implements DatabaseDriver {
	constructor(private inner: DatabaseDriver) {}

	private log(sql: string, params?: unknown[], durationMs?: number, error?: unknown): void {
		const trimmed = sql.replace(/\s+/g, ' ').trim()
		const hasParams = params && params.length > 0
		if (error) {
			console.debug(`[SQL ERROR] ${trimmed}${hasParams ? ` -- params: ${JSON.stringify(params)}` : ''} (${durationMs}ms)`, error)
		} else if (durationMs !== undefined) {
			console.debug(`[SQL] ${trimmed}${hasParams ? ` -- params: ${JSON.stringify(params)}` : ''} (${durationMs}ms)`)
		} else {
			console.debug(`[SQL] ${trimmed}${hasParams ? ` -- params: ${JSON.stringify(params)}` : ''}`)
		}
	}

	async execute(sql: string, params?: unknown[], sessionId?: string): Promise<QueryResult> {
		const start = performance.now()
		try {
			const result = await this.inner.execute(sql, params, sessionId)
			this.log(sql, params, Math.round(performance.now() - start))
			return result
		} catch (err) {
			this.log(sql, params, Math.round(performance.now() - start), err)
			throw err
		}
	}

	async *iterate(
		sql: string,
		params?: unknown[],
		batchSize?: number,
		signal?: AbortSignal,
		sessionId?: string,
	): AsyncIterable<Record<string, unknown>[]> {
		this.log(sql, params)
		yield* this.inner.iterate(sql, params, batchSize, signal, sessionId)
	}

	async importBatch(
		qualifiedTable: string,
		columns: string[],
		rows: Record<string, unknown>[],
		sessionId?: string,
	): Promise<number> {
		const sql = `INSERT INTO ${qualifiedTable} (${columns.join(', ')}) VALUES ... [${rows.length} rows]`
		const start = performance.now()
		try {
			const count = await this.inner.importBatch(qualifiedTable, columns, rows, sessionId)
			this.log(sql, undefined, Math.round(performance.now() - start))
			return count
		} catch (err) {
			this.log(sql, undefined, Math.round(performance.now() - start), err)
			throw err
		}
	}

	// Delegated methods
	connect(config: ConnectionConfig): Promise<void> {
		return this.inner.connect(config)
	}
	disconnect(): Promise<void> {
		return this.inner.disconnect()
	}
	isConnected(): boolean {
		return this.inner.isConnected()
	}
	reserveSession(sessionId: string): Promise<void> {
		return this.inner.reserveSession(sessionId)
	}
	releaseSession(sessionId: string): Promise<void> {
		return this.inner.releaseSession(sessionId)
	}
	getSessionIds(): string[] {
		return this.inner.getSessionIds()
	}
	cancel(sessionId?: string): Promise<void> {
		return this.inner.cancel(sessionId)
	}
	ping(): Promise<void> {
		return this.inner.ping()
	}
	loadSchema(sessionId?: string): Promise<SchemaData> {
		return this.inner.loadSchema(sessionId)
	}
	beginTransaction(sessionId?: string): Promise<void> {
		return this.inner.beginTransaction(sessionId)
	}
	commit(sessionId?: string): Promise<void> {
		return this.inner.commit(sessionId)
	}
	rollback(sessionId?: string): Promise<void> {
		return this.inner.rollback(sessionId)
	}
	inTransaction(sessionId?: string): boolean {
		return this.inner.inTransaction(sessionId)
	}
	isTxAborted(sessionId?: string): boolean {
		return this.inner.isTxAborted(sessionId)
	}
	isIterating(sessionId?: string): boolean {
		return this.inner.isIterating(sessionId)
	}
	getDriverType(): 'postgresql' | 'sqlite' | 'mysql' {
		return (this.inner as any).getDriverType()
	}
	quoteIdentifier(name: string): string {
		return this.inner.quoteIdentifier(name)
	}
	qualifyTable(schema: string, table: string): string {
		return this.inner.qualifyTable(schema, table)
	}
	emptyInsertSql(qualifiedTable: string): string {
		return this.inner.emptyInsertSql(qualifiedTable)
	}
	placeholder(index: number): string {
		return this.inner.placeholder(index)
	}
}
