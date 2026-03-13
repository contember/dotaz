import type { ConnectionConfig, ConnectionInfo } from '@dotaz/shared/types/connection'
import type { DatabaseInfo } from '@dotaz/shared/types/database'
import type { ExportOptions, ExportPreviewRequest, ExportRawPreviewRequest, ExportRawPreviewResponse, ExportResult } from '@dotaz/shared/types/export'
import type { ImportOptions, ImportPreviewRequest, ImportPreviewResult, ImportResult } from '@dotaz/shared/types/import'
import type { ExplainResult, QueryHistoryEntry, QueryResult } from '@dotaz/shared/types/query'
import type {
	AiGenerateSqlParams,
	AiGenerateSqlResult,
	HistoryListParams,
	OpenDialogParams,
	SaveDialogParams,
	SavedView,
	SavedViewConfig,
	SearchDatabaseParams,
	SearchDatabaseResult,
	SessionInfo,
	TransactionLogParams,
	TransactionLogResult,
} from '@dotaz/shared/types/rpc'
import { settingsToAiConfig } from '@dotaz/shared/types/settings'
import type { DatabaseDriver } from '../db/driver'
import { buildSchemaContext, generateSql } from '../services/ai-sql'
import type { ConnectionManager } from '../services/connection-manager'
import type { EncryptionService } from '../services/encryption'
import { buildExportSelectQuery, exportPreview, exportToFile } from '../services/export-service'
import { importFromStream, importPreviewFromStream } from '../services/import-service'
import type { QueryExecutor } from '../services/query-executor'
import { searchDatabase } from '../services/search-service'
import type { SessionManager } from '../services/session-manager'
import { formatSql } from '../services/sql-formatter'
import { TransactionManager } from '../services/transaction-manager'
import type { AppDatabase } from '../storage/app-db'
import type { RpcAdapter } from './adapter'

export type EmitMessage = (channel: string, payload: unknown) => void

export interface BackendAdapterOptions {
	encryption?: EncryptionService
	Utils?: typeof import('electrobun/bun').Utils
	emitMessage?: EmitMessage
	sessionManager?: SessionManager
	demoDbSourcePath?: string
	demoDbTargetPath?: string
}

export class BackendAdapter implements RpcAdapter {
	private txManager: TransactionManager
	private encryption?: EncryptionService
	private Utils?: typeof import('electrobun/bun').Utils
	private emitMessage?: EmitMessage
	private sessionManager?: SessionManager
	private demoDbSourcePath?: string
	private demoDbTargetPath?: string

	constructor(
		private cm: ConnectionManager,
		private queryExecutor: QueryExecutor,
		private appDb: AppDatabase,
		opts?: BackendAdapterOptions,
	) {
		this.txManager = new TransactionManager(cm)
		this.encryption = opts?.encryption
		this.Utils = opts?.Utils
		this.emitMessage = opts?.emitMessage
		this.sessionManager = opts?.sessionManager
		this.demoDbSourcePath = opts?.demoDbSourcePath
		this.demoDbTargetPath = opts?.demoDbTargetPath
	}

	// ── Connections ────────────────────────────────────────

	listConnections(): ConnectionInfo[] {
		return this.cm.listConnections()
	}

	createConnection(params: { name: string; config: ConnectionConfig; readOnly?: boolean; color?: string; groupName?: string }): ConnectionInfo {
		return this.cm.createConnection(params)
	}

	updateConnection(
		params: { id: string; name: string; config: ConnectionConfig; readOnly?: boolean; color?: string; groupName?: string },
	): ConnectionInfo {
		return this.cm.updateConnection(params)
	}

	setConnectionReadOnly(id: string, readOnly: boolean): ConnectionInfo {
		return this.cm.setConnectionReadOnly(id, readOnly)
	}

	setConnectionGroup(id: string, groupName: string | null): ConnectionInfo {
		return this.appDb.setConnectionGroup(id, groupName)
	}

	listConnectionGroups(): string[] {
		return this.appDb.listConnectionGroups()
	}

	renameConnectionGroup(oldName: string, newName: string): void {
		this.appDb.renameConnectionGroup(oldName, newName)
	}

	deleteConnectionGroup(groupName: string): void {
		this.appDb.deleteConnectionGroup(groupName)
	}

