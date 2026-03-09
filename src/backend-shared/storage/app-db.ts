import Database from 'bun:sqlite'
import type { ConnectionConfig, ConnectionInfo } from '@dotaz/shared/types/connection'
import { isServerConfig } from '@dotaz/shared/types/connection'
import type { QueryHistoryEntry, QueryHistoryStatus } from '@dotaz/shared/types/query'
import type { HistoryListParams, QueryBookmark, SavedView, SavedViewConfig } from '@dotaz/shared/types/rpc'
import { decryptLocalPassword, encryptLocalPassword, isEncryptedPassword } from '../services/encryption'
import { runMigrations } from './migrations'

/** Default settings values — returned when a key has not been explicitly set. */
export const DEFAULT_SETTINGS: Record<string, string> = {
	defaultPageSize: '100',
	defaultTxMode: 'auto-commit',
	theme: 'dark',
	queryTimeout: '30000',
	maxHistoryEntries: '1000',
	clipboardIncludeHeaders: 'true',
	exportDefaultFormat: 'csv',
	defaultConnectionMode: 'pool',
	autoPin: 'on-begin',
	autoUnpin: 'never',
	maxSessionsPerConnection: '5',
}

let instance: AppDatabase | null = null

export class AppDatabase {
	readonly db: Database
	private localKey: Uint8Array | null = null

	private constructor(dbPath: string) {
		this.db = new Database(dbPath, { create: true })
		this.db.run('PRAGMA journal_mode = WAL')
		this.db.run('PRAGMA foreign_keys = ON')
		runMigrations(this.db)
	}

	/**
	 * Get or create the singleton AppDatabase instance.
	 * When called without arguments, uses Utils.paths.userData/dotaz.db.
	 * Pass a custom path for testing.
	 */
	static getInstance(dbPath?: string): AppDatabase {
		if (!instance) {
			const path = dbPath ?? getDefaultDbPath()
			instance = new AppDatabase(path)
		}
		return instance
	}

	/**
	 * Create a standalone AppDatabase instance (not the singleton).
	 * Used for per-session isolation in the web server.
	 */
	static create(dbPath: string): AppDatabase {
		return new AppDatabase(dbPath)
	}

	/**
	 * Close the underlying SQLite database.
	 */
	close(): void {
		this.db.close()
	}

	/**
	 * Run a function inside a SQLite transaction. If the function throws,
	 * the transaction is rolled back and the error re-thrown.
	 */
	transaction<T>(fn: () => T): T {
		const wrapped = this.db.transaction(fn)
		return wrapped()
	}

	/**
	 * Reset the singleton (for testing only).
	 */
	static resetInstance(): void {
		if (instance) {
			instance.db.close()
			instance = null
		}
	}

	/**
	 * Set the local encryption key and migrate any existing plaintext passwords.
	 */
	setLocalKey(key: Uint8Array): void {
		this.localKey = key
		this.migratePasswords()
	}

	private encryptConfigJson(config: ConnectionConfig): string {
		if (this.localKey && isServerConfig(config)) {
			let encrypted: ConnectionConfig = { ...config, password: encryptLocalPassword(config.password, this.localKey) }
			// Encrypt SSH tunnel secrets if present
			if (config.type === 'postgresql' && config.sshTunnel) {
				const tunnel = { ...config.sshTunnel }
				if (tunnel.password) tunnel.password = encryptLocalPassword(tunnel.password, this.localKey!)
				if (tunnel.keyPassphrase) tunnel.keyPassphrase = encryptLocalPassword(tunnel.keyPassphrase, this.localKey!)
				encrypted = { ...encrypted, sshTunnel: tunnel } as ConnectionConfig
			}
			return JSON.stringify(encrypted)
		}
		return JSON.stringify(config)
	}

