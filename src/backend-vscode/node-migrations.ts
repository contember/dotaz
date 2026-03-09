import type Database from 'better-sqlite3'

export interface Migration {
	version: number
	description: string
	up: (db: Database.Database) => void
}

const migrations: Migration[] = [
	{
		version: 1,
		description: 'Create connections, query_history, saved_views, settings tables',
		up: (db) => {
			db.exec(`
				CREATE TABLE connections (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					type TEXT NOT NULL CHECK(type IN ('postgresql', 'sqlite')),
					config TEXT NOT NULL,
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					updated_at TEXT NOT NULL DEFAULT (datetime('now'))
				)
			`)

			db.exec(`
				CREATE TABLE query_history (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					connection_id TEXT NOT NULL,
					sql TEXT NOT NULL,
					status TEXT NOT NULL CHECK(status IN ('success', 'error')),
					duration_ms INTEGER,
					row_count INTEGER,
					error_message TEXT,
					executed_at TEXT NOT NULL DEFAULT (datetime('now')),
					FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
				)
			`)

			db.exec(`
				CREATE TABLE saved_views (
					id TEXT PRIMARY KEY,
					connection_id TEXT NOT NULL,
					schema_name TEXT NOT NULL,
					table_name TEXT NOT NULL,
					name TEXT NOT NULL,
					config TEXT NOT NULL,
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					updated_at TEXT NOT NULL DEFAULT (datetime('now')),
					FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
				)
			`)

			db.exec(`
				CREATE TABLE settings (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL
				)
			`)
		},
	},
	{
		version: 2,
		description: 'Migrate SSL boolean to SSLMode string in connection configs',
		up: (db) => {
			const rows = db.prepare("SELECT id, config FROM connections WHERE type = 'postgresql' OR type = 'mysql'").all() as { id: string; config: string }[]
			const update = db.prepare('UPDATE connections SET config = ? WHERE id = ?')
			for (const row of rows) {
				const config = JSON.parse(row.config)
				if (typeof config.ssl === 'boolean') {
					config.ssl = config.ssl ? 'require' : 'disable'
					update.run(JSON.stringify(config), row.id)
				}
			}
		},
	},
	{
		version: 3,
		description: 'Add read_only column to connections table',
		up: (db) => {
			db.exec('ALTER TABLE connections ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0')
		},
	},
	{
		version: 4,
		description: 'Create query_bookmarks table',
		up: (db) => {
			db.exec(`
				CREATE TABLE query_bookmarks (
					id TEXT PRIMARY KEY,
					connection_id TEXT NOT NULL,
					name TEXT NOT NULL,
					description TEXT NOT NULL DEFAULT '',
					sql TEXT NOT NULL,
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					updated_at TEXT NOT NULL DEFAULT (datetime('now')),
					FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
				)
			`)
		},
	},
	{
		version: 5,
		description: 'Add color column to connections table',
		up: (db) => {
			db.exec('ALTER TABLE connections ADD COLUMN color TEXT DEFAULT NULL')
		},
	},
	{
		version: 6,
		description: 'Create workspace table for session persistence',
		up: (db) => {
			db.exec(`
				CREATE TABLE workspace (
					id TEXT PRIMARY KEY DEFAULT 'default',
					data TEXT NOT NULL,
					updated_at TEXT NOT NULL DEFAULT (datetime('now'))
				)
			`)
		},
	},
	{
		version: 7,
		description: 'Add database column to query_history and query_bookmarks',
		up: (db) => {
			db.exec('ALTER TABLE query_history ADD COLUMN database TEXT DEFAULT NULL')
			db.exec('ALTER TABLE query_bookmarks ADD COLUMN database TEXT DEFAULT NULL')
		},
	},
	{
		version: 8,
		description: 'Add group_name column to connections table',
		up: (db) => {
			db.exec('ALTER TABLE connections ADD COLUMN group_name TEXT DEFAULT NULL')
		},
	},
]

function ensureSchemaVersionTable(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`)
}

function getCurrentVersion(db: Database.Database): number {
	const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null } | undefined
	return row?.version ?? 0
}

export function runMigrations(db: Database.Database): number {
	ensureSchemaVersionTable(db)

	const currentVersion = getCurrentVersion(db)
	const pending = migrations.filter((m) => m.version > currentVersion)

	for (const migration of pending) {
		db.exec('BEGIN')
		try {
			migration.up(db)
			db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
			db.exec('COMMIT')
		} catch (err) {
			db.exec('ROLLBACK')
			throw err
		}
	}

	return pending.length
}

export function getSchemaVersion(db: Database.Database): number {
	ensureSchemaVersionTable(db)
	return getCurrentVersion(db)
}
