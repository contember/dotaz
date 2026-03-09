/**
 * Tests for DatabaseDriver iterate() and importBatch() methods.
 *
 * SQLite tests use in-memory databases.
 * PostgreSQL tests require docker-compose PG container:
 *   docker compose up -d
 *
 * Run: bun test tests/driver-iterate.test.ts
 */
import { PostgresDriver } from '@dotaz/backend-shared/drivers/postgres-driver'
import { SqliteDriver } from '@dotaz/backend-shared/drivers/sqlite-driver'
import type { PostgresConnectionConfig } from '@dotaz/shared/types/connection'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { seedPostgres } from './helpers'

// ─── SQLite iterate() ─────────────────────────────────────────────

describe('SqliteDriver iterate()', () => {
	let driver: SqliteDriver

	beforeEach(async () => {
		driver = new SqliteDriver()
		await driver.connect({ type: 'sqlite', path: ':memory:' })
		// Create a table with 10 rows
		await driver.execute(`
			CREATE TABLE items (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				value TEXT NOT NULL
			)
		`)
		for (let i = 1; i <= 10; i++) {
			await driver.execute('INSERT INTO items (value) VALUES ($1)', [`item_${i}`])
		}
	})

	afterEach(async () => {
		if (driver.isConnected()) await driver.disconnect()
	})

	test('yields all rows in a single batch when batchSize >= rowCount', async () => {
		const batches: Record<string, unknown>[][] = []
		for await (const batch of driver.iterate('SELECT * FROM items ORDER BY id', [], 100)) {
			batches.push(batch)
		}
		expect(batches).toHaveLength(1)
		expect(batches[0]).toHaveLength(10)
		expect(batches[0][0]).toMatchObject({ id: 1, value: 'item_1' })
		expect(batches[0][9]).toMatchObject({ id: 10, value: 'item_10' })
	})

	test('yields multiple batches when batchSize < rowCount', async () => {
		const batches: Record<string, unknown>[][] = []
		for await (const batch of driver.iterate('SELECT * FROM items ORDER BY id', [], 3)) {
			batches.push(batch)
		}
		// 10 rows / 3 per batch = 4 batches (3, 3, 3, 1)
		expect(batches).toHaveLength(4)
		expect(batches[0]).toHaveLength(3)
		expect(batches[1]).toHaveLength(3)
		expect(batches[2]).toHaveLength(3)
		expect(batches[3]).toHaveLength(1)
		// Verify order preserved
		expect(batches[0][0]).toMatchObject({ id: 1 })
		expect(batches[3][0]).toMatchObject({ id: 10 })
	})

	test('yields nothing for empty result', async () => {
		const batches: Record<string, unknown>[][] = []
		for await (const batch of driver.iterate('SELECT * FROM items WHERE 1 = 0')) {
			batches.push(batch)
		}
		expect(batches).toHaveLength(0)
	})

	test('supports query params', async () => {
		const batches: Record<string, unknown>[][] = []
		for await (const batch of driver.iterate('SELECT * FROM items WHERE id > $1 ORDER BY id', [5], 100)) {
			batches.push(batch)
		}
		expect(batches).toHaveLength(1)
		expect(batches[0]).toHaveLength(5)
		expect(batches[0][0]).toMatchObject({ id: 6 })
	})

	test('AbortSignal stops iteration', async () => {
		const ac = new AbortController()
		const batches: Record<string, unknown>[][] = []
		try {
			for await (const batch of driver.iterate('SELECT * FROM items ORDER BY id', [], 2, ac.signal)) {
				batches.push(batch)
				if (batches.length === 2) ac.abort()
			}
		} catch (err: any) {
			expect(err.name).toBe('AbortError')
		}
		// Should have gotten 2 batches before abort took effect
		expect(batches.length).toBe(2)
	})

	test('exact multiple batch size yields correct number of batches', async () => {
		const batches: Record<string, unknown>[][] = []
		for await (const batch of driver.iterate('SELECT * FROM items ORDER BY id', [], 5)) {
			batches.push(batch)
		}
		// 10 rows / 5 per batch = 2 batches
		expect(batches).toHaveLength(2)
		expect(batches[0]).toHaveLength(5)
		expect(batches[1]).toHaveLength(5)
	})
})