	private decryptConfig(config: ConnectionConfig): ConnectionConfig {
		if (this.localKey && isServerConfig(config) && isEncryptedPassword(config.password)) {
			let decrypted: ConnectionConfig = { ...config, password: decryptLocalPassword(config.password, this.localKey) }
			// Decrypt SSH tunnel secrets if present
			if (config.type === 'postgresql' && config.sshTunnel) {
				const tunnel = { ...config.sshTunnel }
				if (tunnel.password && isEncryptedPassword(tunnel.password)) {
					tunnel.password = decryptLocalPassword(tunnel.password, this.localKey!)
				}
				if (tunnel.keyPassphrase && isEncryptedPassword(tunnel.keyPassphrase)) {
					tunnel.keyPassphrase = decryptLocalPassword(tunnel.keyPassphrase, this.localKey!)
				}
				decrypted = { ...decrypted, sshTunnel: tunnel } as ConnectionConfig
			}
			return decrypted
		}
		return config
	}

	private migratePasswords(): void {
		if (!this.localKey) return
		this.transaction(() => {
			const rows = this.db.prepare('SELECT id, config FROM connections').all() as ConnectionRow[]
			const update = this.db.prepare('UPDATE connections SET config = ? WHERE id = ?')
			for (const row of rows) {
				try {
					const config = JSON.parse(row.config) as ConnectionConfig
					if (isServerConfig(config)) {
						let changed = false
						let encrypted = { ...config }
						if (!isEncryptedPassword(config.password)) {
							encrypted = { ...encrypted, password: encryptLocalPassword(config.password, this.localKey!) }
							changed = true
						}
						// Also migrate SSH tunnel secrets
						if (config.type === 'postgresql' && config.sshTunnel) {
							const tunnel = { ...config.sshTunnel }
							if (tunnel.password && !isEncryptedPassword(tunnel.password)) {
								tunnel.password = encryptLocalPassword(tunnel.password, this.localKey!)
								changed = true
							}
							if (tunnel.keyPassphrase && !isEncryptedPassword(tunnel.keyPassphrase)) {
								tunnel.keyPassphrase = encryptLocalPassword(tunnel.keyPassphrase, this.localKey!)
								changed = true
							}
							if (changed) encrypted = { ...encrypted, sshTunnel: tunnel } as typeof encrypted
						}
						if (changed) {
							update.run(JSON.stringify(encrypted), row.id)
						}
					}
				} catch {
					// Skip corrupted configs
				}
			}
		})
	}

	private toConnectionInfo(row: ConnectionRow): ConnectionInfo {
		const config = safeJsonParse<ConnectionConfig>(row.config, `connection "${row.name}"`)
		return {
			id: row.id,
			name: row.name,
			config: this.decryptConfig(config),
			state: 'disconnected',
			readOnly: row.read_only === 1 ? true : undefined,
			color: row.color ?? undefined,
			groupName: row.group_name ?? undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}
	}

	// ── Connections ──────────────────────────────────────────

	listConnections(): ConnectionInfo[] {
		const rows = this.db.prepare('SELECT * FROM connections ORDER BY group_name NULLS LAST, name').all() as ConnectionRow[]
		return rows.map(row => this.toConnectionInfo(row))
	}

	getConnectionById(id: string): ConnectionInfo | null {
		const row = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow | null
		return row ? this.toConnectionInfo(row) : null
	}

	createConnection(params: { name: string; config: ConnectionConfig; readOnly?: boolean; color?: string; groupName?: string }): ConnectionInfo {
		const id = crypto.randomUUID()
		return this.createConnectionWithId(id, params)
	}

	createConnectionWithId(
		id: string,
		params: { name: string; config: ConnectionConfig; readOnly?: boolean; color?: string; groupName?: string },
	): ConnectionInfo {
		const now = new Date().toISOString()
		this.db.prepare(
			'INSERT INTO connections (id, name, type, config, read_only, color, group_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
		).run(
			id,
			params.name,
			params.config.type,
			this.encryptConfigJson(params.config),
			params.readOnly ? 1 : 0,
			params.color || null,
			params.groupName || null,
			now,
			now,
		)
		return this.getConnectionById(id)!
	}

