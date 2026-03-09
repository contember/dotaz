import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { hkdfSync } from 'node:crypto'
import { isEncryptedPassword } from '@dotaz/backend-shared/services/encryption'
import { AppDatabase, DEFAULT_SETTINGS } from '@dotaz/backend-shared/storage/app-db'
import { getSchemaVersion } from '@dotaz/backend-shared/storage/migrations'
import type { PostgresConnectionConfig, SqliteConnectionConfig } from '@dotaz/shared/types/connection'

describe('AppDatabase', () => {
	let appDb: AppDatabase

	beforeEach(() => {
		AppDatabase.resetInstance()
		appDb = AppDatabase.getInstance(':memory:')
	})

	afterEach(() => {
		AppDatabase.resetInstance()
	})

	// ── Singleton ────────────────────────────────────────────

	test('getInstance returns same instance on multiple calls', () => {
		const a = AppDatabase.getInstance()
		const b = AppDatabase.getInstance()
		expect(a).toBe(b)
	})

	// ── Migrations ───────────────────────────────────────────

	test('migrations run automatically on initialization', () => {
		const version = getSchemaVersion(appDb.db)
		expect(version).toBe(8)
	})

	test('schema_version table tracks current version', () => {
		const rows = appDb.db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[]
		expect(rows.map(r => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
	})

	test('migration 002 converts boolean SSL to SSLMode string', () => {
		// Simulate a pre-migration connection with boolean ssl by inserting raw JSON
		const now = new Date().toISOString()
		const boolTrueConfig = JSON.stringify({ type: 'postgresql', host: 'h', port: 5432, database: 'd', user: 'u', password: 'p', ssl: true })
		const boolFalseConfig = JSON.stringify({ type: 'postgresql', host: 'h', port: 5432, database: 'd', user: 'u', password: 'p', ssl: false })
		appDb.db.prepare('INSERT INTO connections (id, name, type, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
			'test-ssl-true',
			'SSL True',
			'postgresql',
			boolTrueConfig,
			now,
			now,
		)
		appDb.db.prepare('INSERT INTO connections (id, name, type, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
			'test-ssl-false',
			'SSL False',
			'postgresql',
			boolFalseConfig,
			now,
			now,
		)

		// Re-run migration 2 manually (it's idempotent for already-migrated data)
		const rows = appDb.db.prepare("SELECT id, config FROM connections WHERE id IN ('test-ssl-true', 'test-ssl-false')").all() as {
			id: string
			config: string
		}[]
		const update = appDb.db.prepare('UPDATE connections SET config = ? WHERE id = ?')
		for (const row of rows) {
			const config = JSON.parse(row.config)
			if (typeof config.ssl === 'boolean') {
				config.ssl = config.ssl ? 'require' : 'disable'
				update.run(JSON.stringify(config), row.id)
			}
		}

		const connTrue = appDb.getConnectionById('test-ssl-true')!
		const connFalse = appDb.getConnectionById('test-ssl-false')!
		expect((connTrue.config as any).ssl).toBe('require')
		expect((connFalse.config as any).ssl).toBe('disable')
	})

	test('all tables are created by migrations', () => {
		const tables = appDb.db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all() as { name: string }[]
		const names = tables.map((t) => t.name)
		expect(names).toContain('connections')
		expect(names).toContain('query_history')
		expect(names).toContain('query_bookmarks')
		expect(names).toContain('saved_views')
		expect(names).toContain('settings')
		expect(names).toContain('schema_version')
	})

	// ── Connections CRUD ─────────────────────────────────────

	describe('connections', () => {
		const pgConfig: PostgresConnectionConfig = {
			type: 'postgresql',
			host: 'localhost',
			port: 5432,
			database: 'mydb',
			user: 'admin',
			password: 'secret',
		}

		const sqliteConfig: SqliteConnectionConfig = {
			type: 'sqlite',
			path: '/tmp/test.db',
		}

		test('create and list connections', () => {
			appDb.createConnection({ name: 'PG Dev', config: pgConfig })
			appDb.createConnection({ name: 'SQLite Local', config: sqliteConfig })

			const list = appDb.listConnections()
			expect(list).toHaveLength(2)
			// Ordered by name
			expect(list[0].name).toBe('PG Dev')
			expect(list[1].name).toBe('SQLite Local')
		})

		test('create returns connection with id and timestamps', () => {
			const conn = appDb.createConnection({ name: 'Test', config: pgConfig })
			expect(conn.id).toBeTruthy()
			expect(conn.name).toBe('Test')
			expect(conn.config).toEqual(pgConfig)
			expect(conn.state).toBe('disconnected')
			expect(conn.createdAt).toBeTruthy()
			expect(conn.updatedAt).toBeTruthy()
		})

		test('getById returns the correct connection', () => {
			const created = appDb.createConnection({ name: 'Lookup', config: pgConfig })
			const found = appDb.getConnectionById(created.id)
			expect(found).not.toBeNull()
			expect(found!.id).toBe(created.id)
			expect(found!.name).toBe('Lookup')
			expect(found!.config).toEqual(pgConfig)
		})

		test('getById returns null for non-existent id', () => {
			const found = appDb.getConnectionById('nonexistent')
			expect(found).toBeNull()
		})

		test('update modifies name and config', () => {
			const created = appDb.createConnection({ name: 'Original', config: pgConfig })
			const updated = appDb.updateConnection({
				id: created.id,
				name: 'Updated',
				config: sqliteConfig,
			})
			expect(updated.name).toBe('Updated')
			expect(updated.config).toEqual(sqliteConfig)
			expect(updated.updatedAt).toBeTruthy()
		})

		test('update throws for non-existent id', () => {
			expect(() => appDb.updateConnection({ id: 'nonexistent', name: 'X', config: pgConfig })).toThrow('Connection not found')
		})

		test('delete removes the connection', () => {
			const created = appDb.createConnection({ name: 'ToDelete', config: pgConfig })
			appDb.deleteConnection(created.id)
			expect(appDb.getConnectionById(created.id)).toBeNull()
			expect(appDb.listConnections()).toHaveLength(0)
		})

		test('config is persisted as JSON and parsed back correctly', () => {
			const conn = appDb.createConnection({ name: 'PG SSL', config: { ...pgConfig, ssl: 'require' } })
			const found = appDb.getConnectionById(conn.id)!
			expect(found.config).toEqual({ ...pgConfig, ssl: 'require' })
		})

		test('create connection with readOnly flag', () => {
			const conn = appDb.createConnection({ name: 'ReadOnly PG', config: pgConfig, readOnly: true })
			expect(conn.readOnly).toBe(true)
			const found = appDb.getConnectionById(conn.id)!
			expect(found.readOnly).toBe(true)
		})

		test('create connection without readOnly defaults to undefined', () => {
			const conn = appDb.createConnection({ name: 'Normal PG', config: pgConfig })
			expect(conn.readOnly).toBeUndefined()
		})

		test('update connection readOnly flag', () => {
			const conn = appDb.createConnection({ name: 'Toggle', config: pgConfig })
			expect(conn.readOnly).toBeUndefined()
			const updated = appDb.updateConnection({ id: conn.id, name: 'Toggle', config: pgConfig, readOnly: true })
			expect(updated.readOnly).toBe(true)
		})

		test('setConnectionReadOnly toggles readOnly', () => {
			const conn = appDb.createConnection({ name: 'SetRO', config: pgConfig })
			expect(conn.readOnly).toBeUndefined()

			const ro = appDb.setConnectionReadOnly(conn.id, true)
			expect(ro.readOnly).toBe(true)

			const rw = appDb.setConnectionReadOnly(conn.id, false)
			expect(rw.readOnly).toBeUndefined()
		})

		test('setConnectionReadOnly throws for non-existent id', () => {
			expect(() => appDb.setConnectionReadOnly('nonexistent', true)).toThrow('Connection not found')
		})

		test('create connection with color', () => {
			const conn = appDb.createConnection({ name: 'Colored PG', config: pgConfig, color: '#ef4444' })
			expect(conn.color).toBe('#ef4444')
			const found = appDb.getConnectionById(conn.id)!
			expect(found.color).toBe('#ef4444')
		})

		test('create connection without color defaults to undefined', () => {
			const conn = appDb.createConnection({ name: 'No Color PG', config: pgConfig })
			expect(conn.color).toBeUndefined()
		})

		test('update connection color', () => {
			const conn = appDb.createConnection({ name: 'Color Toggle', config: pgConfig })
			expect(conn.color).toBeUndefined()
			const updated = appDb.updateConnection({ id: conn.id, name: 'Color Toggle', config: pgConfig, color: '#3b82f6' })
			expect(updated.color).toBe('#3b82f6')
		})

		test('clear connection color by setting to empty string', () => {
			const conn = appDb.createConnection({ name: 'Clear Color', config: pgConfig, color: '#ef4444' })
			expect(conn.color).toBe('#ef4444')
			const updated = appDb.updateConnection({ id: conn.id, name: 'Clear Color', config: pgConfig, color: '' })
			expect(updated.color).toBeUndefined()
		})
	})

	// ── Settings CRUD ────────────────────────────────────────

	describe('settings', () => {
		test('get returns null for non-existent key', () => {
			expect(appDb.getSetting('theme')).toBeNull()
		})

		test('set and get a setting', () => {
			appDb.setSetting('theme', 'dark')
			expect(appDb.getSetting('theme')).toBe('dark')
		})

		test('set overwrites existing setting', () => {
			appDb.setSetting('pageSize', '50')
			appDb.setSetting('pageSize', '100')
			expect(appDb.getSetting('pageSize')).toBe('100')
		})

		test('multiple settings are independent', () => {
			appDb.setSetting('a', '1')
			appDb.setSetting('b', '2')
			expect(appDb.getSetting('a')).toBe('1')
			expect(appDb.getSetting('b')).toBe('2')
		})

		test('getAllSettings returns empty object when no settings', () => {
			expect(appDb.getAllSettings()).toEqual({})
		})

		test('getAllSettings returns all stored settings', () => {
			appDb.setSetting('theme', 'dark')
			appDb.setSetting('pageSize', '50')
			appDb.setSetting('timeout', '5000')
			const all = appDb.getAllSettings()
			expect(all).toEqual({
				theme: 'dark',
				pageSize: '50',
				timeout: '5000',
			})
		})

		test('getAllSettings reflects updates', () => {
			appDb.setSetting('theme', 'dark')
			appDb.setSetting('theme', 'light')
			const all = appDb.getAllSettings()
			expect(all.theme).toBe('light')
		})
	})

	// ── Saved Views CRUD ─────────────────────────────────────

	describe('saved views', () => {
		let connectionId: string

		beforeEach(() => {
			const conn = appDb.createConnection({
				name: 'Test',
				config: { type: 'sqlite', path: ':memory:' },
			})
			connectionId = conn.id
		})

		test('create and list saved views', () => {
			appDb.createSavedView({
				connectionId,
				schemaName: 'public',
				tableName: 'users',
				name: 'Active Users',
				config: { columns: ['id', 'name'], sort: [{ column: 'name', direction: 'asc' }] },
			})

			const views = appDb.listSavedViews(connectionId, 'public', 'users')
			expect(views).toHaveLength(1)
			expect(views[0].name).toBe('Active Users')
			expect(views[0].config.columns).toEqual(['id', 'name'])
		})

		test('list filters by connection, schema, and table', () => {
			appDb.createSavedView({
				connectionId,
				schemaName: 'public',
				tableName: 'users',
				name: 'View 1',
				config: {},
			})
			appDb.createSavedView({
				connectionId,
				schemaName: 'public',
				tableName: 'posts',
				name: 'View 2',
				config: {},
			})

			expect(appDb.listSavedViews(connectionId, 'public', 'users')).toHaveLength(1)
			expect(appDb.listSavedViews(connectionId, 'public', 'posts')).toHaveLength(1)
			expect(appDb.listSavedViews(connectionId, 'other', 'users')).toHaveLength(0)
		})

		test('update modifies name and config', () => {
			const view = appDb.createSavedView({
				connectionId,
				schemaName: 'public',
				tableName: 'users',
				name: 'Original',
				config: {},
			})

			const updated = appDb.updateSavedView({
				id: view.id,
				name: 'Renamed',
				config: { columns: ['email'] },
			})
			expect(updated.name).toBe('Renamed')
			expect(updated.config.columns).toEqual(['email'])
		})

		test('update throws for non-existent id', () => {
			expect(() => appDb.updateSavedView({ id: 'nonexistent', name: 'X', config: {} })).toThrow('Saved view not found')
		})

		test('delete removes the saved view', () => {
			const view = appDb.createSavedView({
				connectionId,
				schemaName: 'public',
				tableName: 'users',
				name: 'ToDelete',
				config: {},
			})
			appDb.deleteSavedView(view.id)
			expect(appDb.listSavedViews(connectionId, 'public', 'users')).toHaveLength(0)
		})

		test('cascade delete removes views when connection is deleted', () => {
			appDb.createSavedView({
				connectionId,
				schemaName: 'public',
				tableName: 'users',
				name: 'View',
				config: {},
			})
			appDb.deleteConnection(connectionId)
			expect(appDb.listSavedViews(connectionId, 'public', 'users')).toHaveLength(0)
		})
	})

	// ── History ───────────────────────────────────────────────

	describe('history', () => {
		let connectionId: string

		beforeEach(() => {
			const conn = appDb.createConnection({
				name: 'Test',
				config: { type: 'sqlite', path: ':memory:' },
			})
			connectionId = conn.id
		})

		test('add and list history entries', () => {
			appDb.addHistory({
				connectionId,
				sql: 'SELECT 1',
				status: 'success',
				durationMs: 10,
				rowCount: 1,
			})
			appDb.addHistory({
				connectionId,
				sql: 'SELECT invalid',
				status: 'error',
				errorMessage: 'syntax error',
			})

			const entries = appDb.listHistory({})
			expect(entries).toHaveLength(2)
			const statuses = entries.map((e) => e.status)
			expect(statuses).toContain('success')
			expect(statuses).toContain('error')
		})

		test('add returns the created entry', () => {
			const entry = appDb.addHistory({
				connectionId,
				sql: 'SELECT 1',
				status: 'success',
				durationMs: 5,
				rowCount: 1,
			})
			expect(entry.id).toBeTruthy()
			expect(entry.connectionId).toBe(connectionId)
			expect(entry.sql).toBe('SELECT 1')
			expect(entry.status).toBe('success')
			expect(entry.durationMs).toBe(5)
			expect(entry.rowCount).toBe(1)
			expect(entry.executedAt).toBeTruthy()
		})

		test('list filters by connectionId', () => {
			const conn2 = appDb.createConnection({
				name: 'Other',
				config: { type: 'sqlite', path: '/tmp/other.db' },
			})
			appDb.addHistory({ connectionId, sql: 'SELECT 1', status: 'success' })
			appDb.addHistory({ connectionId: conn2.id, sql: 'SELECT 2', status: 'success' })

			const filtered = appDb.listHistory({ connectionId })
			expect(filtered).toHaveLength(1)
			expect(filtered[0].sql).toBe('SELECT 1')
		})

		test('list supports limit and offset', () => {
			for (let i = 0; i < 5; i++) {
				appDb.addHistory({ connectionId, sql: `SELECT ${i}`, status: 'success' })
			}

			const page1 = appDb.listHistory({ limit: 2, offset: 0 })
			expect(page1).toHaveLength(2)

			const page2 = appDb.listHistory({ limit: 2, offset: 2 })
			expect(page2).toHaveLength(2)

			const page3 = appDb.listHistory({ limit: 2, offset: 4 })
			expect(page3).toHaveLength(1)
		})

		test('clear removes all history', () => {
			appDb.addHistory({ connectionId, sql: 'SELECT 1', status: 'success' })
			appDb.addHistory({ connectionId, sql: 'SELECT 2', status: 'success' })
			appDb.clearHistory()
			expect(appDb.listHistory({})).toHaveLength(0)
		})

		test("clear with connectionId removes only that connection's history", () => {
			const conn2 = appDb.createConnection({
				name: 'Other',
				config: { type: 'sqlite', path: '/tmp/other.db' },
			})
			appDb.addHistory({ connectionId, sql: 'SELECT 1', status: 'success' })
			appDb.addHistory({ connectionId: conn2.id, sql: 'SELECT 2', status: 'success' })

			appDb.clearHistory(connectionId)
			const remaining = appDb.listHistory({})
			expect(remaining).toHaveLength(1)
			expect(remaining[0].connectionId).toBe(conn2.id)
		})

		test('cascade delete removes history when connection is deleted', () => {
			appDb.addHistory({ connectionId, sql: 'SELECT 1', status: 'success' })
			appDb.deleteConnection(connectionId)
			expect(appDb.listHistory({ connectionId })).toHaveLength(0)
		})

		test('optional fields can be undefined', () => {
			const entry = appDb.addHistory({
				connectionId,
				sql: 'SELECT 1',
				status: 'success',
			})
			expect(entry.durationMs).toBeUndefined()
			expect(entry.rowCount).toBeUndefined()
			expect(entry.errorMessage).toBeUndefined()
		})

		test('list supports search in SQL text', () => {
			appDb.addHistory({ connectionId, sql: 'SELECT * FROM users', status: 'success' })
			appDb.addHistory({ connectionId, sql: 'INSERT INTO users VALUES (1)', status: 'success' })
			appDb.addHistory({ connectionId, sql: 'SELECT * FROM orders', status: 'success' })

			const results = appDb.listHistory({ search: 'users' })
			expect(results).toHaveLength(2)

			const selectOnly = appDb.listHistory({ search: 'SELECT' })
			expect(selectOnly).toHaveLength(2)

			const insertOnly = appDb.listHistory({ search: 'INSERT' })
			expect(insertOnly).toHaveLength(1)
			expect(insertOnly[0].sql).toBe('INSERT INTO users VALUES (1)')
		})

		test('list combines connectionId and search filters', () => {
			const conn2 = appDb.createConnection({
				name: 'Other',
				config: { type: 'sqlite', path: '/tmp/other.db' },
			})
			appDb.addHistory({ connectionId, sql: 'SELECT * FROM users', status: 'success' })
			appDb.addHistory({ connectionId: conn2.id, sql: 'SELECT * FROM users', status: 'success' })

			const filtered = appDb.listHistory({ connectionId, search: 'users' })
			expect(filtered).toHaveLength(1)
			expect(filtered[0].connectionId).toBe(connectionId)
		})

		test('list filters by startDate (inclusive)', () => {
			// Insert entries with specific timestamps via raw SQL
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT old', 'success', '2025-01-10 12:00:00')
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT boundary', 'success', '2025-01-15 00:00:00')
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT new', 'success', '2025-01-20 12:00:00')

			const results = appDb.listHistory({ startDate: '2025-01-15' })
			expect(results).toHaveLength(2)
			const sqls = results.map((e) => e.sql)
			expect(sqls).toContain('SELECT boundary')
			expect(sqls).toContain('SELECT new')
		})

		test('list filters by endDate (inclusive)', () => {
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT early', 'success', '2025-02-10 08:00:00')
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT end-of-day', 'success', '2025-02-15 23:59:59')
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT later', 'success', '2025-02-16 00:00:01')

			const results = appDb.listHistory({ endDate: '2025-02-15' })
			expect(results).toHaveLength(2)
			const sqls = results.map((e) => e.sql)
			expect(sqls).toContain('SELECT early')
			expect(sqls).toContain('SELECT end-of-day')
		})

		test('list filters by startDate and endDate combined (date range)', () => {
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT before', 'success', '2025-03-01 12:00:00')
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT inside', 'success', '2025-03-05 14:30:00')
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT after', 'success', '2025-03-15 09:00:00')

			const results = appDb.listHistory({ startDate: '2025-03-03', endDate: '2025-03-10' })
			expect(results).toHaveLength(1)
			expect(results[0].sql).toBe('SELECT inside')
		})

		test('date range combines with search and connectionId', () => {
			const conn2 = appDb.createConnection({
				name: 'Other',
				config: { type: 'sqlite', path: '/tmp/other.db' },
			})
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT * FROM users', 'success', '2025-04-05 12:00:00')
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT * FROM orders', 'success', '2025-04-05 13:00:00')
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(conn2.id, 'SELECT * FROM users', 'success', '2025-04-05 14:00:00')
			appDb.db.prepare(
				'INSERT INTO query_history (connection_id, sql, status, executed_at) VALUES (?, ?, ?, ?)',
			).run(connectionId, 'SELECT * FROM users', 'success', '2025-04-10 12:00:00')

			const results = appDb.listHistory({
				connectionId,
				search: 'users',
				startDate: '2025-04-01',
				endDate: '2025-04-07',
			})
			expect(results).toHaveLength(1)
			expect(results[0].sql).toBe('SELECT * FROM users')
			expect(results[0].connectionId).toBe(connectionId)
		})
	})

	// ── Password encryption ──────────────────────────────────

	describe('password encryption', () => {
		const testKey = new Uint8Array(
			hkdfSync('sha256', 'test-machine-data', 'dotaz-local-salt', 'dotaz-local-key', 32),
		)

		const pgConfig: PostgresConnectionConfig = {
			type: 'postgresql',
			host: 'localhost',
			port: 5432,
			database: 'mydb',
			user: 'admin',
			password: 'secret-password',
		}

		test('password is encrypted in raw DB when localKey is set', () => {
			appDb.setLocalKey(testKey)
			const conn = appDb.createConnection({ name: 'Encrypted', config: pgConfig })

			// Read raw config from SQLite
			const row = appDb.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id) as { config: string }
			const rawConfig = JSON.parse(row.config)
			expect(rawConfig.password).not.toBe('secret-password')
			expect(isEncryptedPassword(rawConfig.password)).toBe(true)
		})

		test('password is decrypted when reading via API', () => {
			appDb.setLocalKey(testKey)
			const conn = appDb.createConnection({ name: 'Encrypted', config: pgConfig })

			const found = appDb.getConnectionById(conn.id)!
			expect(found.config).toEqual(pgConfig)
			expect((found.config as PostgresConnectionConfig).password).toBe('secret-password')
		})

		test('listConnections returns decrypted passwords', () => {
			appDb.setLocalKey(testKey)
			appDb.createConnection({ name: 'PG1', config: pgConfig })

			const list = appDb.listConnections()
			expect(list).toHaveLength(1)
			expect((list[0].config as PostgresConnectionConfig).password).toBe('secret-password')
		})

		test('updateConnection encrypts the new password', () => {
			appDb.setLocalKey(testKey)
			const conn = appDb.createConnection({ name: 'Original', config: pgConfig })

			const newConfig = { ...pgConfig, password: 'new-secret' }
			appDb.updateConnection({ id: conn.id, name: 'Updated', config: newConfig })

			// Raw DB should have encrypted password
			const row = appDb.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id) as { config: string }
			const rawConfig = JSON.parse(row.config)
			expect(isEncryptedPassword(rawConfig.password)).toBe(true)

			// API should return decrypted
			const found = appDb.getConnectionById(conn.id)!
			expect((found.config as PostgresConnectionConfig).password).toBe('new-secret')
		})

		test('SQLite connections are not affected by encryption', () => {
			appDb.setLocalKey(testKey)
			const sqliteConfig: SqliteConnectionConfig = { type: 'sqlite', path: '/tmp/test.db' }
			const conn = appDb.createConnection({ name: 'SQLite', config: sqliteConfig })

			const found = appDb.getConnectionById(conn.id)!
			expect(found.config).toEqual(sqliteConfig)
		})

		test('transparent migration encrypts existing plaintext passwords', () => {
			// Insert a connection WITHOUT encryption (no localKey yet)
			const conn = appDb.createConnection({ name: 'Plaintext', config: pgConfig })

			// Verify it's stored as plaintext
			const rowBefore = appDb.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id) as { config: string }
			expect(JSON.parse(rowBefore.config).password).toBe('secret-password')

			// Now set the local key — should migrate existing passwords
			appDb.setLocalKey(testKey)

			// Raw DB should now have encrypted password
			const rowAfter = appDb.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id) as { config: string }
			const rawConfig = JSON.parse(rowAfter.config)
			expect(isEncryptedPassword(rawConfig.password)).toBe(true)

			// API should still return decrypted password
			const found = appDb.getConnectionById(conn.id)!
			expect((found.config as PostgresConnectionConfig).password).toBe('secret-password')
		})

		test('without localKey, passwords are stored as plaintext', () => {
			// Don't set localKey
			const conn = appDb.createConnection({ name: 'NoKey', config: pgConfig })

			const row = appDb.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id) as { config: string }
			expect(JSON.parse(row.config).password).toBe('secret-password')

			const found = appDb.getConnectionById(conn.id)!
			expect((found.config as PostgresConnectionConfig).password).toBe('secret-password')
		})
	})

	// ── Transaction ──────────────────────────────────────────

	describe('transaction', () => {
		test('commits on success', () => {
			appDb.transaction(() => {
				appDb.setSetting('txKey', 'txValue')
			})
			expect(appDb.getSetting('txKey')).toBe('txValue')
		})

		test('rolls back on error', () => {
			appDb.setSetting('rollbackKey', 'original')
			try {
				appDb.transaction(() => {
					appDb.setSetting('rollbackKey', 'changed')
					throw new Error('simulated failure')
				})
			} catch {
				// expected
			}
			expect(appDb.getSetting('rollbackKey')).toBe('original')
		})

		test('re-throws the original error', () => {
			expect(() =>
				appDb.transaction(() => {
					throw new Error('test error')
				})
			).toThrow('test error')
		})

		test('returns the value from the function', () => {
			const result = appDb.transaction(() => 42)
			expect(result).toBe(42)
		})
	})

	// ── Typed settings ───────────────────────────────────────

	describe('typed settings', () => {
		test('getNumberSetting returns number for valid numeric string', () => {
			appDb.setSetting('pageSize', '50')
			expect(appDb.getNumberSetting('pageSize')).toBe(50)
		})

		test('getNumberSetting returns null for non-numeric string', () => {
			appDb.setSetting('bad', 'abc')
			expect(appDb.getNumberSetting('bad')).toBeNull()
		})

		test('getNumberSetting falls back to DEFAULT_SETTINGS', () => {
			expect(appDb.getNumberSetting('defaultPageSize')).toBe(Number(DEFAULT_SETTINGS.defaultPageSize))
		})

		test('getNumberSetting returns null for unknown key without default', () => {
			expect(appDb.getNumberSetting('nonexistent')).toBeNull()
		})

		test("getBooleanSetting returns true for 'true'", () => {
			appDb.setSetting('flag', 'true')
			expect(appDb.getBooleanSetting('flag')).toBe(true)
		})

		test("getBooleanSetting returns false for 'false'", () => {
			appDb.setSetting('flag', 'false')
			expect(appDb.getBooleanSetting('flag')).toBe(false)
		})

		test('getBooleanSetting returns null for non-boolean string', () => {
			appDb.setSetting('flag', 'maybe')
			expect(appDb.getBooleanSetting('flag')).toBeNull()
		})

		test('getBooleanSetting falls back to DEFAULT_SETTINGS', () => {
			expect(appDb.getBooleanSetting('clipboardIncludeHeaders')).toBe(true)
		})

		test('getBooleanSetting returns null for unknown key without default', () => {
			expect(appDb.getBooleanSetting('nonexistent')).toBeNull()
		})
	})

	// ── History pruning ──────────────────────────────────────

	describe('history pruning', () => {
		let connectionId: string

		beforeEach(() => {
			const conn = appDb.createConnection({
				name: 'Test',
				config: { type: 'sqlite', path: ':memory:' },
			})
			connectionId = conn.id
		})

		test('prunes oldest entries when exceeding maxHistoryEntries', () => {
			appDb.setSetting('maxHistoryEntries', '5')

			for (let i = 0; i < 7; i++) {
				appDb.addHistory({ connectionId, sql: `SELECT ${i}`, status: 'success' })
			}

			const entries = appDb.listHistory({})
			expect(entries).toHaveLength(5)
			// Should keep the newest 5 (indices 2-6)
			const sqls = entries.map(e => e.sql)
			expect(sqls).not.toContain('SELECT 0')
			expect(sqls).not.toContain('SELECT 1')
			expect(sqls).toContain('SELECT 6')
		})

		test('does not prune when under limit', () => {
			appDb.setSetting('maxHistoryEntries', '10')

			for (let i = 0; i < 5; i++) {
				appDb.addHistory({ connectionId, sql: `SELECT ${i}`, status: 'success' })
			}

			const entries = appDb.listHistory({})
			expect(entries).toHaveLength(5)
		})

		test('uses default maxHistoryEntries when not explicitly set', () => {
			// Default is 1000, so 5 entries should be fine
			for (let i = 0; i < 5; i++) {
				appDb.addHistory({ connectionId, sql: `SELECT ${i}`, status: 'success' })
			}

			const entries = appDb.listHistory({})
			expect(entries).toHaveLength(5)
		})
	})

	// ── Bookmarks CRUD ──────────────────────────────────────

	describe('bookmarks', () => {
		let connectionId: string

		beforeEach(() => {
			const conn = appDb.createConnection({
				name: 'Test',
				config: { type: 'sqlite', path: ':memory:' },
			})
			connectionId = conn.id
		})

		test('create and list bookmarks', () => {
			appDb.createBookmark({
				connectionId,
				name: 'Active Users',
				sql: 'SELECT * FROM users WHERE active = true',
			})
			appDb.createBookmark({
				connectionId,
				name: 'Recent Orders',
				sql: 'SELECT * FROM orders ORDER BY created_at DESC LIMIT 10',
			})

			const list = appDb.listBookmarks(connectionId)
			expect(list).toHaveLength(2)
			// Ordered by name
			expect(list[0].name).toBe('Active Users')
			expect(list[1].name).toBe('Recent Orders')
		})

		test('create returns bookmark with id and timestamps', () => {
			const bookmark = appDb.createBookmark({
				connectionId,
				name: 'Test Query',
				description: 'A test bookmark',
				sql: 'SELECT 1',
			})
			expect(bookmark.id).toBeTruthy()
			expect(bookmark.connectionId).toBe(connectionId)
			expect(bookmark.name).toBe('Test Query')
			expect(bookmark.description).toBe('A test bookmark')
			expect(bookmark.sql).toBe('SELECT 1')
			expect(bookmark.createdAt).toBeTruthy()
			expect(bookmark.updatedAt).toBeTruthy()
		})

		test('create with no description defaults to empty string', () => {
			const bookmark = appDb.createBookmark({
				connectionId,
				name: 'No Desc',
				sql: 'SELECT 1',
			})
			expect(bookmark.description).toBe('')
		})

		test('getBookmarkById returns the correct bookmark', () => {
			const created = appDb.createBookmark({
				connectionId,
				name: 'Lookup',
				sql: 'SELECT * FROM products',
			})
			const found = appDb.getBookmarkById(created.id)
			expect(found).not.toBeNull()
			expect(found!.id).toBe(created.id)
			expect(found!.name).toBe('Lookup')
		})

		test('getBookmarkById returns null for non-existent id', () => {
			const found = appDb.getBookmarkById('nonexistent')
			expect(found).toBeNull()
		})

		test('update modifies name, description, and sql', () => {
			const created = appDb.createBookmark({
				connectionId,
				name: 'Original',
				sql: 'SELECT 1',
			})
			const updated = appDb.updateBookmark({
				id: created.id,
				name: 'Updated',
				description: 'Updated description',
				sql: 'SELECT 2',
			})
			expect(updated.name).toBe('Updated')
			expect(updated.description).toBe('Updated description')
			expect(updated.sql).toBe('SELECT 2')
			expect(updated.updatedAt).toBeTruthy()
		})

		test('update throws for non-existent id', () => {
			expect(() => appDb.updateBookmark({ id: 'nonexistent', name: 'X', sql: 'SELECT 1' })).toThrow('Bookmark not found')
		})

		test('delete removes the bookmark', () => {
			const created = appDb.createBookmark({
				connectionId,
				name: 'ToDelete',
				sql: 'SELECT 1',
			})
			appDb.deleteBookmark(created.id)
			expect(appDb.listBookmarks(connectionId)).toHaveLength(0)
		})

		test('list filters by connectionId', () => {
			const conn2 = appDb.createConnection({
				name: 'Other',
				config: { type: 'sqlite', path: '/tmp/other.db' },
			})
			appDb.createBookmark({ connectionId, name: 'BM1', sql: 'SELECT 1' })
			appDb.createBookmark({ connectionId: conn2.id, name: 'BM2', sql: 'SELECT 2' })

			expect(appDb.listBookmarks(connectionId)).toHaveLength(1)
			expect(appDb.listBookmarks(conn2.id)).toHaveLength(1)
		})

		test('list supports search by name and sql', () => {
			appDb.createBookmark({ connectionId, name: 'Active Users', sql: 'SELECT * FROM users' })
			appDb.createBookmark({ connectionId, name: 'Recent Orders', sql: 'SELECT * FROM orders' })
			appDb.createBookmark({ connectionId, name: 'Products', sql: 'SELECT * FROM products' })

			// Search by name
			const byName = appDb.listBookmarks(connectionId, 'active')
			expect(byName).toHaveLength(1)
			expect(byName[0].name).toBe('Active Users')

			// Search by SQL
			const bySql = appDb.listBookmarks(connectionId, 'orders')
			expect(bySql).toHaveLength(1)
			expect(bySql[0].name).toBe('Recent Orders')

			// No match
			const noMatch = appDb.listBookmarks(connectionId, 'nonexistent')
			expect(noMatch).toHaveLength(0)
		})

		test('cascade delete removes bookmarks when connection is deleted', () => {
			appDb.createBookmark({
				connectionId,
				name: 'Cascade Test',
				sql: 'SELECT 1',
			})
			appDb.deleteConnection(connectionId)
			expect(appDb.listBookmarks(connectionId)).toHaveLength(0)
		})
	})

	// ── Workspace persistence ────────────────────────────────

	describe('workspace', () => {
		test('loadWorkspace returns null when no workspace saved', () => {
			expect(appDb.loadWorkspace()).toBeNull()
		})

		test('saveWorkspace and loadWorkspace round-trip', () => {
			const data = JSON.stringify({
				tabs: [{ id: 'tab-1', type: 'sql-console', title: 'SQL', connectionId: 'conn-1' }],
				activeTabId: 'tab-1',
				layout: { sidebarWidth: 250, sidebarCollapsed: false },
			})
			appDb.saveWorkspace(data)
			expect(appDb.loadWorkspace()).toBe(data)
		})

		test('saveWorkspace overwrites previous workspace', () => {
			appDb.saveWorkspace('{"tabs":[],"activeTabId":null,"layout":{"sidebarWidth":200,"sidebarCollapsed":false}}')
			const updated =
				'{"tabs":[{"id":"t1","type":"data-grid","title":"Users","connectionId":"c1"}],"activeTabId":"t1","layout":{"sidebarWidth":300,"sidebarCollapsed":true}}'
			appDb.saveWorkspace(updated)
			expect(appDb.loadWorkspace()).toBe(updated)
		})

		test('workspace table is created by migration v6', () => {
			const tables = appDb.db.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='workspace'",
			).all() as { name: string }[]
			expect(tables).toHaveLength(1)
		})
	})
})
