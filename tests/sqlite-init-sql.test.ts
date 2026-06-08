/**
 * Tests for per-connection setup SQL (`initSql`) on SqliteDriver.
 *
 * SQLite has no connection pool/reset, so initSql is plain per-connection setup.
 * These prove it runs on the main connection (and any pinned session, which shares
 * it) and — importantly — on the *separate* read connection that iterate() opens
 * for file-based databases.
 *
 * No external services required (in-memory + a temp file).
 *
 * Run: bun test tests/sqlite-init-sql.test.ts
 */
import { SqliteDriver } from '@dotaz/backend-shared/drivers/sqlite-driver'
import type { SqliteConnectionConfig } from '@dotaz/shared/types/connection'
import { afterAll, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const memConfig: SqliteConnectionConfig = { type: 'sqlite', path: ':memory:' }

/** First column value of the first row — PRAGMA result column names vary. */
function firstValue(rows: Record<string, unknown>[]): unknown {
	return rows.length > 0 ? Object.values(rows[0])[0] : undefined
}

describe('SqliteDriver initSql', () => {
	test('runs setup SQL on the main connection', async () => {
		const d = new SqliteDriver()
		await d.connect({ ...memConfig, initSql: 'PRAGMA busy_timeout = 7000' })
		try {
			const result = await d.execute('PRAGMA busy_timeout')
			expect(firstValue(result.rows)).toBe(7000)
		} finally {
			await d.disconnect()
		}
	})

	test('runs every statement of a multi-statement initSql', async () => {
		// SQLite's driver stops a multi-statement unsafe() at the first result-returning
		// statement, so each must run separately — both PRAGMAs below return a value.
		const d = new SqliteDriver()
		await d.connect({ ...memConfig, initSql: 'PRAGMA busy_timeout = 7000;\nPRAGMA cache_size = 1234;' })
		try {
			expect(firstValue((await d.execute('PRAGMA busy_timeout')).rows)).toBe(7000)
			expect(firstValue((await d.execute('PRAGMA cache_size')).rows)).toBe(1234)
		} finally {
			await d.disconnect()
		}
	})

	test('pinned/reserved session shares the configured main connection', async () => {
		const d = new SqliteDriver()
		await d.connect({ ...memConfig, initSql: 'PRAGMA busy_timeout = 7000' })
		const sessionId = 'pinned-test'
		await d.reserveSession(sessionId)
		try {
			const result = await d.execute('PRAGMA busy_timeout', [], sessionId)
			expect(firstValue(result.rows)).toBe(7000)
		} finally {
			await d.releaseSession(sessionId)
			await d.disconnect()
		}
	})

	test('empty initSql leaves PRAGMA at the default', async () => {
		const d = new SqliteDriver()
		await d.connect({ ...memConfig, initSql: '' })
		try {
			const result = await d.execute('PRAGMA busy_timeout')
			expect(firstValue(result.rows)).toBe(0)
		} finally {
			await d.disconnect()
		}
	})

	test('a failing initSql surfaces a connection error', async () => {
		const d = new SqliteDriver()
		await expect(
			d.connect({ ...memConfig, initSql: 'SELECT * FROM definitely_nonexistent_table_xyz' }),
		).rejects.toThrow()
		expect(d.isConnected()).toBe(false)
	})

	describe('iterate read connection (file-based)', () => {
		const dbPath = join(tmpdir(), 'dotaz-sqlite-init-sql-test.db')

		const cleanup = () => {
			for (const suffix of ['', '-wal', '-shm']) {
				try {
					rmSync(dbPath + suffix)
				} catch { /* not there */ }
			}
		}

		afterAll(cleanup)

		async function seed() {
			cleanup()
			const { SQL } = await import('bun')
			const raw = new SQL(`sqlite:${dbPath}`)
			await raw.unsafe('CREATE TABLE items (name TEXT)')
			await raw.unsafe("INSERT INTO items (name) VALUES ('ACME'), ('acme')")
			await raw.close()
		}

		// `name LIKE 'acme'` matches both rows by default (LIKE is case-insensitive),
		// but only the lowercase row once `case_sensitive_like` is ON — and that PRAGMA
		// must be applied to the dedicated iterate connection, not just the main one.
		const SELECT_LIKE = "SELECT name FROM items WHERE name LIKE 'acme'"

		async function iterateNames(d: SqliteDriver): Promise<string[]> {
			const names: string[] = []
			for await (const batch of d.iterate(SELECT_LIKE, [], 10)) {
				for (const row of batch) names.push(row.name as string)
			}
			return names
		}

		test('without initSql, iterate uses the default (case-insensitive) LIKE', async () => {
			await seed()
			const d = new SqliteDriver()
			await d.connect({ type: 'sqlite', path: dbPath })
			try {
				expect((await iterateNames(d)).sort()).toEqual(['ACME', 'acme'])
			} finally {
				await d.disconnect()
			}
		})

		test('initSql is applied to the iterate connection too', async () => {
			await seed()
			const d = new SqliteDriver()
			await d.connect({ type: 'sqlite', path: dbPath, initSql: 'PRAGMA case_sensitive_like = ON' })
			try {
				expect(await iterateNames(d)).toEqual(['acme'])
			} finally {
				await d.disconnect()
			}
		})
	})
})