// ─── SQLite importBatch() ──────────────────────────────────────────

describe('SqliteDriver importBatch()', () => {
	let driver: SqliteDriver

	beforeEach(async () => {
		driver = new SqliteDriver()
		await driver.connect({ type: 'sqlite', path: ':memory:' })
		await driver.execute(`
			CREATE TABLE products (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				price REAL,
				active INTEGER NOT NULL DEFAULT 1
			)
		`)
	})

	afterEach(async () => {
		if (driver.isConnected()) await driver.disconnect()
	})

	test('inserts multiple rows', async () => {
		const rows = [
			{ name: 'Widget', price: 9.99, active: 1 },
			{ name: 'Gadget', price: 19.99, active: 0 },
			{ name: 'Doohickey', price: 4.50, active: 1 },
		]
		const affected = await driver.importBatch('"products"', ['name', 'price', 'active'], rows)
		expect(affected).toBe(3)

		const result = await driver.execute('SELECT * FROM products ORDER BY id')
		expect(result.rowCount).toBe(3)
		expect(result.rows[0]).toMatchObject({ name: 'Widget', price: 9.99 })
		expect(result.rows[2]).toMatchObject({ name: 'Doohickey', price: 4.50 })
	})

	test('handles NULL values', async () => {
		const rows = [{ name: 'NullPrice', price: null, active: 1 }]
		const affected = await driver.importBatch('"products"', ['name', 'price', 'active'], rows)
		expect(affected).toBe(1)

		const result = await driver.execute("SELECT price FROM products WHERE name = 'NullPrice'")
		expect(result.rows[0].price).toBeNull()
	})

	test('returns 0 for empty rows', async () => {
		const affected = await driver.importBatch('"products"', ['name', 'price', 'active'], [])
		expect(affected).toBe(0)

		const result = await driver.execute('SELECT COUNT(*) as cnt FROM products')
		expect(result.rows[0].cnt).toBe(0)
	})

	test('inserts single row', async () => {
		const affected = await driver.importBatch('"products"', ['name', 'price', 'active'], [
			{ name: 'Single', price: 1.00, active: 1 },
		])
		expect(affected).toBe(1)
	})
})

// ─── PostgreSQL iterate() ──────────────────────────────────────────

const pgConfig: PostgresConnectionConfig = {
	type: 'postgresql',
	host: 'localhost',
	port: 5488,
	database: 'dotaz_test',
	user: 'dotaz',
	password: 'dotaz',
}