	async deleteConnection(id: string): Promise<void> {
		await this.cm.deleteConnection(id)
	}

	async testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string }> {
		return this.cm.testConnection(config)
	}

	async connect(connectionId: string, password?: string, encryptedConfig?: string, name?: string): Promise<void> {
		if (encryptedConfig && this.encryption) {
			// Web mode: decrypt config, register in session's in-memory app-db
			const configJson = await this.encryption.decrypt(encryptedConfig)
			const config = JSON.parse(configJson) as ConnectionConfig
			const existing = this.appDb.getConnectionById(connectionId)
			if (!existing) {
				this.appDb.createConnectionWithId(connectionId, { name: name ?? connectionId, config })
			} else {
				this.appDb.updateConnection({ id: connectionId, name: name ?? existing.name, config })
			}
		}
		await this.cm.connect(connectionId, password ? { password } : undefined)
	}

	async disconnect(connectionId: string): Promise<void> {
		await this.cm.disconnect(connectionId)
	}

	// ── Sessions ──────────────────────────────────────────

	async createSession(connectionId: string, database?: string): Promise<SessionInfo> {
		if (!this.sessionManager) throw new Error('SessionManager not available')
		const info = await this.sessionManager.createSession(connectionId, database)
		this.emitMessage?.('session.changed', { connectionId, sessions: this.sessionManager.listSessions(connectionId) })
		return info
	}

	async destroySession(sessionId: string): Promise<void> {
		if (!this.sessionManager) throw new Error('SessionManager not available')
		const info = this.sessionManager.getSession(sessionId)
		await this.sessionManager.destroySession(sessionId)
		if (info) {
			this.emitMessage?.('session.changed', { connectionId: info.connectionId, sessions: this.sessionManager.listSessions(info.connectionId) })
		}
	}

	listSessions(connectionId: string): SessionInfo[] {
		if (!this.sessionManager) return []
		return this.sessionManager.listSessions(connectionId)
	}

	// ── Driver access ─────────────────────────────────────

	getDriver(connectionId: string, database?: string): DatabaseDriver {
		return this.cm.getDriver(connectionId, database)
	}

	// ── Multi-database ────────────────────────────────────

	async listDatabases(connectionId: string): Promise<DatabaseInfo[]> {
		return this.cm.listDatabases(connectionId)
	}

	async activateDatabase(connectionId: string, database: string): Promise<void> {
		await this.cm.activateDatabase(connectionId, database)
	}

	async deactivateDatabase(connectionId: string, database: string): Promise<void> {
		if (this.sessionManager) {
			await this.sessionManager.destroySessionsForDatabase(connectionId, database)
			this.emitMessage?.('session.changed', { connectionId, sessions: this.sessionManager.listSessions(connectionId) })
		}
		await this.cm.deactivateDatabase(connectionId, database)
	}

	// ── Query execution ───────────────────────────────────

	async executeQuery(
		connectionId: string,
		sql: string,
		params?: unknown[],
		queryId?: string,
		database?: string,
		sessionId?: string,
		searchPath?: string,
	): Promise<QueryResult[]> {
		return this.queryExecutor.executeQuery(connectionId, sql, params, undefined, queryId, database, sessionId, searchPath)
	}

	async executeStatements(
		connectionId: string,
		statements: { sql: string; params?: unknown[] }[],
		database?: string,
		sessionId?: string,
	): Promise<QueryResult[]> {
		const driver = this.cm.getDriver(connectionId, database)

		// Reserve ephemeral session for isolation when no sessionId provided,
		// avoiding races on the shared __default__ singleton.
		let ephemeralSessionId: string | undefined
		if (!sessionId) {
			ephemeralSessionId = `__ephemeral_${crypto.randomUUID()}`
			await driver.reserveSession(ephemeralSessionId)
		}
		const effectiveSessionId = sessionId ?? ephemeralSessionId!

		const inExistingTx = driver.inTransaction(effectiveSessionId)
		try {
			if (!inExistingTx) {
				await driver.beginTransaction(effectiveSessionId)
			}
			const results: QueryResult[] = []
			for (const stmt of statements) {
				const start = performance.now()
				try {
					const result = await driver.execute(stmt.sql, stmt.params, effectiveSessionId)
					const durationMs = Math.round(performance.now() - start)
					results.push({ ...result, durationMs })
					this.queryExecutor.sessionLog.add(
						connectionId,
						stmt.sql,
						result.error ? 'error' : 'success',
						durationMs,
						result.affectedRows ?? result.rowCount,
						result.error,
						database,
						sessionId,
					)
				} catch (err) {
					const durationMs = Math.round(performance.now() - start)
					this.queryExecutor.sessionLog.add(
						connectionId,
						stmt.sql,
						'error',
						durationMs,
						0,
						err instanceof Error ? err.message : String(err),
						database,
						sessionId,
					)
					throw err
				}
			}
			if (!inExistingTx) {
				await driver.commit(effectiveSessionId)
			}
			return results
		} catch (err) {
			if (!inExistingTx) {
				try {
					await driver.rollback(effectiveSessionId)
				} catch (rbErr) {
					console.debug('Rollback after error failed:', rbErr instanceof Error ? rbErr.message : rbErr)
				}
			}
			throw err
		} finally {
			if (ephemeralSessionId) {
				try { await driver.cancel(ephemeralSessionId) } catch { /* best effort */ }
				try { await driver.releaseSession(ephemeralSessionId) } catch { /* best effort */ }
			}
		}
	}

	async cancelQuery(queryId: string): Promise<void> {
		await this.queryExecutor.cancelQuery(queryId)
	}

	async explainQuery(
		connectionId: string,
		sql: string,
		analyze: boolean,
		database?: string,
		sessionId?: string,
		searchPath?: string,
	): Promise<ExplainResult> {
		return this.queryExecutor.explainQuery(connectionId, sql, analyze, database, sessionId, searchPath)
	}

	// ── Transactions ──────────────────────────────────────

	async beginTransaction(connectionId: string, database?: string, sessionId?: string): Promise<void> {
		await this.txManager.begin(connectionId, database, sessionId)
		this.queryExecutor.sessionLog.resetPendingCount(connectionId, database, sessionId)
	}

	async commitTransaction(connectionId: string, database?: string, sessionId?: string): Promise<void> {
		await this.txManager.commit(connectionId, database, sessionId)
		this.queryExecutor.sessionLog.resetPendingCount(connectionId, database, sessionId)
	}

	async rollbackTransaction(connectionId: string, database?: string, sessionId?: string): Promise<void> {
		await this.txManager.rollback(connectionId, database, sessionId)
		this.queryExecutor.sessionLog.resetPendingCount(connectionId, database, sessionId)
	}

	// ── Transaction Log ──────────────────────────────────

	getTransactionLog(params: TransactionLogParams): TransactionLogResult {
		let entries = this.queryExecutor.sessionLog.getEntries(params.connectionId, params.database)

		if (params.statusFilter) {
			entries = entries.filter((e) => e.status === params.statusFilter)
		}
		if (params.search) {
			const term = params.search.toLowerCase()
			entries = entries.filter((e) => e.sql.toLowerCase().includes(term))
		}

		const inTransaction = this.txManager.isActive(params.connectionId, params.database, params.sessionId)
		const pendingStatementCount = inTransaction
			? this.queryExecutor.sessionLog.getPendingCount(params.connectionId, params.database, params.sessionId)
			: 0

		return { entries, pendingStatementCount, inTransaction }
	}

	clearTransactionLog(connectionId: string, database?: string, _sessionId?: string): void {
		this.queryExecutor.sessionLog.clear(connectionId, database)
	}

	// ── History ───────────────────────────────────────────

	listHistory(params: HistoryListParams): QueryHistoryEntry[] {
		return this.appDb.listHistory(params)
	}

	clearHistory(connectionId?: string): void {
		this.appDb.clearHistory(connectionId)
	}

	// ── Saved Views ──────────────────────────────────────

	listSavedViews(connectionId: string, schemaName: string, tableName: string): SavedView[] {
		return this.appDb.listSavedViews(connectionId, schemaName, tableName)
	}

	createSavedView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): SavedView {
		return this.appDb.createSavedView(params)
	}

	updateSavedView(params: { id: string; name: string; config: SavedViewConfig }): SavedView {
		return this.appDb.updateSavedView(params)
	}

	deleteSavedView(id: string): void {
		this.appDb.deleteSavedView(id)
	}

	listSavedViewsByConnection(connectionId: string): SavedView[] {
		return this.appDb.listSavedViewsByConnection(connectionId)
	}

	getSavedViewById(id: string): SavedView | null {
		return this.appDb.getSavedViewById(id)
	}

	// ── Bookmarks ────────────────────────────────────────

	listBookmarks(connectionId: string, search?: string) {
		return this.appDb.listBookmarks(connectionId, search)
	}

	createBookmark(params: { connectionId: string; database?: string; name: string; description?: string; sql: string }) {
		return this.appDb.createBookmark(params)
	}

	updateBookmark(params: { id: string; name: string; description?: string; sql: string }) {
		return this.appDb.updateBookmark(params)
	}

	deleteBookmark(id: string) {
		this.appDb.deleteBookmark(id)
	}

	// ── Search ────────────────────────────────────────────

	async searchDatabase(params: SearchDatabaseParams): Promise<SearchDatabaseResult> {
		const driver = this.cm.getDriver(params.connectionId, params.database)
		return searchDatabase(
			driver,
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
		const driver = this.cm.getDriver(opts.connectionId, opts.database)
		if (!opts.filePath) throw new Error('Export requires a file path')
		const onProgress = this.emitMessage
			? (rowCount: number) => this.emitMessage!('export.progress', { rowCount })
			: undefined
		const result = await exportToFile(
			driver,
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
			opts.filePath,
			undefined,
			onProgress,
		)
		return { ...result, filePath: opts.filePath }
	}

	async exportPreview(req: ExportPreviewRequest): Promise<string> {
		const driver = this.cm.getDriver(req.connectionId, req.database)
		return exportPreview(driver, {
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
		const driver = this.cm.getDriver(req.connectionId, req.database)
		const { sql: baseSql, params: queryParams } = buildExportSelectQuery(
			{ schema: req.schema, table: req.table, format: 'csv', columns: req.columns, filters: req.filters, sort: req.sort, autoJoins: req.autoJoins },
			driver,
		)
		const paramIndex = queryParams.length + 1
		const sql = `${baseSql} LIMIT ${driver.placeholder(paramIndex)}`
		const result = await driver.execute(sql, [...queryParams, req.limit])
		const rows = result.rows
		const columns = rows.length > 0 ? Object.keys(rows[0]) : (req.columns ?? [])
		return { rows, columns }
	}

	// ── Import ────────────────────────────────────────────

	async importData(opts: ImportOptions): Promise<ImportResult> {
		const driver = this.cm.getDriver(opts.connectionId, opts.database)
		const stream = this.resolveImportStream(opts.filePath, opts.fileContent)
		const onProgress = this.emitMessage
			? (rowCount: number) => this.emitMessage!('import.progress', { rowCount })
			: undefined
		return importFromStream(
			driver,
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
		const stream = this.resolveImportPreviewStream(req.filePath, req.fileContent)
		const result = await importPreviewFromStream(stream, {
			format: req.format,
			delimiter: req.delimiter,
			hasHeader: req.hasHeader,
			limit: req.limit,
		})
		if (req.filePath) {
			try {
				const file = Bun.file(req.filePath)
				result.fileSizeBytes = file.size
			} catch { /* ignore */ }
		}
		return result
	}

	private resolveImportStream(filePath?: string, fileContent?: string): ReadableStream<Uint8Array> {
		if (filePath) {
			return Bun.file(filePath).stream() as unknown as ReadableStream<Uint8Array>
		}
		if (fileContent !== undefined) {
			return new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(fileContent))
					controller.close()
				},
			})
		}
		throw new Error('Import requires either filePath or fileContent')
	}

	private resolveImportPreviewStream(filePath?: string, fileContent?: string): ReadableStream<Uint8Array> {
		if (filePath) {
			// Read first 64KB from file for preview
			const file = Bun.file(filePath)
			const fullStream = file.stream() as unknown as ReadableStream<Uint8Array>
			const reader = fullStream.getReader()
			const PREVIEW_BYTES = 64 * 1024
			let bytesRead = 0
			return new ReadableStream<Uint8Array>({
				async pull(controller) {
					const { done, value } = await reader.read()
					if (done) {
						controller.close()
						return
					}
					bytesRead += value.byteLength
					if (bytesRead >= PREVIEW_BYTES) {
						// Enqueue what we have and close
						controller.enqueue(value)
						controller.close()
						reader.releaseLock()
						return
					}
					controller.enqueue(value)
				},
				cancel() {
					reader.releaseLock()
				},
			})
		}
		if (fileContent !== undefined) {
			return new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(fileContent))
					controller.close()
				},
			})
		}
		throw new Error('Import preview requires either filePath or fileContent')
	}

	// ── Settings ─────────────────────────────────────────

	getAllSettings(): Record<string, string> {
		return this.appDb.getAllSettings()
	}

	setSetting(key: string, value: string): void {
		this.appDb.setSetting(key, value)
	}

	// ── Storage ──────────────────────────────────────────

	async encrypt(config: string): Promise<string> {
		if (!this.encryption) throw new Error('Encryption not available')
		return this.encryption.encrypt(config)
	}

	// ── System ────────────────────────────────────────────

	async showOpenDialog({ filters, multiple }: OpenDialogParams): Promise<{ paths: string[]; cancelled: boolean }> {
		if (!this.Utils) throw new Error('Utils not available')
		const allowedFileTypes = filters && filters.length > 0
			? filters.flatMap(f => f.extensions.map(ext => `*.${ext}`)).join(',')
			: '*'

		const result = await this.Utils.openFileDialog({
			startingFolder: '~/',
			allowedFileTypes,
			canChooseFiles: true,
			canChooseDirectory: false,
			allowsMultipleSelection: multiple ?? false,
		})

		const paths = result.filter(p => p !== '')
		return { paths, cancelled: paths.length === 0 }
	}

	async showSaveDialog({ defaultName }: SaveDialogParams): Promise<{ path: string | null; cancelled: boolean }> {
		if (!this.Utils) throw new Error('Utils not available')
		const result = await this.Utils.openFileDialog({
			startingFolder: '~/',
			allowedFileTypes: '*',
			canChooseFiles: false,
			canChooseDirectory: true,
			allowsMultipleSelection: false,
		})

		const dir = result[0]
		if (!dir || dir === '') {
			return { path: null, cancelled: true }
		}

		const path = defaultName ? `${dir}/${defaultName}` : dir
		return { path, cancelled: false }
	}

	// ── SQL formatting ───────────────────────────────────

	formatSql(sql: string): string {
		return formatSql(sql)
	}

	// ── AI SQL generation ────────────────────────────────

	async generateSql(params: AiGenerateSqlParams): Promise<AiGenerateSqlResult> {
		const driver = this.cm.getDriver(params.connectionId, params.database)
		const schema = await driver.loadSchema()
		const schemaContext = buildSchemaContext(schema)
		const aiConfig = settingsToAiConfig(this.appDb.getAllSettings())
		const sql = await generateSql(aiConfig, {
			prompt: params.prompt,
			schemaContext,
			dialect: driver.getDriverType() as 'postgresql' | 'sqlite' | 'mysql',
		})
		return { sql }
	}

	// ── Workspace persistence ─────────────────────────────

	saveWorkspace(data: string): void {
		this.appDb.saveWorkspace(data)
	}

	loadWorkspace(): string | null {
		return this.appDb.loadWorkspace()
	}

	// ── Demo ──────────────────────────────────────────────

	async initializeDemo(): Promise<ConnectionInfo> {
		if (!this.demoDbSourcePath || !this.demoDbTargetPath) {
			throw new Error('Demo database paths not configured')
		}

		const srcFile = Bun.file(this.demoDbSourcePath)
		if (!await srcFile.exists()) {
			throw new Error('Demo database source not found. Run "bun run seed:sqlite" first.')
		}

		await Bun.write(this.demoDbTargetPath, srcFile)

		const config = { type: 'sqlite' as const, path: this.demoDbTargetPath }
		const conn = this.appDb.createConnection({ name: 'Bookstore (Demo)', config })

		await this.cm.connect(conn.id)
		return conn
	}

	// ── Session Manager access ────────────────────────────

	getSessionManager(): SessionManager | undefined {
		return this.sessionManager
	}
}
