import type { Database } from "bun:sqlite";

export interface Migration {
	version: number;
	description: string;
	up: (db: Database) => void;
}

const migrations: Migration[] = [
	{
		version: 1,
		description: "Create connections, query_history, saved_views, settings tables",
		up: (db) => {
			db.run(`
				CREATE TABLE connections (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					type TEXT NOT NULL CHECK(type IN ('postgresql', 'sqlite')),
					config TEXT NOT NULL,
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					updated_at TEXT NOT NULL DEFAULT (datetime('now'))
				)
			`);

			db.run(`
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
			`);

			db.run(`
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
			`);

			db.run(`
				CREATE TABLE settings (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL
				)
			`);
		},
	},
];

/**
 * Ensure the schema_version table exists.
 */
function ensureSchemaVersionTable(db: Database): void {
	db.run(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);
}

/**
 * Get the current schema version from the database.
 */
function getCurrentVersion(db: Database): number {
	const row = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as { version: number | null } | null;
	return row?.version ?? 0;
}

/**
 * Run all pending migrations on the database.
 * Returns the number of migrations applied.
 */
export function runMigrations(db: Database): number {
	ensureSchemaVersionTable(db);

	const currentVersion = getCurrentVersion(db);
	const pending = migrations.filter((m) => m.version > currentVersion);

	for (const migration of pending) {
		db.run("BEGIN");
		try {
			migration.up(db);
			db.run("INSERT INTO schema_version (version) VALUES (?)", [migration.version]);
			db.run("COMMIT");
		} catch (err) {
			db.run("ROLLBACK");
			throw err;
		}
	}

	return pending.length;
}

/**
 * Get the current schema version (exposed for testing).
 */
export function getSchemaVersion(db: Database): number {
	ensureSchemaVersionTable(db);
	return getCurrentVersion(db);
}
