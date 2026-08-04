import type { ConnectionConfig, ConnectionInfo, ConnectionSecrets } from '@dotaz/shared/types/connection'
import { mergeSecrets } from '@dotaz/shared/types/connection'
import type { DatabaseInfo } from '@dotaz/shared/types/database'
import type { ExportOptions, ExportPreviewRequest, ExportRawPreviewRequest, ExportRawPreviewResponse, ExportResult } from '@dotaz/shared/types/export'
import type { ImportOptions, ImportPreviewRequest, ImportPreviewResult, ImportResult } from '@dotaz/shared/types/import'
import type { QueryHistoryEntry, QueryResult } from '@dotaz/shared/types/query'
import type {
	AgentHelloResult,
	AiGenerateSqlParams,
	AiGenerateSqlResult,
	ConnectionHandleInfo,
	HistoryListParams,
	OpenDialogParams,
	Proposal,
	ProposalListParams,
	ProposalResolveParams,
	ProposeWriteParams,
	SaveDialogParams,
	SavedView,
	SavedViewConfig,
	SearchDatabaseParams,
	SearchDatabaseResult,
	SessionInfo,
	TransactionLogParams,
	TransactionLogResult,
	UiCommandPayload,
	UiSnapshot,
} from '@dotaz/shared/types/rpc'
import { settingsToAiConfig } from '@dotaz/shared/types/settings'
import type { DatabaseDriver } from '../db/driver'
import { withEphemeralSession } from '../db/ephemeral-session'
import { buildSchemaContext, generateSql } from '../services/ai-sql'
import type { ConnectionManager } from '../services/connection-manager'
import type { EncryptionService } from '../services/encryption'
import { buildExportSelectQuery, exportPreview, exportToFile } from '../services/export-service'
import { importFromStream, importPreviewFromStream } from '../services/import-service'
import { ProposalStore } from '../services/proposal-store'
import { assertSessionWritable } from '../services/query-executor'
import type { QueryExecutor } from '../services/query-executor'
import { searchDatabase } from '../services/search-service'
import type { SessionManager } from '../services/session-manager'
import { formatSql } from '../services/sql-formatter'
import { TransactionManager } from '../services/transaction-manager'
import type { AppDatabase } from '../storage/app-db'
import type { RpcAdapter } from './adapter'

export type EmitMessage = (channel: string, payload: unknown) => void

/** Wire protocol version reported by `agent.hello` and `/health` (docs/agent-cli.md). */
export const AGENT_PROTOCOL_VERSION = 1

export interface BackendAdapterOptions {
	encryption?: EncryptionService
	Utils?: typeof import('electrobun/bun').Utils
	emitMessage?: EmitMessage
	sessionManager?: SessionManager
	demoDbSourcePath?: string
	demoDbTargetPath?: string
	allowServerFileAccess?: boolean
	appVersion?: string
	mode?: 'desktop' | 'web' | 'demo'
}