	updateConnection(
		params: { id: string; name: string; config: ConnectionConfig; readOnly?: boolean; color?: string; groupName?: string },
	): ConnectionInfo {
		const now = new Date().toISOString()
		this.db.prepare(
			'UPDATE connections SET name = ?, type = ?, config = ?, read_only = ?, color = ?, group_name = ?, updated_at = ? WHERE id = ?',
		).run(
			params.name,
			params.config.type,
			this.encryptConfigJson(params.config),
			params.readOnly ? 1 : 0,
			params.color || null,
			params.groupName !== undefined ? (params.groupName || null) : null,
			now,
			params.id,
		)
		const result = this.getConnectionById(params.id)
		if (!result) throw new Error(`Connection not found: ${params.id}`)
		return result
	}

	setConnectionGroup(id: string, groupName: string | null): ConnectionInfo {
		this.db.prepare('UPDATE connections SET group_name = ? WHERE id = ?').run(groupName, id)
		const result = this.getConnectionById(id)
		if (!result) throw new Error(`Connection not found: ${id}`)
		return result
	}

	listConnectionGroups(): string[] {
		const rows = this.db.prepare('SELECT DISTINCT group_name FROM connections WHERE group_name IS NOT NULL ORDER BY group_name').all() as {
			group_name: string
		}[]
		return rows.map(r => r.group_name)
	}

	renameConnectionGroup(oldName: string, newName: string): void {
		this.db.prepare('UPDATE connections SET group_name = ? WHERE group_name = ?').run(newName, oldName)
	}

	deleteConnectionGroup(groupName: string): void {
		this.db.prepare('UPDATE connections SET group_name = NULL WHERE group_name = ?').run(groupName)
	}

	setConnectionReadOnly(id: string, readOnly: boolean): ConnectionInfo {
		this.db.prepare('UPDATE connections SET read_only = ? WHERE id = ?').run(readOnly ? 1 : 0, id)
		const result = this.getConnectionById(id)
		if (!result) throw new Error(`Connection not found: ${id}`)
		return result
	}

	deleteConnection(id: string): void {
		this.db.prepare('DELETE FROM connections WHERE id = ?').run(id)
	}

	// ── Settings ─────────────────────────────────────────────

	getSetting(key: string): string | null {
		const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | null
		return row?.value ?? null
	}

	getNumberSetting(key: string): number | null {
		const raw = this.getSetting(key) ?? DEFAULT_SETTINGS[key] ?? null
		if (raw === null) return null
		const num = Number(raw)
		return Number.isFinite(num) ? num : null
	}

	getBooleanSetting(key: string): boolean | null {
		const raw = this.getSetting(key) ?? DEFAULT_SETTINGS[key] ?? null
		if (raw === null) return null
		if (raw === 'true') return true
		if (raw === 'false') return false
		return null
	}

	setSetting(key: string, value: string): void {
		this.db.prepare(
			'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
		).run(key, value)
	}

	getAllSettings(): Record<string, string> {
		const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
		const result: Record<string, string> = {}
		for (const row of rows) {
			result[row.key] = row.value
		}
		return result
	}

	// ── Saved Views ──────────────────────────────────────────

	listSavedViews(connectionId: string, schemaName: string, tableName: string): SavedView[] {
		const rows = this.db.prepare(
			'SELECT * FROM saved_views WHERE connection_id = ? AND schema_name = ? AND table_name = ? ORDER BY name',
		).all(connectionId, schemaName, tableName) as SavedViewRow[]
		return rows.map(rowToSavedView)
	}

