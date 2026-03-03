/**
 * SQLite smoke tests — verifies bun:sqlite works and demonstrates
 * patterns for driver tests. No external dependencies needed.
 *
 * Run: bun test tests/sqlite-smoke.test.ts
 */
import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { seedSqlite } from './helpers'

let db: Database

beforeEach(() => {
	db = new Database(':memory:')
	seedSqlite(db)
})

describe('SQLite connection', () => {
	test('can query seeded data', () => {
		const rows = db.query('SELECT * FROM users ORDER BY id').all() as any[]
		expect(rows).toHaveLength(3)
		expect(rows[0].name).toBe('Alice')
		expect(rows[2].age).toBeNull()
	})

	test('can introspect tables via sqlite_master', () => {
		const rows = db.query(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		).all() as any[]
		const names = rows.map((r) => r.name)
		expect(names).toContain('users')
		expect(names).toContain('posts')
	})

	test('can introspect columns via PRAGMA table_info', () => {
		const rows = db.query('PRAGMA table_info(users)').all() as any[]
		expect(rows.length).toBeGreaterThanOrEqual(5)

		const nameCol = rows.find((r) => r.name === 'name')
		expect(nameCol.type).toBe('TEXT')
		expect(nameCol.notnull).toBe(1)

		const ageCol = rows.find((r) => r.name === 'age')
		expect(ageCol.notnull).toBe(0)
	})

	test('can introspect indexes via PRAGMA index_list', () => {
		const rows = db.query('PRAGMA index_list(posts)').all() as any[]
		const names = rows.map((r: any) => r.name)
		expect(names).toContain('idx_posts_user_id')
	})

	test('can introspect foreign keys via PRAGMA foreign_key_list', () => {
		const rows = db.query('PRAGMA foreign_key_list(posts)').all() as any[]
		expect(rows).toHaveLength(1)
		expect(rows[0].table).toBe('users')
		expect(rows[0].from).toBe('user_id')
		expect(rows[0].to).toBe('id')
	})

	test('parameterized queries work', () => {
		const rows = db.query('SELECT * FROM users WHERE email = ?').all('alice@example.com') as any[]
		expect(rows).toHaveLength(1)
		expect(rows[0].name).toBe('Alice')
	})

	test('transactions work — commit', () => {
		db.run('BEGIN')
		db.run("INSERT INTO users (name, email, age) VALUES ('TxUser', 'tx@example.com', 99)")
		db.run('COMMIT')

		const rows = db.query("SELECT * FROM users WHERE email = 'tx@example.com'").all() as any[]
		expect(rows).toHaveLength(1)
	})

	test('transactions work — rollback', () => {
		db.run('BEGIN')
		db.run("INSERT INTO users (name, email, age) VALUES ('TxUser2', 'tx2@example.com', 99)")
		db.run('ROLLBACK')

		const rows = db.query("SELECT * FROM users WHERE email = 'tx2@example.com'").all() as any[]
		expect(rows).toHaveLength(0)
	})

	test('NULL vs empty string', () => {
		db.run("INSERT INTO users (name, email, age) VALUES ('Empty', 'empty@example.com', NULL)")
		const rows = db.query("SELECT age FROM users WHERE email = 'empty@example.com'").all() as any[]
		expect(rows[0].age).toBeNull()
	})
})