describe('PostgresDriver iterate()', () => {
	let driver: PostgresDriver

	beforeAll(async () => {
		await seedPostgres()
		driver = new PostgresDriver()
		await driver.connect(pgConfig)

		// Create a larger test table for iteration
		await driver.execute('DROP TABLE IF EXISTS test_schema.iter_test')
		await driver.execute(`
			CREATE TABLE test_schema.iter_test (
				id SERIAL PRIMARY KEY,
				value TEXT NOT NULL
			)
		`)
		// Insert 10 rows
		for (let i = 1; i <= 10; i++) {
			await driver.execute(
				'INSERT INTO test_schema.iter_test (value) VALUES ($1)',
				[`item_${i}`],
			)
		}
	}, 30_000)

	afterAll(async () => {
		if (driver.isConnected()) {
			await driver.execute('DROP TABLE IF EXISTS test_schema.iter_test')
			await driver.disconnect()
		}
	})

	test('yields all rows in a single batch when batchSize >= rowCount', async () => {
		const batches: Record<string, unknown>[][] = []
		for await (
			const batch of driver.iterate(
				'SELECT * FROM test_schema.iter_test ORDER BY id',
				[],
				100,
			)
		) {
			batches.push(batch)
		}
		expect(batches).toHaveLength(1)
		expect(batches[0]).toHaveLength(10)
		expect(batches[0][0]).toMatchObject({ id: 1, value: 'item_1' })
	})

	test('yields multiple batches when batchSize < rowCount', async () => {
		const batches: Record<string, unknown>[][] = []
		for await (
			const batch of driver.iterate(
				'SELECT * FROM test_schema.iter_test ORDER BY id',
				[],
				3,
			)
		) {
			batches.push(batch)
		}
		expect(batches).toHaveLength(4)
		expect(batches[0]).toHaveLength(3)
		expect(batches[3]).toHaveLength(1)
	})

	test('yields nothing for empty result', async () => {
		const batches: Record<string, unknown>[][] = []
		for await (
			const batch of driver.iterate(
				'SELECT * FROM test_schema.iter_test WHERE 1 = 0',
			)
		) {
			batches.push(batch)
		}
		expect(batches).toHaveLength(0)
	})

	test('supports query params', async () => {
		const batches: Record<string, unknown>[][] = []
		for await (
			const batch of driver.iterate(
				'SELECT * FROM test_schema.iter_test WHERE id > $1 ORDER BY id',
				[5],
				100,
			)
		) {
			batches.push(batch)
		}
		expect(batches).toHaveLength(1)
		expect(batches[0]).toHaveLength(5)
	})

	test('AbortSignal stops iteration and cleans up', async () => {
		const ac = new AbortController()
		const batches: Record<string, unknown>[][] = []
		try {
			for await (
				const batch of driver.iterate(
					'SELECT * FROM test_schema.iter_test ORDER BY id',
					[],
					2,
					ac.signal,
				)
			) {
				batches.push(batch)
				if (batches.length === 2) ac.abort()
			}
		} catch (err: any) {
			expect(err.name).toBe('AbortError')
		}
		expect(batches.length).toBe(2)

		// Verify the connection is still usable after abort
		const result = await driver.execute('SELECT 1 as test')
		expect(result.rows[0].test).toBe(1)
	})

	test("does not interfere with driver's main transaction state", async () => {
		// iterate() uses its own reserved connection, so it should not
		// affect the driver's transaction state
		expect(driver.inTransaction()).toBe(false)

		const batches: Record<string, unknown>[][] = []
		for await (
			const batch of driver.iterate(
				'SELECT * FROM test_schema.iter_test ORDER BY id',
				[],
				5,
			)
		) {
			batches.push(batch)
		}

		expect(driver.inTransaction()).toBe(false)
		expect(batches).toHaveLength(2)
	})
})

// ─── PostgreSQL importBatch() ──────────────────────────────────────

describe('PostgresDriver importBatch()', () => {
	let driver: PostgresDriver

	beforeAll(async () => {
		await seedPostgres()
		driver = new PostgresDriver()
		await driver.connect(pgConfig)
	}, 30_000)

	afterAll(async () => {
		if (driver.isConnected()) {
			await driver.execute('DROP TABLE IF EXISTS test_schema.import_test')
			await driver.disconnect()
		}
	})

	test('inserts multiple rows', async () => {
		await driver.execute('DROP TABLE IF EXISTS test_schema.import_test')
		await driver.execute(`
			CREATE TABLE test_schema.import_test (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				price NUMERIC,
				active BOOLEAN NOT NULL DEFAULT true
			)
		`)

		const rows = [
			{ name: 'Widget', price: 9.99, active: true },
			{ name: 'Gadget', price: 19.99, active: false },
			{ name: 'Doohickey', price: 4.50, active: true },
		]
		const affected = await driver.importBatch(
			'"test_schema"."import_test"',
			['name', 'price', 'active'],
			rows,
		)
		expect(affected).toBe(3)

		const result = await driver.execute(
			'SELECT * FROM test_schema.import_test ORDER BY id',
		)
		expect(result.rowCount).toBe(3)
		expect(result.rows[0]).toMatchObject({ name: 'Widget' })
	})

	test('handles NULL values', async () => {
		await driver.execute('DELETE FROM test_schema.import_test')
		const rows = [{ name: 'NullPrice', price: null, active: true }]
		const affected = await driver.importBatch(
			'"test_schema"."import_test"',
			['name', 'price', 'active'],
			rows,
		)
		expect(affected).toBe(1)

		const result = await driver.execute(
			"SELECT price FROM test_schema.import_test WHERE name = 'NullPrice'",
		)
		expect(result.rows[0].price).toBeNull()
	})

	test('returns 0 for empty rows', async () => {
		const affected = await driver.importBatch(
			'"test_schema"."import_test"',
			['name', 'price', 'active'],
			[],
		)
		expect(affected).toBe(0)
	})
})
