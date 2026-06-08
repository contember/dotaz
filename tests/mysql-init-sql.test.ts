/**
 * Tests for per-connection session-setup SQL (`initSql`) on MysqlDriver.
 *
 * MySQL has no RLS keyed on session state, so this uses an observable session
 * system variable (`time_zone`) to prove that initSql establishes session context
 * and — crucially — survives the pool's RESET CONNECTION reset across reused
 * connections, so iterate/export/pinned sessions all keep the configured state.
 *
 * Requires docker-compose MySQL/MariaDB container:
 *   docker compose up -d
 *
 * Run: bun test tests/mysql-init-sql.test.ts
 */
import { MysqlDriver } from '@dotaz/backend-shared/drivers/mysql-driver'
import type { MysqlConnectionConfig } from '@dotaz/shared/types/connection'
import { afterAll, describe, expect, test } from 'bun:test'

const baseConfig: MysqlConnectionConfig = {
	type: 'mysql',
	host: 'localhost',
	port: 3388,
	database: 'dotaz_test',
	user: 'dotaz',
	password: 'dotaz',
}

const TZ = '+05:30'
const SELECT_TZ = 'SELECT @@session.time_zone AS tz'

describe('MysqlDriver initSql (session time_zone)', () => {
	let driver: MysqlDriver

	afterAll(async () => {
		if (driver?.isConnected()) await driver.disconnect()
	})

	test('pooled query (system connection) sees the configured session state', async () => {
		driver = new MysqlDriver()
		await driver.connect({ ...baseConfig, initSql: `SET SESSION time_zone = '${TZ}'` })

		const result = await driver.execute(SELECT_TZ)
		expect(result.rows[0]?.tz).toBe(TZ)
	})

	test('survives RESET CONNECTION across the acquire/release (iterate/export) path', async () => {
		// First iterate acquires a fresh connection, then releases it (RESET CONNECTION + re-init).
		// Second iterate reuses that reset connection — if init were not re-applied after
		// the reset, it would report the server default instead of the configured TZ.
		for (let pass = 0; pass < 2; pass++) {
			const seen: string[] = []
			for await (const batch of driver.iterate(SELECT_TZ, [], 1)) {
				for (const row of batch) seen.push(row.tz as string)
			}
			expect(seen).toEqual([TZ])
		}

		// Interleave many pooled queries to force connection reuse; all stay configured.
		for (let i = 0; i < 10; i++) {
			const result = await driver.execute(SELECT_TZ)
			expect(result.rows[0]?.tz).toBe(TZ)
		}
	})

	test('pinned/reserved session is configured without a manual SET', async () => {
		const sessionId = 'pinned-test'
		await driver.reserveSession(sessionId)
		try {
			const result = await driver.execute(SELECT_TZ, [], sessionId)
			expect(result.rows[0]?.tz).toBe(TZ)
		} finally {
			await driver.releaseSession(sessionId)
		}
	})

	test('empty initSql leaves the session at the server default', async () => {
		const d = new MysqlDriver()
		await d.connect({ ...baseConfig, initSql: '' })
		try {
			const result = await d.execute(SELECT_TZ)
			expect(result.rows[0]?.tz).not.toBe(TZ)
		} finally {
			await d.disconnect()
		}
	})

	test('a failing initSql surfaces a connection error', async () => {
		const d = new MysqlDriver()
		await expect(
			d.connect({ ...baseConfig, initSql: 'SELECT * FROM definitely_nonexistent_table_xyz' }),
		).rejects.toThrow()
		expect(d.isConnected()).toBe(false)
	})
})
