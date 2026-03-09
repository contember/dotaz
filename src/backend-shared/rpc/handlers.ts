import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import type { ExportOptions, ExportPreviewRequest, ExportRawPreviewRequest } from '@dotaz/shared/types/export'
import type { ImportOptions, ImportPreviewRequest } from '@dotaz/shared/types/import'
import type {
	AiGenerateSqlParams,
	HistoryListParams,
	OpenDialogParams,
	SaveDialogParams,
	SavedViewConfig,
	SearchDatabaseParams,
	TransactionLogParams,
} from '@dotaz/shared/types/rpc'
import type { RpcAdapter } from './adapter'
export function createHandlers(adapter: RpcAdapter) {
	return {
		// ── Connection Management ─────────────────────────
		'connections.list': () => {
			return adapter.listConnections()
		},
		'connections.create': (
			{ name, config, readOnly, color, groupName }: { name: string; config: ConnectionConfig; readOnly?: boolean; color?: string; groupName?: string },
		) => {
			return adapter.createConnection({ name, config, readOnly, color, groupName })
		},
		'connections.update': (
			{ id, name, config, readOnly, color, groupName }: {
				id: string
				name: string
				config: ConnectionConfig
				readOnly?: boolean
				color?: string
				groupName?: string
			},
		) => {
			return adapter.updateConnection({ id, name, config, readOnly, color, groupName })
		},
		'connections.setReadOnly': ({ id, readOnly }: { id: string; readOnly: boolean }) => {
			return adapter.setConnectionReadOnly(id, readOnly)
		},
		'connections.setGroup': ({ id, groupName }: { id: string; groupName: string | null }) => {
			return adapter.setConnectionGroup(id, groupName)
		},
		'connections.listGroups': () => {
			return adapter.listConnectionGroups()
		},
		'connections.renameGroup': ({ oldName, newName }: { oldName: string; newName: string }) => {
			adapter.renameConnectionGroup(oldName, newName)
		},
		'connections.deleteGroup': ({ groupName }: { groupName: string }) => {
			adapter.deleteConnectionGroup(groupName)
		},
		'connections.delete': async ({ id }: { id: string }) => {
			await adapter.deleteConnection(id)
		},
		'connections.test': async ({ config }: { config: ConnectionConfig }) => {
			return adapter.testConnection(config)
		},
		'connections.connect': async (
			{ connectionId, password, encryptedConfig, name }: { connectionId: string; password?: string; encryptedConfig?: string; name?: string },
		) => {
			await adapter.connect(connectionId, password, encryptedConfig, name)
		},
		'connections.disconnect': async ({ connectionId }: { connectionId: string }) => {
			await adapter.disconnect(connectionId)
		},

		// ── Sessions ─────────────────────────────────────
		'session.create': async ({ connectionId, database }: { connectionId: string; database?: string }) => {
			return adapter.createSession(connectionId, database)
		},
		'session.destroy': async ({ sessionId }: { sessionId: string }) => {
			await adapter.destroySession(sessionId)
		},
		'session.list': ({ connectionId }: { connectionId: string }) => {
			return adapter.listSessions(connectionId)
		},

		// ── Databases (multi-database PostgreSQL) ────────
		'databases.list': async ({ connectionId }: { connectionId: string }) => {
			return adapter.listDatabases(connectionId)
		},
		'databases.activate': async ({ connectionId, database }: { connectionId: string; database: string }) => {
			await adapter.activateDatabase(connectionId, database)
		},
		'databases.deactivate': async ({ connectionId, database }: { connectionId: string; database: string }) => {
			await adapter.deactivateDatabase(connectionId, database)
		},

		// ── Schema ───────────────────────────────────────
		'schema.load': async ({ connectionId, database, sessionId }: { connectionId: string; database?: string; sessionId?: string }) => {
			const driver = adapter.getDriver(connectionId, database)
			return driver.loadSchema(sessionId)
		},

		// ── Query Execution ──────────────────────────────
		'query.execute': async ({ connectionId, sql, queryId, params, database, statements, sessionId, searchPath }: {
			connectionId: string
			sql: string
			queryId: string
			params?: unknown[]
			database?: string
			statements?: { sql: string; params?: unknown[] }[]
			sessionId?: string
			searchPath?: string
		}) => {
			if (statements && statements.length > 0) {
				return adapter.executeStatements(connectionId, statements, database, sessionId)
			}
			return adapter.executeQuery(connectionId, sql, params, queryId, database, sessionId, searchPath)
		},
		'query.cancel': async ({ queryId }: { queryId: string }) => {
			await adapter.cancelQuery(queryId)
		},
		'query.format': ({ sql }: { sql: string }) => {
			return { sql: adapter.formatSql(sql) }
		},
		'query.explain': async ({ connectionId, sql, analyze, database, sessionId, searchPath }: {
			connectionId: string
			sql: string
			analyze?: boolean
			database?: string
			sessionId?: string
			searchPath?: string
		}) => {
			return adapter.explainQuery(connectionId, sql, analyze ?? false, database, sessionId, searchPath)
		},

		// ── Transactions ─────────────────────────────────
		'tx.begin': async ({ connectionId, database, sessionId }: { connectionId: string; database?: string; sessionId?: string }) => {
			await adapter.beginTransaction(connectionId, database, sessionId)
		},
		'tx.commit': async ({ connectionId, database, sessionId }: { connectionId: string; database?: string; sessionId?: string }) => {
			await adapter.commitTransaction(connectionId, database, sessionId)
		},
		'tx.rollback': async ({ connectionId, database, sessionId }: { connectionId: string; database?: string; sessionId?: string }) => {
			await adapter.rollbackTransaction(connectionId, database, sessionId)
		},

		// ── Transaction Log ──────────────────────────────
		'transaction.getLog': (params: TransactionLogParams) => {
			return adapter.getTransactionLog(params)
		},
		'transaction.clearLog': ({ connectionId, database, sessionId }: { connectionId: string; database?: string; sessionId?: string }) => {
			adapter.clearTransactionLog(connectionId, database, sessionId)
		},

		// ── Search ───────────────────────────────────────
		'search.searchDatabase': async (params: SearchDatabaseParams) => {
			return adapter.searchDatabase(params)
		},

		// ── Export ────────────────────────────────────────
		'export.exportData': async (opts: ExportOptions) => {
			return adapter.exportData(opts)
		},
		'export.preview': async (req: ExportPreviewRequest) => {
			const content = await adapter.exportPreview(req)
			return { content }
		},
		'export.previewRows': async (req: ExportRawPreviewRequest) => {
			return adapter.exportPreviewRows(req)
		},

		// ── Import ────────────────────────────────────────
		'import.importData': async (opts: ImportOptions) => {
			return adapter.importData(opts)
		},
		'import.preview': async (req: ImportPreviewRequest) => {
			return adapter.importPreview(req)
		},

		// ── History ───────────────────────────────────────
		'history.list': (params: HistoryListParams) => {
			return adapter.listHistory(params)
		},
		'history.clear': ({ connectionId }: { connectionId?: string }) => {
			adapter.clearHistory(connectionId)
		},

		// ── Saved Views ──────────────────────────────────
		'views.save': ({ connectionId, schemaName, tableName, name, config }: {
			connectionId: string
			schemaName: string
			tableName: string
			name: string
			config: SavedViewConfig
		}) => {
			if (!name || !name.trim()) {
				throw new Error('View name is required')
			}
			if (!connectionId) {
				throw new Error('connectionId is required')
			}
			if (!tableName) {
				throw new Error('tableName is required')
			}
			// Check name uniqueness within the table
			const existing = adapter.listSavedViews(connectionId, schemaName, tableName)
			if (existing.some((v) => v.name === name.trim())) {
				throw new Error(`A view named "${name.trim()}" already exists for this table`)
			}
			return adapter.createSavedView({
				connectionId,
				schemaName,
				tableName,
				name: name.trim(),
				config,
			})
		},
		'views.update': ({ id, name, config }: {
			id: string
			name: string
			config: SavedViewConfig
		}) => {
			if (!id) {
				throw new Error('View id is required')
			}
			if (!name || !name.trim()) {
				throw new Error('View name is required')
			}
			// Check name uniqueness within the table (excluding this view)
			const current = adapter.getSavedViewById(id)
			if (!current) {
				throw new Error(`Saved view not found: ${id}`)
			}
			const existing = adapter.listSavedViews(current.connectionId, current.schemaName, current.tableName)
			if (existing.some((v) => v.id !== id && v.name === name.trim())) {
				throw new Error(`A view named "${name.trim()}" already exists for this table`)
			}
			return adapter.updateSavedView({ id, name: name.trim(), config })
		},
		'views.delete': ({ id }: { id: string }) => {
			adapter.deleteSavedView(id)
		},
		'views.listByConnection': ({ connectionId }: { connectionId: string }) => {
			return adapter.listSavedViewsByConnection(connectionId)
		},

		// ── Bookmarks ────────────────────────────────────
		'bookmarks.list': ({ connectionId, search }: { connectionId: string; search?: string }) => {
			return adapter.listBookmarks(connectionId, search)
		},
		'bookmarks.create': ({ connectionId, database, name, description, sql }: {
			connectionId: string
			database?: string
			name: string
			description?: string
			sql: string
		}) => {
			if (!name || !name.trim()) {
				throw new Error('Bookmark name is required')
			}
			return adapter.createBookmark({ connectionId, database, name: name.trim(), description, sql })
		},
		'bookmarks.update': ({ id, name, description, sql }: {
			id: string
			name: string
			description?: string
			sql: string
		}) => {
			if (!id) {
				throw new Error('Bookmark id is required')
			}
			if (!name || !name.trim()) {
				throw new Error('Bookmark name is required')
			}
			return adapter.updateBookmark({ id, name: name.trim(), description, sql })
		},
		'bookmarks.delete': ({ id }: { id: string }) => {
			adapter.deleteBookmark(id)
		},

		// ── Settings ─────────────────────────────────────
		'settings.getAll': () => {
			return adapter.getAllSettings()
		},
		'settings.set': ({ key, value }: { key: string; value: string }) => {
			adapter.setSetting(key, value)
		},

		// ── Storage ──────────────────────────────────────
		'storage.encrypt': async ({ config }: { config: string }) => {
			if (!adapter.encrypt) {
				throw new Error('Encryption not available')
			}
			const encryptedConfig = await adapter.encrypt(config)
			return { encryptedConfig }
		},

		// ── AI SQL generation ─────────────────────────────
		'ai.generateSql': async (params: AiGenerateSqlParams) => {
			return adapter.generateSql(params)
		},

		// ── Workspace ─────────────────────────────────────
		'workspace.save': ({ data }: { data: string }) => {
			adapter.saveWorkspace(data)
		},
		'workspace.load': () => {
			return adapter.loadWorkspace()
		},

		// ── System ────────────────────────────────────────
		'system.showOpenDialog': async (params: OpenDialogParams) => {
			if (!adapter.showOpenDialog) {
				return { paths: [] as string[], cancelled: true }
			}
			return adapter.showOpenDialog(params)
		},
		'system.showSaveDialog': async (params: SaveDialogParams) => {
			if (!adapter.showSaveDialog) {
				return { path: null as string | null, cancelled: true }
			}
			return adapter.showSaveDialog(params)
		},
	} as const
}