export class BackendAdapter implements RpcAdapter {
	private txManager: TransactionManager
	private encryption?: EncryptionService
	private Utils?: typeof import('electrobun/bun').Utils
	private emitMessage?: EmitMessage
	private sessionManager?: SessionManager
	private demoDbSourcePath?: string
	private demoDbTargetPath?: string
	private allowServerFileAccess: boolean
	private appVersion: string
	private mode: 'desktop' | 'web' | 'demo'
	private proposals = new ProposalStore()
	private unsubscribeProposals: () => void
	/** Last snapshot published by the frontend — absent until the UI reports in. */
	private uiSnapshot: UiSnapshot | null = null

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
		this.allowServerFileAccess = opts?.allowServerFileAccess ?? true
		this.appVersion = opts?.appVersion ?? '0.0.0'
		this.mode = opts?.mode ?? 'web'
		// Every transition, not just creation — an approval banner whose proposal was cancelled
		// or expired elsewhere must stop being actionable.
		this.unsubscribeProposals = this.proposals.onChange((proposal) => {
			this.emitMessage?.('cli.proposal', proposal)
		})
	}

	// ── Connections ────────────────────────────────────────

	listConnections(): ConnectionInfo[] {
		return this.cm.listConnections()
	}

	createConnection(params: { name: string; config: ConnectionConfig; readOnly?: boolean; color?: string; groupName?: string }): ConnectionInfo {
		this.rejectServerSqliteConfig(params.config)
		return this.cm.createConnection(params)
	}

	updateConnection(
		params: { id: string; name: string; config: ConnectionConfig; readOnly?: boolean; color?: string; groupName?: string },
	): ConnectionInfo {
		this.rejectServerSqliteConfig(params.config)
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
		this.rejectServerSqliteConfig(config)
		return this.cm.testConnection(config)
	}

	async connect(
		connectionId: string,
		password?: string,
		params?: { config?: ConnectionConfig; encryptedSecrets?: string; name?: string; encryptedConfig?: string },
	): Promise<void> {
		if (this.encryption) {
			// Web mode: register the connection in this session's in-memory app-db.
			let fullConfig: ConnectionConfig | undefined
			if (params?.config) {
				const secrets: ConnectionSecrets = params.encryptedSecrets
					? JSON.parse(await this.encryption.decrypt(params.encryptedSecrets)) as ConnectionSecrets
					: {}
				fullConfig = mergeSecrets(params.config, secrets)
			} else if (params?.encryptedConfig) {
				// Legacy: full config blob (pre-split). Used until IndexedDB migration completes.
				fullConfig = JSON.parse(await this.encryption.decrypt(params.encryptedConfig)) as ConnectionConfig
			}
			if (fullConfig) {
				// Client-supplied config: block SQLite server-path access in web mode.
				this.rejectServerSqliteConfig(fullConfig)
				const existing = this.appDb.getConnectionById(connectionId)
				const resolvedName = params?.name ?? existing?.name ?? connectionId
				if (!existing) {
					this.appDb.createConnectionWithId(connectionId, { name: resolvedName, config: fullConfig })
				} else {
					this.appDb.updateConnection({ id: connectionId, name: resolvedName, config: fullConfig })
				}
			}
		}
		await this.cm.connect(connectionId, password ? { password } : undefined)
	}

	async disconnect(connectionId: string): Promise<void> {
		await this.cm.disconnect(connectionId)
	}

	listConnectionHandles(): ConnectionHandleInfo[] {
		const handles = this.cm.listConnectionHandles()
		if (!this.sessionManager) return handles

		const sessions = new Map<string, SessionInfo>()
		for (const connection of this.cm.listConnections()) {
			for (const session of this.sessionManager.listSessions(connection.id)) {
				sessions.set(session.sessionId, session)
			}
		}

		return handles.map((handle) => {
			if (!handle.sessionId) return handle
			const session = sessions.get(handle.sessionId)
			if (!session) return handle
			return { ...handle, label: session.label }
		})
	}

	async terminateConnectionHandle(connectionId: string, database: string | undefined, handleId: string): Promise<void> {
		const handle = this.listConnectionHandles().find(
			(candidate) =>
				candidate.connectionId === connectionId && (database === undefined || candidate.database === database) && candidate.handleId === handleId,
		)

		if (handle?.sessionId && this.sessionManager) {
			await this.sessionManager.destroySession(handle.sessionId)
			this.emitMessage?.('session.changed', { connectionId, sessions: this.sessionManager.listSessions(connectionId) })
			return
		}

		await this.cm.terminateConnectionHandle(connectionId, database, handleId)
	}

	// ── Sessions ──────────────────────────────────────────

	async createSession(connectionId: string, database?: string, opts?: { readOnly?: boolean; label?: string }): Promise<SessionInfo> {
		if (!this.sessionManager) throw new Error('SessionManager not available')
		const info = await this.sessionManager.createSession(connectionId, database, opts)
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

	async listDatabasesForConfig(config: ConnectionConfig): Promise<string[]> {
		this.rejectServerSqliteConfig(config)
		return this.cm.listDatabasesForConfig(config)
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
		// The engine blocks these anyway; this turns the raw engine error into READ_ONLY_SESSION
		for (const stmt of statements) assertSessionWritable(driver, stmt.sql, sessionId)

		const runInSession = async (effectiveSessionId: string) => {
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
							effectiveSessionId,
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
							effectiveSessionId,
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
			}
		}

		if (sessionId) {
			return runInSession(sessionId)
		}
		return withEphemeralSession(driver, runInSession)
	}

	submitQuery(
		connectionId: string,
		sql: string,
		params: unknown[] | undefined,
		queryId: string,
		database?: string,
		sessionId?: string,
		searchPath?: string,
	): void {
		const start = performance.now()
		this.queryExecutor.executeQuery(connectionId, sql, params, 0, queryId, database, sessionId, searchPath)
			.then((results) => {
				this.emitMessage?.('query.completed', {
					queryId,
					results,
					durationMs: Math.round(performance.now() - start),
				})
			})
			.catch((err) => {
				const errorCode = (err as any)?.code as string | undefined
				this.emitMessage?.('query.completed', {
					queryId,
					error: err instanceof Error ? err.message : String(err),
					errorCode,
					durationMs: Math.round(performance.now() - start),
				})
			})
	}

	submitExplain(
		connectionId: string,
		sql: string,
		analyze: boolean,
		queryId: string,
		database?: string,
		sessionId?: string,
		searchPath?: string,
	): void {
		const start = performance.now()
		this.queryExecutor.explainQuery(connectionId, sql, analyze, database, sessionId, searchPath)
			.then((explainResult) => {
				this.emitMessage?.('query.completed', {
					queryId,
					explainResult,
					durationMs: Math.round(performance.now() - start),
				})
			})
			.catch((err) => {
				this.emitMessage?.('query.completed', {
					queryId,
					error: err instanceof Error ? err.message : String(err),
					durationMs: Math.round(performance.now() - start),
				})
			})
	}

	async cancelQuery(queryId: string): Promise<void> {
		await this.queryExecutor.cancelQuery(queryId)
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
		const filePath = opts.filePath
		this.rejectServerFileAccess(filePath)
		const driver = this.cm.getDriver(opts.connectionId, opts.database)
		if (!filePath) throw new Error('Export requires a file path')
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
				keyColumns: opts.keyColumns,
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
			filePath,
			undefined,
			onProgress,
		)
		return { ...result, filePath }
	}

	async exportPreview(req: ExportPreviewRequest): Promise<string> {
		const driver = this.cm.getDriver(req.connectionId, req.database)
		return exportPreview(driver, {
			schema: req.schema,
			table: req.table,
			format: req.format,
			columns: req.columns,
			keyColumns: req.keyColumns,
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
		this.rejectServerFileAccess(opts.filePath)
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
		this.rejectServerFileAccess(req.filePath)
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

	private rejectServerFileAccess(filePath?: string): void {
		if (!this.allowServerFileAccess && filePath !== undefined) {
			throw new Error('Server file access is not available in this runtime')
		}
	}

	// A client-supplied SQLite config points at a path on the SERVER's filesystem,
	// so treat it exactly like any other server file access request. Only guards
	// configs passed as method arguments — never the stored/server-managed config.
	private rejectServerSqliteConfig(config?: ConnectionConfig): void {
		if (config?.type === 'sqlite') {
			this.rejectServerFileAccess(config.path)
		}
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

	async encryptSecrets(secrets: string): Promise<string> {
		if (!this.encryption) throw new Error('Encryption not available')
		return this.encryption.encrypt(secrets)
	}

	async decryptConfig(encryptedConfig: string): Promise<string> {
		if (!this.encryption) throw new Error('Encryption not available')
		return this.encryption.decrypt(encryptedConfig)
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

	// ── Agent CLI ─────────────────────────────────────────

	agentHello(): AgentHelloResult {
		return { version: this.appVersion, mode: this.mode, pid: process.pid, protocol: AGENT_PROTOCOL_VERSION }
	}

	proposeWrite(params: ProposeWriteParams): Proposal {
		return this.proposals.create(params)
	}

	listProposals(filter?: ProposalListParams): Proposal[] {
		return this.proposals.list(filter)
	}

	getProposal(proposalId: string): Proposal | null {
		return this.proposals.get(proposalId)
	}

	async waitForProposal(proposalId: string, timeoutMs: number): Promise<Proposal> {
		return this.proposals.wait(proposalId, timeoutMs)
	}

	cancelProposal(proposalId: string): Proposal {
		return this.proposals.cancel(proposalId)
	}

	resolveProposal(params: ProposalResolveParams): Proposal {
		return this.proposals.resolve(params)
	}

	// ── UI control ────────────────────────────────────────

	getUiSnapshot(): UiSnapshot {
		return this.uiSnapshot ?? { tabs: [], activeTabId: null, activeConnectionId: null, updatedAt: 0 }
	}

	setUiSnapshot(snapshot: UiSnapshot): void {
		this.uiSnapshot = snapshot
	}

	sendUiCommand(payload: UiCommandPayload): void {
		this.emitMessage?.('cli.command', payload)
	}

	// ── Session Manager access ────────────────────────────

	getSessionManager(): SessionManager | undefined {
		return this.sessionManager
	}

	dispose(): void {
		this.unsubscribeProposals()
		this.proposals.dispose()
	}
}
