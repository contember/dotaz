import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import type { RpcAdapter } from '@dotaz/backend-shared/rpc/adapter'
import { buildSchemaContext, generateSql } from '@dotaz/backend-shared/services/ai-sql'
import { buildExportSelectQuery, exportPreview as generateExportPreview, exportToStream } from '@dotaz/backend-shared/services/export-service'
import type { ExportWriter } from '@dotaz/backend-shared/services/export-service'
import { importFromStream, importPreviewFromStream } from '@dotaz/backend-shared/services/import-service'
import { searchDatabase } from '@dotaz/backend-shared/services/search-service'
import { formatSql } from '@dotaz/backend-shared/services/sql-formatter'
import { splitStatements } from '@dotaz/shared/sql/statements'
import type { ConnectionConfig, ConnectionInfo } from '@dotaz/shared/types/connection'
import type { DatabaseInfo } from '@dotaz/shared/types/database'
import type { ExportOptions, ExportPreviewRequest, ExportRawPreviewRequest, ExportRawPreviewResponse, ExportResult } from '@dotaz/shared/types/export'
import type { ImportOptions, ImportPreviewRequest, ImportPreviewResult, ImportResult } from '@dotaz/shared/types/import'
import type { ExplainNode, ExplainResult, QueryHistoryEntry, QueryHistoryStatus, QueryResult } from '@dotaz/shared/types/query'
import type {
	AiGenerateSqlParams,
	AiGenerateSqlResult,
	HistoryListParams,
	QueryBookmark,
	SavedView,
	SavedViewConfig,
	SearchDatabaseParams,
	SearchDatabaseResult,
	SessionInfo,
	TransactionLogEntry,
	TransactionLogParams,
	TransactionLogResult,
} from '@dotaz/shared/types/rpc'
import { settingsToAiConfig } from '@dotaz/shared/types/settings'
import type { DemoAppState } from './demo-state'
type EmitMessage = (channel: string, payload: any) => void

export class DemoAdapter implements RpcAdapter {
	private connectedSet = new Set<string>()
	private sessionLogEntries: TransactionLogEntry[] = []
	private pendingCount = 0

	constructor(
		private driver: DatabaseDriver,
		private state: DemoAppState,
		private emitMessage: EmitMessage,
	) {}

	private getConnectedDriver(connectionId: string): DatabaseDriver {
		if (!this.connectedSet.has(connectionId)) {
			throw new Error(`Connection ${connectionId} is not connected`)
		}
		return this.driver
	}

	getDriver(connectionId: string, _database?: string): DatabaseDriver {
		return this.getConnectedDriver(connectionId)
	}

	// ── Connections ────────────────────────────────────────

	listConnections(): ConnectionInfo[] {
		return this.state.listConnections()
	}

	createConnection(params: { name: string; config: ConnectionConfig; readOnly?: boolean; groupName?: string }): ConnectionInfo {
		return this.state.createConnection(params)
	}

	updateConnection(params: { id: string; name: string; config: ConnectionConfig; readOnly?: boolean; groupName?: string }): ConnectionInfo {
		return this.state.updateConnection(params)
	}

	setConnectionReadOnly(id: string, readOnly: boolean): ConnectionInfo {
		return this.state.setConnectionReadOnly(id, readOnly)
	}

	setConnectionGroup(id: string, groupName: string | null): ConnectionInfo {
		return this.state.setConnectionGroup(id, groupName)
	}

	listConnectionGroups(): string[] {
		return this.state.listConnectionGroups()
	}

	renameConnectionGroup(oldName: string, newName: string): void {
		this.state.renameConnectionGroup(oldName, newName)
	}

	deleteConnectionGroup(groupName: string): void {
		this.state.deleteConnectionGroup(groupName)
	}

	deleteConnection(id: string): void {
		this.state.deleteConnection(id)
		this.connectedSet.delete(id)
	}

