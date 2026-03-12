import { PostgresDriver } from '@dotaz/backend-shared/drivers/postgres-driver'
import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { seedPostgres } from './helpers'

const config: ConnectionConfig = {
	type: 'postgresql',
	host: 'localhost',
	port: 5488,
	database: 'dotaz_test',
	user: 'dotaz',
	password: 'dotaz',
}

let driver: PostgresDriver

beforeAll(async () => {
	await seedPostgres()
	driver = new PostgresDriver()
	await driver.connect(config)
}, 30_000)

afterAll(async () => {
	if (driver.isConnected()) {
		await driver.disconnect()
	}
})

describe('session management', () => {
	test('reserveSession creates a session', async () => {
		await driver.reserveSession('s1')
		expect(driver.getSessionIds()).toContain('s1')
		await driver.releaseSession('s1')
	})

	test('releaseSession removes a session', async () => {
		await driver.reserveSession('s2')
		await driver.releaseSession('s2')
		expect(driver.getSessionIds()).not.toContain('s2')
	})

	test('reserveSession throws for duplicate session ID', async () => {
		await driver.reserveSession('dup')
		try {
			await expect(driver.reserveSession('dup')).rejects.toThrow(
				'Session "dup" already exists',
			)
		} finally {
			await driver.releaseSession('dup')
		}
	})

	test('releaseSession throws for unknown session ID', async () => {
		await expect(driver.releaseSession('unknown')).rejects.toThrow(
			'Session "unknown" not found',
		)
	})

	test('getSessionIds excludes __default__ session', async () => {
		await driver.beginTransaction() // creates __default__
		expect(driver.getSessionIds()).not.toContain('__default__')
		await driver.rollback()
	})

	test('multiple sessions can be created', async () => {
		await driver.reserveSession('a')
		await driver.reserveSession('b')
		await driver.reserveSession('c')
		const ids = driver.getSessionIds()
		expect(ids).toContain('a')
		expect(ids).toContain('b')
		expect(ids).toContain('c')
		await driver.releaseSession('a')
		await driver.releaseSession('b')
		await driver.releaseSession('c')
	})
})

describe('session execute', () => {
	test('execute with sessionId uses session connection', async () => {
		await driver.reserveSession('exec-s')
		try {
			const result = await driver.execute(
				'SELECT * FROM test_schema.users ORDER BY id',
				[],
				'exec-s',
			)
			expect(result.rows.length).toBe(3)
		} finally {
			await driver.releaseSession('exec-s')
		}
	})

	test('execute without sessionId uses pool', async () => {
		const result = await driver.execute(
			'SELECT * FROM test_schema.users ORDER BY id',
		)
		expect(result.rows.length).toBe(3)
	})

	test('execute with unknown sessionId throws', async () => {
		await expect(
			driver.execute('SELECT 1', [], 'nonexistent'),
		).rejects.toThrow('Session "nonexistent" not found')
	})
})

describe('session transaction isolation', () => {
	test('transaction on session uses session connection', async () => {
		await driver.reserveSession('tx-s')
		try {
			await driver.beginTransaction('tx-s')
			expect(driver.inTransaction('tx-s')).toBe(true)

			await driver.execute(
				'INSERT INTO test_schema.users (name, email, age) VALUES ($1, $2, $3)',
				['TxUser', 'txuser@example.com', 40],
				'tx-s',
			)

			// Visible within session
			const inSession = await driver.execute(
				'SELECT * FROM test_schema.users WHERE email = $1',
				['txuser@example.com'],
				'tx-s',
			)
			expect(inSession.rows.length).toBe(1)

			// Not visible from pool (different connection, uncommitted)
			const fromPool = await driver.execute(
				'SELECT * FROM test_schema.users WHERE email = $1',
				['txuser@example.com'],
			)
			expect(fromPool.rows.length).toBe(0)

			await driver.rollback('tx-s')
			expect(driver.inTransaction('tx-s')).toBe(false)
		} finally {
			await driver.releaseSession('tx-s')
		}
	})

	test('two sessions have independent transactions', async () => {
		await driver.reserveSession('iso-a')
		await driver.reserveSession('iso-b')
		try {
			await driver.beginTransaction('iso-a')
			await driver.beginTransaction('iso-b')

			// Session A inserts
			await driver.execute(
				'INSERT INTO test_schema.users (name, email, age) VALUES ($1, $2, $3)',
				['IsoA', 'isoa@example.com', 50],
				'iso-a',
			)

			// Session B cannot see A's insert
			const bSees = await driver.execute(
				'SELECT * FROM test_schema.users WHERE email = $1',
				['isoa@example.com'],
				'iso-b',
			)
			expect(bSees.rows.length).toBe(0)

			// Session B inserts its own
			await driver.execute(
				'INSERT INTO test_schema.users (name, email, age) VALUES ($1, $2, $3)',
				['IsoB', 'isob@example.com', 60],
				'iso-b',
			)

			// Session A cannot see B's insert
			const aSees = await driver.execute(
				'SELECT * FROM test_schema.users WHERE email = $1',
				['isob@example.com'],
				'iso-a',
			)
			expect(aSees.rows.length).toBe(0)

			await driver.rollback('iso-a')
			await driver.rollback('iso-b')
		} finally {
			await driver.releaseSession('iso-a')
			await driver.releaseSession('iso-b')
		}
	})
})