	createSavedView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): SavedView {
		const id = crypto.randomUUID()
		const now = new Date().toISOString()
		this.db.prepare(
			'INSERT INTO saved_views (id, connection_id, schema_name, table_name, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		).run(id, params.connectionId, params.schemaName, params.tableName, params.name, JSON.stringify(params.config), now, now)
		return this.getSavedViewById(id)!
	}

	updateSavedView(params: { id: string; name: string; config: SavedViewConfig }): SavedView {
		const now = new Date().toISOString()
		this.db.prepare(
			'UPDATE saved_views SET name = ?, config = ?, updated_at = ? WHERE id = ?',
		).run(params.name, JSON.stringify(params.config), now, params.id)
		const result = this.getSavedViewById(params.id)
		if (!result) throw new Error(`Saved view not found: ${params.id}`)
		return result
	}

	deleteSavedView(id: string): void {
		this.db.prepare('DELETE FROM saved_views WHERE id = ?').run(id)
	}

	listSavedViewsByConnection(connectionId: string): SavedView[] {
		const rows = this.db.prepare(
			'SELECT * FROM saved_views WHERE connection_id = ? ORDER BY table_name, name',
		).all(connectionId) as SavedViewRow[]
		return rows.map(rowToSavedView)
	}

	getSavedViewById(id: string): SavedView | null {
		const row = this.db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as SavedViewRow | null
		return row ? rowToSavedView(row) : null
	}

	// ── History ───────────────────────────────────────────────

	addHistory(params: {
		connectionId: string
		database?: string
		sql: string
		status: QueryHistoryStatus
		durationMs?: number
		rowCount?: number
		errorMessage?: string
	}): QueryHistoryEntry {
		const result = this.db.prepare(
			'INSERT INTO query_history (connection_id, database, sql, status, duration_ms, row_count, error_message) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
		).get(
			params.connectionId,
			params.database ?? null,
			params.sql,
			params.status,
			params.durationMs ?? null,
			params.rowCount ?? null,
			params.errorMessage ?? null,
		) as HistoryRow

		this.pruneHistory()

		return rowToHistoryEntry(result)
	}

	private pruneHistory(): void {
		const max = this.getNumberSetting('maxHistoryEntries')
		if (max === null || max <= 0) return
		this.db.prepare(
			'DELETE FROM query_history WHERE id NOT IN (SELECT id FROM query_history ORDER BY executed_at DESC, id DESC LIMIT ?)',
		).run(max)
	}

	listHistory(params: HistoryListParams): QueryHistoryEntry[] {
		const limit = params.limit ?? 100
		const offset = params.offset ?? 0

		const conditions: string[] = []
		const queryParams: unknown[] = []

		if (params.connectionId) {
			conditions.push('connection_id = ?')
			queryParams.push(params.connectionId)
		}
		if (params.search) {
			conditions.push('sql LIKE ?')
			queryParams.push(`%${params.search}%`)
		}
		if (params.startDate) {
			conditions.push('executed_at >= ?')
			queryParams.push(params.startDate + ' 00:00:00')
		}
		if (params.endDate) {
			// Inclusive: include all entries on the end date by comparing < next day
			const nextDay = new Date(params.endDate + 'T00:00:00Z')
			nextDay.setUTCDate(nextDay.getUTCDate() + 1)
			const y = nextDay.getUTCFullYear()
			const m = String(nextDay.getUTCMonth() + 1).padStart(2, '0')
			const d = String(nextDay.getUTCDate()).padStart(2, '0')
			conditions.push('executed_at < ?')
			queryParams.push(`${y}-${m}-${d} 00:00:00`)
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
		const sql = `SELECT * FROM query_history ${where} ORDER BY executed_at DESC LIMIT ? OFFSET ?`
		queryParams.push(limit, offset)

		const rows = this.db.prepare(sql).all(...queryParams as any[]) as HistoryRow[]
		return rows.map(rowToHistoryEntry)
	}

	clearHistory(connectionId?: string): void {
		if (connectionId) {
			this.db.prepare('DELETE FROM query_history WHERE connection_id = ?').run(connectionId)
		} else {
			this.db.prepare('DELETE FROM query_history').run()
		}
	}

	// ── Bookmarks ────────────────────────────────────────────

	listBookmarks(connectionId: string, search?: string): QueryBookmark[] {
		if (search) {
			const rows = this.db.prepare(
				'SELECT * FROM query_bookmarks WHERE connection_id = ? AND (name LIKE ? OR sql LIKE ?) ORDER BY name',
			).all(connectionId, `%${search}%`, `%${search}%`) as BookmarkRow[]
			return rows.map(rowToBookmark)
		}
		const rows = this.db.prepare(
			'SELECT * FROM query_bookmarks WHERE connection_id = ? ORDER BY name',
		).all(connectionId) as BookmarkRow[]
		return rows.map(rowToBookmark)
	}

	createBookmark(params: { connectionId: string; database?: string; name: string; description?: string; sql: string }): QueryBookmark {
		const id = crypto.randomUUID()
		const now = new Date().toISOString()
		this.db.prepare(
			'INSERT INTO query_bookmarks (id, connection_id, database, name, description, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		).run(id, params.connectionId, params.database ?? null, params.name, params.description ?? '', params.sql, now, now)
		return this.getBookmarkById(id)!
	}

	updateBookmark(params: { id: string; name: string; description?: string; sql: string }): QueryBookmark {
		const now = new Date().toISOString()
		this.db.prepare(
			'UPDATE query_bookmarks SET name = ?, description = ?, sql = ?, updated_at = ? WHERE id = ?',
		).run(params.name, params.description ?? '', params.sql, now, params.id)
		const result = this.getBookmarkById(params.id)
		if (!result) throw new Error(`Bookmark not found: ${params.id}`)
		return result
	}

	deleteBookmark(id: string): void {
		this.db.prepare('DELETE FROM query_bookmarks WHERE id = ?').run(id)
	}

	getBookmarkById(id: string): QueryBookmark | null {
		const row = this.db.prepare('SELECT * FROM query_bookmarks WHERE id = ?').get(id) as BookmarkRow | null
		return row ? rowToBookmark(row) : null
	}

	// ── Workspace ────────────────────────────────────────────

	saveWorkspace(data: string): void {
		this.db.prepare(
			"INSERT INTO workspace (id, data, updated_at) VALUES ('default', ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')",
		).run(data)
	}

	loadWorkspace(): string | null {
		const row = this.db.prepare("SELECT data FROM workspace WHERE id = 'default'").get() as { data: string } | null
		return row?.data ?? null
	}
}

// ── Row types (SQLite column names) ──────────────────────────

interface ConnectionRow {
	id: string
	name: string
	type: string
	config: string
	read_only: number
	color: string | null
	group_name: string | null
	created_at: string
	updated_at: string
}

interface SavedViewRow {
	id: string
	connection_id: string
	schema_name: string
	table_name: string
	name: string
	config: string
	created_at: string
	updated_at: string
}

interface HistoryRow {
	id: number
	connection_id: string
	database: string | null
	sql: string
	status: string
	duration_ms: number | null
	row_count: number | null
	error_message: string | null
	executed_at: string
}

interface BookmarkRow {
	id: string
	connection_id: string
	database: string | null
	name: string
	description: string
	sql: string
	created_at: string
	updated_at: string
}

// ── Row-to-domain mappers ────────────────────────────────────

function safeJsonParse<T>(json: string, context: string): T {
	try {
		return JSON.parse(json) as T
	} catch {
		throw new Error(`Corrupted JSON in ${context}: ${json.slice(0, 100)}`)
	}
}

function rowToSavedView(row: SavedViewRow): SavedView {
	return {
		id: row.id,
		connectionId: row.connection_id,
		schemaName: row.schema_name,
		tableName: row.table_name,
		name: row.name,
		config: safeJsonParse<SavedViewConfig>(row.config, `saved view "${row.name}"`),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

function rowToBookmark(row: BookmarkRow): QueryBookmark {
	return {
		id: row.id,
		connectionId: row.connection_id,
		database: row.database ?? undefined,
		name: row.name,
		description: row.description,
		sql: row.sql,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

function rowToHistoryEntry(row: HistoryRow): QueryHistoryEntry {
	return {
		id: row.id,
		connectionId: row.connection_id,
		database: row.database ?? undefined,
		sql: row.sql,
		status: row.status as QueryHistoryStatus,
		durationMs: row.duration_ms ?? undefined,
		rowCount: row.row_count ?? undefined,
		errorMessage: row.error_message ?? undefined,
		executedAt: row.executed_at,
	}
}

// ── Default DB path ──────────────────────────────────────────

let defaultDbPathFn: (() => string) | undefined

/** Register a factory for the default DB path (call once from the app entry point). */
export function setDefaultDbPath(fn: () => string) {
	defaultDbPathFn = fn
}

function getDefaultDbPath(): string {
	if (!defaultDbPathFn) {
		throw new Error('Default DB path not configured. Call setDefaultDbPath() first.')
	}
	return defaultDbPathFn()
}
