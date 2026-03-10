/**
 * SqliteCompat adapter for sql.js (WASM SQLite).
 * No native compilation needed — works in any Node.js/Electron environment.
 * Data is persisted to disk on each write operation.
 */
import type { SqliteCompat, SqliteStatement } from '@dotaz/backend-shared/storage/sqlite-compat'
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { readFileSync, writeFileSync } from 'node:fs'

export async function createSqlJsSqlite(dbPath: string): Promise<SqliteCompat> {
	const SQL = await initSqlJs()

	let db: SqlJsDatabase
	try {
		const buf = readFileSync(dbPath)
		db = new SQL.Database(buf)
	} catch {
		db = new SQL.Database()
	}

	let inTransaction = false

	function persist() {
		const data = db.export()
		writeFileSync(dbPath, data)
	}

	/** Detect transaction control statements. */
	function txControl(sql: string): 'begin' | 'commit' | 'rollback' | null {
		const t = sql.trimStart().toUpperCase()
		if (t.startsWith('BEGIN')) return 'begin'
		if (t.startsWith('COMMIT') || t.startsWith('END')) return 'commit'
		if (t.startsWith('ROLLBACK')) return 'rollback'
		return null
	}

	return {
		exec(sql: string): void {
			db.run(sql)
			const tc = txControl(sql)
			if (tc === 'begin') {
				inTransaction = true
			} else if (tc === 'commit') {
				inTransaction = false
				persist()
			} else if (tc === 'rollback') {
				inTransaction = false
			} else if (!inTransaction) {
				persist()
			}
		},

		prepare(sql: string): SqliteStatement {
			const stmt = db.prepare(sql)

			return {
				run(...params: unknown[]): unknown {
					stmt.bind(params as any[])
					stmt.step()
					stmt.free()
					if (!inTransaction) persist()
					return undefined
				},

				get(...params: unknown[]): unknown {
					stmt.bind(params as any[])
					let result: Record<string, unknown> | undefined
					if (stmt.step()) {
						result = stmt.getAsObject() as Record<string, unknown>
					}
					stmt.reset()
					return result
				},

				all(...params: unknown[]): unknown[] {
					stmt.bind(params as any[])
					const rows: Record<string, unknown>[] = []
					while (stmt.step()) {
						rows.push(stmt.getAsObject() as Record<string, unknown>)
					}
					stmt.reset()
					return rows
				},
			}
		},

		transaction<T>(fn: () => T): () => T {
			return () => {
				db.run('BEGIN')
				inTransaction = true
				try {
					const result = fn()
					db.run('COMMIT')
					inTransaction = false
					persist()
					return result
				} catch (e) {
					db.run('ROLLBACK')
					inTransaction = false
					throw e
				}
			}
		},

		close(): void {
			db.close()
		},
	}
}