describe('session release cleanup', () => {
	test('releaseSession rolls back active transaction', async () => {
		await driver.reserveSession('cleanup-s')
		await driver.beginTransaction('cleanup-s')
		await driver.execute(
			'INSERT INTO test_schema.users (name, email, age) VALUES ($1, $2, $3)',
			['Cleanup', 'cleanup@example.com', 99],
			'cleanup-s',
		)

		// Release without explicit rollback
		await driver.releaseSession('cleanup-s')

		// Data should not be visible (was rolled back)
		const result = await driver.execute(
			'SELECT * FROM test_schema.users WHERE email = $1',
			['cleanup@example.com'],
		)
		expect(result.rows.length).toBe(0)
	})
})

describe('backward compatibility', () => {
	test('beginTransaction without sessionId works (default session)', async () => {
		await driver.beginTransaction()
		expect(driver.inTransaction()).toBe(true)

		await driver.execute(
			'INSERT INTO test_schema.users (name, email, age) VALUES ($1, $2, $3)',
			['Compat', 'compat@example.com', 70],
		)

		await driver.rollback()
		expect(driver.inTransaction()).toBe(false)

		// Data should be rolled back
		const result = await driver.execute(
			'SELECT * FROM test_schema.users WHERE email = $1',
			['compat@example.com'],
		)
		expect(result.rows.length).toBe(0)
	})

	test('commit without sessionId releases default session', async () => {
		await driver.beginTransaction()
		await driver.execute(
			'INSERT INTO test_schema.users (name, email, age) VALUES ($1, $2, $3)',
			['CommitTest', 'commitcompat@example.com', 80],
		)
		await driver.commit()
		expect(driver.inTransaction()).toBe(false)

		// Clean up
		await driver.execute(
			'DELETE FROM test_schema.users WHERE email = $1',
			['commitcompat@example.com'],
		)
	})

	test('loadSchema without sessionId works', async () => {
		const schema = await driver.loadSchema()
		expect(schema.schemas.length).toBeGreaterThan(0)
		expect(schema.tables.test_schema?.length).toBeGreaterThan(0)
	})

	test('loadSchema with sessionId works', async () => {
		await driver.reserveSession('schema-s')
		try {
			const schema = await driver.loadSchema('schema-s')
			expect(schema.schemas.length).toBeGreaterThan(0)
			expect(schema.tables.test_schema?.length).toBeGreaterThan(0)
		} finally {
			await driver.releaseSession('schema-s')
		}
	})
})

describe('commit/rollback failure releases DEFAULT_SESSION', () => {
	test('failed commit releases connection and cleans up session', async () => {
		// Create a table with a deferred unique constraint — violation is only
		// detected at COMMIT time, which makes the COMMIT itself throw.
		await driver.execute(`
			CREATE TABLE IF NOT EXISTS _test_deferred (
				id SERIAL PRIMARY KEY,
				val TEXT NOT NULL UNIQUE DEFERRABLE INITIALLY DEFERRED
			)
		`)
		try {
			await driver.beginTransaction()
			await driver.execute(`INSERT INTO _test_deferred (val) VALUES ('dup')`)
			await driver.execute(`INSERT INTO _test_deferred (val) VALUES ('dup')`)

			// COMMIT must fail (deferred unique constraint violation)
			await expect(driver.commit()).rejects.toThrow()

			// Session state must be cleaned up despite the error
			expect(driver.inTransaction()).toBe(false)

			// Driver must still be usable — if the connection leaked,
			// beginTransaction() would reuse the broken session or the pool
			// would be exhausted.
			await driver.beginTransaction()
			await driver.rollback()
		} finally {
			await driver.execute('DROP TABLE IF EXISTS _test_deferred')
		}
	})
})

describe('disconnect releases all sessions', () => {
	test('disconnect cleans up sessions', async () => {
		const d2 = new PostgresDriver()
		await d2.connect(config)

		await d2.reserveSession('disc-a')
		await d2.reserveSession('disc-b')
		await d2.beginTransaction('disc-a')

		expect(d2.getSessionIds()).toContain('disc-a')
		expect(d2.getSessionIds()).toContain('disc-b')

		await d2.disconnect()

		expect(d2.getSessionIds()).toEqual([])
		expect(d2.isConnected()).toBe(false)
	})
})
