/**
 * Thin compatibility interface abstracting differences between
 * `bun:sqlite` and `better-sqlite3`.
 *
 * Both libraries have nearly identical prepared-statement APIs.
 * The only runtime difference is raw SQL execution:
 *   - bun:sqlite uses `db.run(sql)`
 *   - better-sqlite3 uses `db.exec(sql)`
 *
 * This interface normalizes that so AppDatabase and migrations
 * can be shared across Bun and Node.js environments.
 */
export interface SqliteCompat {
	/** Execute raw SQL without parameters (DDL, PRAGMA, BEGIN/COMMIT/ROLLBACK). */
	exec(sql: string): void
	/** Prepare a parameterized statement. */
	prepare(sql: string): SqliteStatement
	/** Wrap a function in a SQLite transaction. Returns a callable wrapper. */
	transaction<T>(fn: () => T): () => T
	/** Close the database connection. */
	close(): void
}

export interface SqliteStatement {
	run(...params: unknown[]): unknown
	get(...params: unknown[]): unknown
	all(...params: unknown[]): unknown[]
}
