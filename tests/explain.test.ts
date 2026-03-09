import { describe, expect, mock, test } from 'bun:test'
import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import type { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { QueryExecutor } from '@dotaz/backend-shared/services/query-executor'
import type { ExplainNode, QueryResult } from '@dotaz/shared/types/query'

// ── Helpers ──────────────────────────────────────────────────

function makeSuccessResult(rows: Record<string, unknown>[] = [], durationMs = 0): QueryResult {
	const columns = rows.length > 0
		? Object.keys(rows[0]).map((name) => ({ name, dataType: 'unknown' }))
		: []
	return { columns, rows, rowCount: rows.length, durationMs }
}

function makeMockDriver(overrides?: Partial<DatabaseDriver>): DatabaseDriver {
	return {
		execute: mock(async () => makeSuccessResult()),
		cancel: mock(async () => {}),
		quoteIdentifier: (name: string) => `"${name}"`,
		getDriverType: () => 'sqlite' as const,
		qualifyTable: (schema: string, table: string) => schema === 'main' ? `"${table}"` : `"${schema}"."${table}"`,
		emptyInsertSql: (qualifiedTable: string) => `INSERT INTO ${qualifiedTable} DEFAULT VALUES`,
		placeholder: (index: number) => `$${index}`,
		...overrides,
	} as unknown as DatabaseDriver
}

function makeMockConnectionManager(driver: DatabaseDriver): ConnectionManager {
	return {
		getDriver: () => driver,
	} as unknown as ConnectionManager
}

// ── SQLite EXPLAIN QUERY PLAN ─────────────────────────────

describe('QueryExecutor.explainQuery — SQLite', () => {
	test('parses EXPLAIN QUERY PLAN output into tree', async () => {
		const driver = makeMockDriver({
			getDriverType: () => 'sqlite' as const,
			execute: mock(async () =>
				makeSuccessResult([
					{ id: 2, parent: 0, notused: 0, detail: 'SCAN users' },
				])
			),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const result = await executor.explainQuery('conn-1', 'SELECT * FROM users', false)

		expect(result.error).toBeUndefined()
		expect(result.nodes).toHaveLength(1)
		expect(result.nodes[0].operation).toBe('SCAN')
		expect(result.nodes[0].relation).toBe('users')
		expect(result.durationMs).toBeGreaterThanOrEqual(0)
		expect(result.rawText).toContain('SCAN users')
	})

	test('parses nested EXPLAIN QUERY PLAN nodes', async () => {
		const driver = makeMockDriver({
			getDriverType: () => 'sqlite' as const,
			execute: mock(async () =>
				makeSuccessResult([
					{ id: 3, parent: 0, notused: 0, detail: 'SCAN users' },
					{ id: 5, parent: 3, notused: 0, detail: 'SEARCH posts USING INDEX idx_posts_user_id (user_id=?)' },
				])
			),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const result = await executor.explainQuery('conn-1', 'SELECT * FROM users JOIN posts ON users.id = posts.user_id', false)

		expect(result.nodes).toHaveLength(1)
		expect(result.nodes[0].operation).toBe('SCAN')
		expect(result.nodes[0].relation).toBe('users')
		expect(result.nodes[0].children).toHaveLength(1)
		expect(result.nodes[0].children[0].operation).toBe('SEARCH')
		expect(result.nodes[0].children[0].relation).toBe('posts')
	})

	test('prepends EXPLAIN QUERY PLAN for SQLite', async () => {
		const executeMock = mock(async () => makeSuccessResult([]))
		const driver = makeMockDriver({
			getDriverType: () => 'sqlite' as const,
			execute: executeMock,
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		await executor.explainQuery('conn-1', 'SELECT * FROM users', false)

		expect(executeMock).toHaveBeenCalledWith('EXPLAIN QUERY PLAN SELECT * FROM users')
	})

	test('returns error result on failure', async () => {
		const driver = makeMockDriver({
			getDriverType: () => 'sqlite' as const,
			execute: mock(async () => {
				throw new Error('no such table: nope')
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const result = await executor.explainQuery('conn-1', 'SELECT * FROM nope', false)

		expect(result.error).toBe('no such table: nope')
		expect(result.nodes).toHaveLength(0)
		expect(result.durationMs).toBeGreaterThanOrEqual(0)
	})
})

// ── PostgreSQL EXPLAIN ────────────────────────────────────

describe('QueryExecutor.explainQuery — PostgreSQL', () => {
	test('uses EXPLAIN (FORMAT JSON) for PostgreSQL', async () => {
		const pgPlan = [
			{
				Plan: {
					'Node Type': 'Seq Scan',
					'Relation Name': 'users',
					'Total Cost': 1.03,
					'Plan Rows': 3,
				},
			},
		]
		const executeMock = mock(async (sql: string) => {
			if (sql.startsWith('EXPLAIN (FORMAT JSON)')) {
				return makeSuccessResult([{ 'QUERY PLAN': JSON.stringify(pgPlan) }])
			}
			// TEXT format fallback
			return makeSuccessResult([
				{ 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..1.03 rows=3 width=100)' },
			])
		})

		const driver = makeMockDriver({
			getDriverType: () => 'postgresql' as const,
			execute: executeMock,
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const result = await executor.explainQuery('conn-1', 'SELECT * FROM users', false)

		expect(result.error).toBeUndefined()
		expect(result.nodes).toHaveLength(1)
		expect(result.nodes[0].operation).toBe('Seq Scan')
		expect(result.nodes[0].relation).toBe('users')
		expect(result.nodes[0].cost).toBe(1.03)
		expect(result.nodes[0].estimatedRows).toBe(3)
	})

	test('uses EXPLAIN (ANALYZE, FORMAT JSON) when analyze=true', async () => {
		const pgPlan = [
			{
				Plan: {
					'Node Type': 'Seq Scan',
					'Relation Name': 'users',
					'Total Cost': 1.03,
					'Plan Rows': 3,
					'Actual Total Time': 0.025,
					'Actual Rows': 3,
				},
			},
		]
		const executeMock = mock(async (sql: string) => {
			if (sql.startsWith('EXPLAIN (ANALYZE, FORMAT JSON)')) {
				return makeSuccessResult([{ 'QUERY PLAN': JSON.stringify(pgPlan) }])
			}
			return makeSuccessResult([
				{ 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..1.03 rows=3 width=100) (actual time=0.01..0.02 rows=3 loops=1)' },
			])
		})

		const driver = makeMockDriver({
			getDriverType: () => 'postgresql' as const,
			execute: executeMock,
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const result = await executor.explainQuery('conn-1', 'SELECT * FROM users', true)

		expect(result.nodes[0].actualTime).toBe(0.025)
		expect(result.nodes[0].actualRows).toBe(3)
		// Verify the ANALYZE prefix was used
		expect(executeMock.mock.calls[0][0]).toContain('EXPLAIN (ANALYZE, FORMAT JSON)')
	})

	test('parses nested plan tree', async () => {
		const pgPlan = [
			{
				Plan: {
					'Node Type': 'Hash Join',
					'Total Cost': 10.5,
					'Plan Rows': 3,
					Plans: [
						{
							'Node Type': 'Seq Scan',
							'Relation Name': 'users',
							'Total Cost': 1.03,
							'Plan Rows': 3,
						},
						{
							'Node Type': 'Hash',
							'Total Cost': 5.0,
							'Plan Rows': 3,
							Plans: [
								{
									'Node Type': 'Seq Scan',
									'Relation Name': 'posts',
									'Total Cost': 5.0,
									'Plan Rows': 3,
								},
							],
						},
					],
				},
			},
		]
		const executeMock = mock(async (sql: string) => {
			if (sql.startsWith('EXPLAIN')) {
				return makeSuccessResult([{ 'QUERY PLAN': JSON.stringify(pgPlan) }])
			}
			return makeSuccessResult([])
		})

		const driver = makeMockDriver({
			getDriverType: () => 'postgresql' as const,
			execute: executeMock,
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const result = await executor.explainQuery(
			'conn-1',
			'SELECT * FROM users JOIN posts ON users.id = posts.user_id',
			false,
		)

		expect(result.nodes).toHaveLength(1)
		const root = result.nodes[0]
		expect(root.operation).toBe('Hash Join')
		expect(root.children).toHaveLength(2)
		expect(root.children[0].operation).toBe('Seq Scan')
		expect(root.children[0].relation).toBe('users')
		expect(root.children[1].operation).toBe('Hash')
		expect(root.children[1].children).toHaveLength(1)
		expect(root.children[1].children[0].operation).toBe('Seq Scan')
		expect(root.children[1].children[0].relation).toBe('posts')
	})

	test('returns error result on failure', async () => {
		const driver = makeMockDriver({
			getDriverType: () => 'postgresql' as const,
			execute: mock(async () => {
				throw new Error('relation "nope" does not exist')
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const result = await executor.explainQuery('conn-1', 'SELECT * FROM nope', false)

		expect(result.error).toBe('relation "nope" does not exist')
		expect(result.nodes).toHaveLength(0)
	})

	test('raw text includes text-format output', async () => {
		const pgPlan = [
			{
				Plan: {
					'Node Type': 'Seq Scan',
					'Relation Name': 'users',
					'Total Cost': 1.03,
					'Plan Rows': 3,
				},
			},
		]
		const executeMock = mock(async (sql: string) => {
			if (sql.startsWith('EXPLAIN (FORMAT JSON)')) {
				return makeSuccessResult([{ 'QUERY PLAN': JSON.stringify(pgPlan) }])
			}
			return makeSuccessResult([
				{ 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..1.03 rows=3 width=100)' },
			])
		})

		const driver = makeMockDriver({
			getDriverType: () => 'postgresql' as const,
			execute: executeMock,
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const result = await executor.explainQuery('conn-1', 'SELECT * FROM users', false)

		expect(result.rawText).toContain('Seq Scan on users')
	})
})
