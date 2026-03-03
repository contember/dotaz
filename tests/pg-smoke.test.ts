/**
 * PostgreSQL smoke tests — verifies the docker-compose PG instance works
 * and demonstrates patterns for driver tests.
 *
 * Run: docker compose up -d && bun test tests/pg-smoke.test.ts
 */
import { SQL } from 'bun'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PG_URL, seedPostgres } from './helpers'

let db: InstanceType<typeof SQL>

beforeAll(async () => {
	await seedPostgres()
	db = new SQL({ url: PG_URL })
}, 30_000)

afterAll(async () => {
	await db.close()
})

describe('PostgreSQL connection', () => {
	test('connects and runs a simple query', async () => {
		const rows = await db`SELECT 1 AS val`
		expect(rows[0].val).toBe(1)
	})

	test('can list schemas', async () => {
		const rows = await db`
			SELECT schema_name FROM information_schema.schemata
			WHERE schema_name = 'test_schema'
		`
		expect(rows).toHaveLength(1)
		expect(rows[0].schema_name).toBe('test_schema')
	})

	test('can list tables in schema', async () => {
		const rows = await db`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'test_schema'
			ORDER BY table_name
		`
		const names = rows.map((r: any) => r.table_name)
		expect(names).toContain('users')
		expect(names).toContain('posts')
	})

	test('can query seeded data', async () => {
		const rows = await db`SELECT * FROM test_schema.users ORDER BY id`
		expect(rows).toHaveLength(3)
		expect(rows[0].name).toBe('Alice')
		expect(rows[0].email).toBe('alice@example.com')
		expect(rows[2].age).toBeNull()
	})

	test('can introspect columns', async () => {
		const rows = await db`
			SELECT column_name, data_type, is_nullable
			FROM information_schema.columns
			WHERE table_schema = 'test_schema' AND table_name = 'users'
			ORDER BY ordinal_position
		`
		expect(rows.length).toBeGreaterThanOrEqual(5)

		const nameCol = rows.find((r: any) => r.column_name === 'name')
		expect(nameCol.data_type).toBe('text')
		expect(nameCol.is_nullable).toBe('NO')

		const ageCol = rows.find((r: any) => r.column_name === 'age')
		expect(ageCol.is_nullable).toBe('YES')
	})

	test('can introspect foreign keys', async () => {
		const rows = await db`
			SELECT
				kcu.column_name,
				ccu.table_name AS foreign_table_name,
				ccu.column_name AS foreign_column_name
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu
				ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
			JOIN information_schema.constraint_column_usage ccu
				ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
			WHERE tc.constraint_type = 'FOREIGN KEY'
				AND tc.table_schema = 'test_schema'
				AND tc.table_name = 'posts'
		`
		expect(rows).toHaveLength(1)
		expect(rows[0].column_name).toBe('user_id')
		expect(rows[0].foreign_table_name).toBe('users')
		expect(rows[0].foreign_column_name).toBe('id')
	})

	test('can introspect indexes', async () => {
		const rows = await db`
			SELECT indexname, indexdef
			FROM pg_indexes
			WHERE schemaname = 'test_schema' AND tablename = 'posts'
		`
		const names = rows.map((r: any) => r.indexname)
		expect(names).toContain('idx_posts_user_id')
	})

	test('transactions work', async () => {
		await db.begin(async (tx) => {
			await tx`INSERT INTO test_schema.users (name, email, age) VALUES ('TxUser', 'tx@example.com', 99)`
			const rows = await tx`SELECT * FROM test_schema.users WHERE email = 'tx@example.com'`
			expect(rows).toHaveLength(1)
			// rollback by throwing
			throw new Error('rollback')
		}).catch(() => {})

		const rows = await db`SELECT * FROM test_schema.users WHERE email = 'tx@example.com'`
		expect(rows).toHaveLength(0)
	})

	test('parameterized queries work', async () => {
		const email = 'alice@example.com'
		const rows = await db`SELECT * FROM test_schema.users WHERE email = ${email}`
		expect(rows).toHaveLength(1)
		expect(rows[0].name).toBe('Alice')
	})

	test('JSONB queries work', async () => {
		const rows = await db`
			SELECT name, metadata->>'role' AS role
			FROM test_schema.users
			WHERE metadata->>'role' = 'admin'
		`
		expect(rows).toHaveLength(1)
		expect(rows[0].name).toBe('Alice')
	})
})
