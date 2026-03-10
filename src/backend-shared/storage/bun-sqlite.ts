import Database from 'bun:sqlite'
import type { SqliteCompat, SqliteStatement } from './sqlite-compat'

/** Create a SqliteCompat adapter wrapping a bun:sqlite Database. */
export function createBunSqlite(dbPath: string): SqliteCompat {
	const db = new Database(dbPath, { create: true })
	return {
		exec: (sql) => { db.run(sql) },
		prepare: (sql) => db.prepare(sql) as unknown as SqliteStatement,
		transaction: <T>(fn: () => T) => db.transaction(fn) as unknown as () => T,
		close: () => db.close(),
	}
}