	async testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string }> {
		if (config.type === 'sqlite') {
			return { success: true }
		}
		return { success: false, error: 'Only SQLite connections are supported in demo mode' }
	}

	async connect(connectionId: string, _password?: string, _encryptedConfig?: string, _name?: string): Promise<void> {
		const conn = this.state.getConnectionById(connectionId)
		if (!conn) throw new Error(`Connection not found: ${connectionId}`)

		this.emitMessage('connections.statusChanged', {
			connectionId,
			state: 'connecting',
		})

		this.connectedSet.add(connectionId)

		this.emitMessage('connections.statusChanged', {
			connectionId,
			state: 'connected',
		})
	}

	async disconnect(connectionId: string): Promise<void> {
		this.connectedSet.delete(connectionId)
		this.emitMessage('connections.statusChanged', {
			connectionId,
			state: 'disconnected',
		})
	}

	// ── Sessions (no-op in demo — single WASM connection) ──

	async createSession(connectionId: string, _database?: string): Promise<SessionInfo> {
		return {
			sessionId: crypto.randomUUID(),
			connectionId,
			label: 'Session 1',
			inTransaction: false,
			txAborted: false,
			createdAt: Date.now(),
		}
	}

	async destroySession(_sessionId: string): Promise<void> {
		// No-op
	}

	listSessions(_connectionId: string): SessionInfo[] {
		return []
	}

	// ── Driver access (RpcAdapter interface) ─────────────

	// ── Multi-database (not available in demo) ────────────

	async listDatabases(): Promise<DatabaseInfo[]> {
		return []
	}

	async activateDatabase(): Promise<void> {
		throw new Error('Multi-database is not available in demo mode')
	}

	async deactivateDatabase(): Promise<void> {
		throw new Error('Multi-database is not available in demo mode')
	}

	// ── Query execution ───────────────────────────────────

	async executeQuery(connectionId: string, sql: string, params?: unknown[]): Promise<QueryResult[]> {
		const d = this.getConnectedDriver(connectionId)
		const statements = splitStatements(sql)

		if (statements.length === 0) {
			return []
		}

		const results: QueryResult[] = []

		for (const stmt of statements) {
			const start = performance.now()
			try {
				const result = await d.execute(
					stmt,
					statements.length === 1 ? params : undefined,
				)
				results.push({
					...result,
					durationMs: Math.round(performance.now() - start),
				})
			} catch (err) {
				results.push({
					columns: [],
					rows: [],
					rowCount: 0,
					durationMs: Math.round(performance.now() - start),
					error: err instanceof Error ? err.message : String(err),
				})
				break
			}
		}

		this.logHistory(connectionId, sql, results)
		return results
	}

	async executeStatements(connectionId: string, statements: { sql: string; params?: unknown[] }[]): Promise<QueryResult[]> {
		const d = this.getConnectedDriver(connectionId)
		const inExistingTx = d.inTransaction()
		if (!inExistingTx) {
			await d.beginTransaction()
		}
		try {
			const results: QueryResult[] = []
			for (const stmt of statements) {
				const start = performance.now()
				const result = await d.execute(stmt.sql, stmt.params)
				results.push({ ...result, durationMs: Math.round(performance.now() - start) })
			}
			if (!inExistingTx) {
				await d.commit()
			}
			return results
		} catch (err) {
			if (!inExistingTx) {
				try {
					await d.rollback()
				} catch { /* don't mask original error */ }
			}
			throw err
		}
	}

	async cancelQuery(): Promise<void> {
		// WASM SQLite operations are synchronous; cancellation is a no-op
	}

	async explainQuery(connectionId: string, sql: string, _analyze: boolean): Promise<ExplainResult> {
		const d = this.getConnectedDriver(connectionId)
		const start = performance.now()
		try {
			const result = await d.execute(`EXPLAIN QUERY PLAN ${sql}`)
			const durationMs = Math.round(performance.now() - start)
			const nodes = parseSqliteExplain(result.rows)
			const rawText = result.rows
				.map((r) => `${r.id}|${r.parent}|${r.notused ?? 0}|${r.detail}`)
				.join('\n')
			return { nodes, rawText, durationMs }
		} catch (err) {
			return {
				nodes: [],
				rawText: '',
				durationMs: Math.round(performance.now() - start),
				error: err instanceof Error ? err.message : String(err),
			}
		}
	}

	// ── Transactions ──────────────────────────────────────

	async beginTransaction(connectionId: string): Promise<void> {
		const d = this.getConnectedDriver(connectionId)
		if (d.inTransaction()) {
			throw new Error('Transaction already active')
		}
		await d.beginTransaction()
	}

	async commitTransaction(connectionId: string): Promise<void> {
		const d = this.getConnectedDriver(connectionId)
		if (!d.inTransaction()) {
			throw new Error('No active transaction')
		}
		await d.commit()
		this.pendingCount = 0
	}

	async rollbackTransaction(connectionId: string): Promise<void> {
		const d = this.getConnectedDriver(connectionId)
		if (!d.inTransaction()) {
			throw new Error('No active transaction')
		}
		await d.rollback()
		this.pendingCount = 0
	}

	// ── Transaction Log ──────────────────────────────────

	getTransactionLog(params: TransactionLogParams): TransactionLogResult {
		let entries = [...this.sessionLogEntries]
		if (params.statusFilter) {
			entries = entries.filter((e) => e.status === params.statusFilter)
		}
		if (params.search) {
			const term = params.search.toLowerCase()
			entries = entries.filter((e) => e.sql.toLowerCase().includes(term))
		}
		const inTransaction = this.driver.inTransaction()
		return {
			entries,
			pendingStatementCount: inTransaction ? this.pendingCount : 0,
			inTransaction,
		}
	}

	clearTransactionLog(): void {
		this.sessionLogEntries = []
		this.pendingCount = 0
	}

	// ── History ───────────────────────────────────────────

	listHistory(params: HistoryListParams): QueryHistoryEntry[] {
		return this.state.listHistory(params)
	}

	clearHistory(connectionId?: string): void {
		this.state.clearHistory(connectionId)
	}

	// ── Saved Views ──────────────────────────────────────

	listSavedViews(connectionId: string, schemaName: string, tableName: string): SavedView[] {
		return this.state.listSavedViews(connectionId, schemaName, tableName)
	}

	createSavedView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): SavedView {
		return this.state.createSavedView(params)
	}

	updateSavedView(params: { id: string; name: string; config: SavedViewConfig }): SavedView {
		return this.state.updateSavedView(params)
	}

	deleteSavedView(id: string): void {
		this.state.deleteSavedView(id)
	}

	listSavedViewsByConnection(connectionId: string): SavedView[] {
		return this.state.listSavedViewsByConnection(connectionId)
	}

	getSavedViewById(id: string): SavedView | null {
		return this.state.getSavedViewById(id)
	}

	// ── Bookmarks ────────────────────────────────────────

	listBookmarks(connectionId: string, search?: string): QueryBookmark[] {
		return this.state.listBookmarks(connectionId, search)
	}

	createBookmark(params: { connectionId: string; database?: string; name: string; description?: string; sql: string }): QueryBookmark {
		return this.state.createBookmark(params)
	}

	updateBookmark(params: { id: string; name: string; description?: string; sql: string }): QueryBookmark {
		return this.state.updateBookmark(params)
	}

	deleteBookmark(id: string): void {
		this.state.deleteBookmark(id)
	}

	// ── Search ────────────────────────────────────────────

	async searchDatabase(params: SearchDatabaseParams): Promise<SearchDatabaseResult> {
		const d = this.getConnectedDriver(params.connectionId)
		return searchDatabase(
			d,
			{
				searchTerm: params.searchTerm,
				scope: params.scope,
				schemaName: params.schemaName,
				tableNames: params.tableNames,
				resultsPerTable: params.resultsPerTable ?? 50,
			},
			() => {},
			() => false,
		)
	}

	// ── Export ────────────────────────────────────────────

	async exportData(opts: ExportOptions): Promise<ExportResult> {
		const d = this.getConnectedDriver(opts.connectionId)
		const chunks: (string | Uint8Array)[] = []
		const writer: ExportWriter = {
			write(chunk) {
				chunks.push(chunk)
			},
			async end() {},
		}

		const onProgress = (rowCount: number) => {
			this.emitMessage('export.progress', { rowCount })
		}

		const result = await exportToStream(
			d,
			{
				schema: opts.schema,
				table: opts.table,
				format: opts.format,
				columns: opts.columns,
				includeHeaders: opts.includeHeaders,
				delimiter: opts.delimiter,
				encoding: opts.encoding,
				utf8Bom: opts.utf8Bom,
				batchSize: opts.batchSize,
				filters: opts.filters,
				sort: opts.sort,
				limit: opts.limit,
				autoJoins: opts.autoJoins,
			},
			writer,
			undefined,
			onProgress,
		)

		// Build blob and trigger browser download
		const mimeTypes: Record<string, string> = {
			csv: 'text/csv',
			json: 'application/json',
			sql: 'text/sql',
			markdown: 'text/markdown',
			html: 'text/html',
			xml: 'application/xml',
		}
		const blob = new Blob(chunks as BlobPart[], { type: mimeTypes[opts.format] ?? 'text/plain' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = opts.filePath || `export.${opts.format}`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)

		return {
			rowCount: result.rowCount,
			sizeBytes: blob.size,
		}
	}

	async exportPreview(req: ExportPreviewRequest): Promise<string> {
		const d = this.getConnectedDriver(req.connectionId)
		return generateExportPreview(d, {
			schema: req.schema,
			table: req.table,
			format: req.format,
			columns: req.columns,
			delimiter: req.delimiter,
			filters: req.filters,
			sort: req.sort,
			limit: req.limit,
			autoJoins: req.autoJoins,
		})
	}

	async exportPreviewRows(req: ExportRawPreviewRequest): Promise<ExportRawPreviewResponse> {
		const d = this.getConnectedDriver(req.connectionId)
		const { sql: baseSql, params: queryParams } = buildExportSelectQuery(
			{ schema: req.schema, table: req.table, format: 'csv', columns: req.columns, filters: req.filters, sort: req.sort, autoJoins: req.autoJoins },
			d,
		)
		const paramIndex = queryParams.length + 1
		const sql = `${baseSql} LIMIT ${d.placeholder(paramIndex)}`
		const result = await d.execute(sql, [...queryParams, req.limit])
		const rows = result.rows
		const columns = rows.length > 0 ? Object.keys(rows[0]) : (req.columns ?? [])
		return { rows, columns }
	}

	// ── Import ────────────────────────────────────────────

	async importData(opts: ImportOptions): Promise<ImportResult> {
		const d = this.getConnectedDriver(opts.connectionId)
		const stream = this.stringToStream(opts.fileContent ?? '')
		const onProgress = (rowCount: number) => {
			this.emitMessage('import.progress', { rowCount })
		}
		return importFromStream(
			d,
			stream,
			{
				schema: opts.schema,
				table: opts.table,
				format: opts.format,
				delimiter: opts.delimiter,
				hasHeader: opts.hasHeader,
				mappings: opts.mappings,
				batchSize: opts.batchSize,
			},
			undefined,
			onProgress,
		)
	}

	async importPreview(req: ImportPreviewRequest): Promise<ImportPreviewResult> {
		const stream = this.stringToStream(req.fileContent ?? '')
		return importPreviewFromStream(stream, {
			format: req.format,
			delimiter: req.delimiter,
			hasHeader: req.hasHeader,
			limit: req.limit,
		})
	}

	private stringToStream(content: string): ReadableStream<Uint8Array> {
		return new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(content))
				controller.close()
			},
		})
	}

	// ── Settings ─────────────────────────────────────────

	getAllSettings(): Record<string, string> {
		return this.state.getAllSettings()
	}

	setSetting(key: string, value: string): void {
		this.state.setSetting(key, value)
	}

	// ── SQL formatting ───────────────────────────────────

	formatSql(sql: string): string {
		return formatSql(sql)
	}

	// ── AI SQL generation ────────────────────────────────

	async generateSql(params: AiGenerateSqlParams): Promise<AiGenerateSqlResult> {
		const d = this.getConnectedDriver(params.connectionId)
		const schema = await d.loadSchema()
		const schemaContext = buildSchemaContext(schema)
		const aiConfig = settingsToAiConfig(this.state.getAllSettings())
		const sql = await generateSql(aiConfig, {
			prompt: params.prompt,
			schemaContext,
			dialect: 'sqlite',
		})
		return { sql }
	}

	// ── Workspace persistence ─────────────────────────────

	saveWorkspace(_data: string): void {
		// Demo mode is ephemeral — no workspace persistence
	}

	loadWorkspace(): string | null {
		return null
	}

	// ── Demo ──────────────────────────────────────────────

	async initializeDemo(): Promise<ConnectionInfo> {
		// Demo mode already has the bookstore connection
		const connections = this.state.listConnections()
		if (connections.length > 0) return connections[0]
		throw new Error('Demo connection not found')
	}

	// ── Private ──────────────────────────────────────────

	private logHistory(connectionId: string, sql: string, results: QueryResult[]): void {
		const hasError = results.some((r) => r.error)
		const totalDuration = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0)
		const totalRows = results.reduce((sum, r) => sum + (r.affectedRows ?? r.rowCount), 0)
		const errorMessage = results.find((r) => r.error)?.error

		// Add to session log (in-memory)
		this.sessionLogEntries.push({
			id: crypto.randomUUID(),
			sql,
			status: hasError ? 'error' : 'success',
			durationMs: Math.round(totalDuration),
			rowCount: totalRows,
			errorMessage,
			executedAt: new Date().toISOString(),
		})
		this.pendingCount++

		try {
			this.state.addHistory({
				connectionId,
				sql,
				status: (hasError ? 'error' : 'success') as QueryHistoryStatus,
				durationMs: Math.round(totalDuration),
				rowCount: totalRows,
				errorMessage,
			})
		} catch {
			// Don't let history logging break query execution
		}
	}
}

function parseSqliteExplain(rows: Record<string, unknown>[]): ExplainNode[] {
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

		const scanMatch = detail.match(/^(SCAN|SEARCH|USE TEMP B-TREE)\s+(.*)/i)
		if (scanMatch) {
			node.operation = scanMatch[1]
			const tableMatch = scanMatch[2].match(/^(\S+)/)
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

	for (const [id, node] of nodeMap) {
		node.children = childMap.get(id) ?? []
	}

	return childMap.get(0) ?? [...nodeMap.values()].filter((_, i) => {
		const row = rows[i]
		const parent = Number(row?.parent ?? 0)
		return !nodeMap.has(parent)
	})
}
