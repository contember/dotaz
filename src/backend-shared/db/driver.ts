import type { SqlDialect } from '@dotaz/shared/sql/dialect'
import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import type { SchemaData } from '@dotaz/shared/types/database'
import type { QueryResult } from '@dotaz/shared/types/query'

export interface DatabaseDriver extends SqlDialect {
	// Lifecycle
	connect(config: ConnectionConfig): Promise<void>
	disconnect(): Promise<void>
	isConnected(): boolean

	// Session management
	reserveSession(sessionId: string): Promise<void>
	releaseSession(sessionId: string): Promise<void>
	getSessionIds(): string[]

	// Query execution
	execute(sql: string, params?: unknown[], sessionId?: string): Promise<QueryResult>
	cancel(sessionId?: string): Promise<void>

	// Streaming iteration — yields batches of rows from a query
	iterate(
		sql: string,
		params?: unknown[],
		batchSize?: number,
		signal?: AbortSignal,
		sessionId?: string,
	): AsyncIterable<Record<string, unknown>[]>

	// Bulk insert — inserts rows using multi-row VALUES, returns affected count
	importBatch(
		qualifiedTable: string,
		columns: string[],
		rows: Record<string, unknown>[],
		sessionId?: string,
	): Promise<number>

	// Schema introspection
	loadSchema(sessionId?: string): Promise<SchemaData>

	// Health check — always uses the pool, never routed through sessions
	ping(): Promise<void>

	// Transactions
	beginTransaction(sessionId?: string): Promise<void>
	commit(sessionId?: string): Promise<void>
	rollback(sessionId?: string): Promise<void>
	inTransaction(sessionId?: string): boolean
}
