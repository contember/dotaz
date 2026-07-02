/**
 * Tests for per-connection session-setup SQL (`initSql`) on PostgresDriver.
 *
 * Proves that initSql establishes session context (RLS GUC) and — crucially —
 * survives the pool's session reset across reused connections, so table
 * browsing / export / pinned sessions all stay correctly scoped.
 *
 * Requires docker-compose PG container:
 *   docker compose up -d
 *
 * Run: bun test tests/postgres-init-sql.test.ts
 */
import { PostgresDriver } from '@dotaz/backend-shared/drivers/postgres-driver'
import type { PostgresConnectionConfig } from '@dotaz/shared/types/connection'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PG_URL } from './helpers'

// A dedicated NON-superuser login role — RLS does not apply to superusers
// (which the bootstrap `dotaz` user is) or table owners, only to ordinary roles.
const RLS_ROLE = 'rls_tenant'
const RLS_PASSWORD = 'rls_tenant'

const baseConfig: PostgresConnectionConfig = {
	type: 'postgresql',
	host: 'localhost',
	port: 5488,
	database: 'dotaz_test',
	user: RLS_ROLE,
	password: RLS_PASSWORD,
}

/**
 * Create a non-superuser role plus a table with RLS keyed on
 * `current_setting('app.current_shop')`. The `true` (missing_ok) arg makes an
 * unset GUC fail closed to zero rows rather than erroring.
 */
async function setupRls() {
	const { SQL } = await import('bun')
	const admin = new SQL({ url: PG_URL })
	await admin.unsafe(
		`DO $$ BEGIN
			IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN
				CREATE ROLE ${RLS_ROLE} LOGIN PASSWORD '${RLS_PASSWORD}';
			END IF;
		END $$`,
	)
	await admin`CREATE SCHEMA IF NOT EXISTS test_schema`
	await admin`DROP TABLE IF EXISTS test_schema.rls_items CASCADE`
	await admin`
		CREATE TABLE test_schema.rls_items (
			id serial primary key,
			shop text not null,
			name text not null
		)
	`
	await admin`
		INSERT INTO test_schema.rls_items (shop, name) VALUES
		('acme', 'Acme Widget'),
		('acme', 'Acme Gadget'),
		('globex', 'Globex Gizmo'),
		('globex', 'Globex Gear'),
		('initech', 'Initech Stapler')
	`
	await admin`ALTER TABLE test_schema.rls_items ENABLE ROW LEVEL SECURITY`
	await admin.unsafe(
		`CREATE POLICY tenant_isolation ON test_schema.rls_items
		 USING (shop = current_setting('app.current_shop', true))`,
	)
	await admin.unsafe(`GRANT USAGE ON SCHEMA test_schema TO ${RLS_ROLE}`)
	await admin.unsafe(`GRANT SELECT ON test_schema.rls_items TO ${RLS_ROLE}`)
	await admin.close()
}

beforeAll(async () => {
	await setupRls()
}, 30_000)

const SELECT_ALL = 'SELECT shop, name FROM test_schema.rls_items ORDER BY id'

describe('PostgresDriver initSql (RLS by GUC)', () => {
	let driver: PostgresDriver

	afterAll(async () => {
		if (driver?.isConnected()) await driver.disconnect()
	})

	test('pooled query (system connection) returns only the scoped tenant', async () => {
		driver = new PostgresDriver()
		await driver.connect({ ...baseConfig, initSql: "SET app.current_shop = 'acme'" })

		const result = await driver.execute(SELECT_ALL)
		const shops = new Set(result.rows.map((r) => r.shop))
		expect(shops).toEqual(new Set(['acme']))
		expect(result.rows).toHaveLength(2)
	})

	test('survives session reset across the acquire/release (iterate/export) path', async () => {
		// First iterate acquires a fresh connection, then releases it (reset + re-init).
		// Second iterate reuses that reset connection — if init were not re-applied after
		// reset, it would return zero rows.
		for (let pass = 0; pass < 2; pass++) {
			const seen: string[] = []
			for await (const batch of driver.iterate(SELECT_ALL, [], 1)) {
				for (const row of batch) seen.push(row.shop as string)
			}
			expect(new Set(seen)).toEqual(new Set(['acme']))
			expect(seen).toHaveLength(2)
		}

		// Interleave many pooled queries to force connection reuse; all stay scoped.
		for (let i = 0; i < 10; i++) {
			const result = await driver.execute(SELECT_ALL)
			expect(new Set(result.rows.map((r) => r.shop))).toEqual(new Set(['acme']))
		}
	})

	test('pinned/reserved session is scoped without a manual SET', async () => {
		const sessionId = 'pinned-test'
		await driver.reserveSession(sessionId)
		try {
			const result = await driver.execute(SELECT_ALL, [], sessionId)
			expect(new Set(result.rows.map((r) => r.shop))).toEqual(new Set(['acme']))
			expect(result.rows).toHaveLength(2)
		} finally {
			await driver.releaseSession(sessionId)
		}
	})

	test('a different tenant scopes to its own rows', async () => {
		const d = new PostgresDriver()
		await d.connect({ ...baseConfig, initSql: "SET app.current_shop = 'globex'" })
		try {
			const result = await d.execute(SELECT_ALL)
			expect(new Set(result.rows.map((r) => r.shop))).toEqual(new Set(['globex']))
			expect(result.rows).toHaveLength(2)
		} finally {
			await d.disconnect()
		}
	})

	test('empty initSql behaves like no init (fail-closed: zero rows)', async () => {
		const d = new PostgresDriver()
		await d.connect({ ...baseConfig, initSql: '' })
		try {
			const result = await d.execute(SELECT_ALL)
			expect(result.rows).toHaveLength(0)
		} finally {
			await d.disconnect()
		}
	})

	test('a failing initSql surfaces a connection error', async () => {
		const d = new PostgresDriver()
		await expect(
			d.connect({ ...baseConfig, initSql: 'SELECT * FROM definitely_nonexistent_table_xyz' }),
		).rejects.toThrow()
		expect(d.isConnected()).toBe(false)
	})
})
