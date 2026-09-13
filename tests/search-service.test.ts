/**
 * Tests for SearchService — cross-table full-text search.
 *
 * Run: bun test tests/search-service.test.ts
 */
import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import { SqliteDriver } from '@dotaz/backend-shared/drivers/sqlite-driver'
import { searchDatabase } from '@dotaz/backend-shared/services/search-service'
import type { ConnectionConfig } from '@dotaz/shared/types/connection'
import type { SchemaData } from '@dotaz/shared/types/database'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import type { QueryResult } from '@dotaz/shared/types/query'
import type { DriverConnectionHandleInfo } from '@dotaz/shared/types/rpc'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

let driver: SqliteDriver

class CapturingMysqlSearchDriver implements DatabaseDriver {
	readonly executedSql: string[] = []
	readonly executedParams: unknown[][] = []
	readonly executeSessionIds: (string | undefined)[] = []
	readonly schemaSessionIds: (string | undefined)[] = []

	connect(_config: ConnectionConfig): Promise<void> {
		return Promise.resolve()
	}

	disconnect(): Promise<void> {
		return Promise.resolve()
	}

	isConnected(): boolean {
		return true
	}

	reserveSession(_sessionId: string): Promise<void> {
		return Promise.resolve()
	}

	releaseSession(_sessionId: string): Promise<void> {
		return Promise.resolve()
	}

	isSessionReadOnly(_sessionId: string): boolean {
		return false
	}

	getSessionIds(): string[] {
		return []
	}

	execute(sql: string, params?: unknown[], sessionId?: string): Promise<QueryResult> {
		this.executedSql.push(sql)
		this.executedParams.push(params ?? [])
		this.executeSessionIds.push(sessionId)
		return Promise.resolve({
			columns: [],
			rows: [],
			rowCount: 0,
			durationMs: 0,
		})
	}

	cancel(_sessionId?: string, _poolQueryKey?: symbol): Promise<void> {
		return Promise.resolve()
	}

	async *iterate(): AsyncGenerator<Record<string, unknown>[]> {}

	importBatch(
		_qualifiedTable: string,
		_columns: string[],
		_rows: Record<string, unknown>[],
		_sessionId?: string,
	): Promise<number> {
		return Promise.resolve(0)
	}

	loadSchema(sessionId?: string): Promise<SchemaData> {
		this.schemaSessionIds.push(sessionId)
		return Promise.resolve({
			schemas: [{ name: 'app' }],
			tables: {
				app: [{ schema: 'app', name: 'users', type: 'table' }],
			},
			columns: {
				'app.users': [
					{
						name: 'name',
						dataType: DatabaseDataType.Varchar,
						nullable: false,
						defaultValue: null,
						isPrimaryKey: false,
						isAutoIncrement: false,
					},
					{
						name: 'age',
						dataType: DatabaseDataType.Integer,
						nullable: true,
						defaultValue: null,
						isPrimaryKey: false,
						isAutoIncrement: false,
					},
					{
						name: 'avatar',
						dataType: DatabaseDataType.Binary,
						nullable: true,
						defaultValue: null,
						isPrimaryKey: false,
						isAutoIncrement: false,
					},
				],
			},
			indexes: {},
			foreignKeys: {},
			referencingForeignKeys: {},
		})
	}

	ping(): Promise<void> {
		return Promise.resolve()
	}

	beginTransaction(_sessionId?: string): Promise<void> {
		return Promise.resolve()
	}

	commit(_sessionId?: string): Promise<void> {
		return Promise.resolve()
	}

	rollback(_sessionId?: string): Promise<void> {
		return Promise.resolve()
	}

	inTransaction(_sessionId?: string): boolean {
		return false
	}

	isTxAborted(_sessionId?: string): boolean {
		return false
	}

	isIterating(_sessionId?: string): boolean {
		return false
	}

	listConnectionHandles(): DriverConnectionHandleInfo[] {
		return []
	}

	terminateConnectionHandle(_handleId: string): Promise<void> {
		return Promise.resolve()
	}

	quoteIdentifier(name: string): string {
		return `\`${name.replace(/`/g, '``')}\``
	}

	qualifyTable(schema: string, table: string): string {
		return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`
	}

	emptyInsertSql(qualifiedTable: string): string {
		return `INSERT INTO ${qualifiedTable} () VALUES ()`
	}

	getDriverType(): 'mysql' {
		return 'mysql'
	}

	placeholder(_index: number): string {
		return '?'
	}
}

async function seedTestData(d: SqliteDriver) {
	await d.execute(`
		CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			email TEXT UNIQUE NOT NULL,
			age INTEGER
		)
	`)
	await d.execute(`
		CREATE TABLE posts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			body TEXT
		)
	`)
	await d.execute(`
		INSERT INTO users (name, email, age) VALUES
		('Alice', 'alice@example.com', 30),
		('Bob', 'bob@example.com', 25),
		('Charlie', 'charlie@example.com', NULL)
	`)
	await d.execute(`
		INSERT INTO posts (user_id, title, body) VALUES
		(1, 'Hello World', 'First post content'),
		(1, 'Alice Adventures', NULL),
		(2, 'Bobs Post', 'Some content here')
	`)
}

beforeEach(async () => {
	driver = new SqliteDriver()
	await driver.connect({ type: 'sqlite', path: ':memory:' })
	await seedTestData(driver)
})

afterEach(async () => {
	if (driver.isConnected()) {
		await driver.disconnect()
	}
})

describe('searchDatabase', () => {
	test('finds matches across multiple tables', async () => {
		const result = await searchDatabase(
			driver,
			{
				searchTerm: 'Alice',
				scope: 'database',
				resultsPerTable: 50,
			},
			() => {},
			() => false,
		)

		expect(result.cancelled).toBe(false)
		expect(result.totalMatches).toBeGreaterThanOrEqual(2)
		// Alice appears in users.name, users.email, and posts.title
		const tableNames = new Set(result.matches.map((m) => m.table))
		expect(tableNames.has('users')).toBe(true)
		expect(tableNames.has('posts')).toBe(true)
	})

	test('case-insensitive search', async () => {
		const result = await searchDatabase(
			driver,
			{
				searchTerm: 'alice',
				scope: 'database',
				resultsPerTable: 50,
			},
			() => {},
			() => false,
		)

		expect(result.totalMatches).toBeGreaterThanOrEqual(1)
	})

	test('respects resultsPerTable limit', async () => {
		const result = await searchDatabase(
			driver,
			{
				searchTerm: 'example.com',
				scope: 'database',
				resultsPerTable: 1,
			},
			() => {},
			() => false,
		)

		// With limit 1 per table, we should get at most 1 match from users table
		const userMatches = result.matches.filter((m) => m.table === 'users')
		expect(userMatches.length).toBeLessThanOrEqual(1)
	})

	test('scope: tables filters to selected tables only', async () => {
		const result = await searchDatabase(
			driver,
			{
				searchTerm: 'Alice',
				scope: 'tables',
				tableNames: ['posts'],
				resultsPerTable: 50,
			},
			() => {},
			() => false,
		)

		// Should only find Alice in the posts table
		for (const match of result.matches) {
			expect(match.table).toBe('posts')
		}
	})

	test('returns empty results when no matches', async () => {
		const result = await searchDatabase(
			driver,
			{
				searchTerm: 'nonexistentvalue12345',
				scope: 'database',
				resultsPerTable: 50,
			},
			() => {},
			() => false,
		)

		expect(result.matches).toEqual([])
		expect(result.totalMatches).toBe(0)
	})

	test('calls progress callback', async () => {
		const progressCalls: string[] = []
		await searchDatabase(driver, {
			searchTerm: 'Alice',
			scope: 'database',
			resultsPerTable: 50,
		}, (tableName) => {
			progressCalls.push(tableName)
		}, () => false)

		expect(progressCalls.length).toBeGreaterThan(0)
	})

	test('cancellation stops early', async () => {
		let callCount = 0
		const result = await searchDatabase(driver, {
			searchTerm: 'Alice',
			scope: 'database',
			resultsPerTable: 50,
		}, () => {
			callCount++
		}, () => callCount >= 1) // Cancel after first table

		expect(result.cancelled).toBe(true)
	})

	test('match includes row data', async () => {
		const result = await searchDatabase(
			driver,
			{
				searchTerm: 'Bob',
				scope: 'tables',
				tableNames: ['users'],
				resultsPerTable: 50,
			},
			() => {},
			() => false,
		)

		expect(result.matches.length).toBeGreaterThanOrEqual(1)
		const bobMatch = result.matches[0]
		expect(bobMatch.row).toBeDefined()
		expect(bobMatch.row.name).toBe('Bob')
		expect(bobMatch.column).toBeDefined()
	})

	test('searchedTables counts correctly', async () => {
		const result = await searchDatabase(
			driver,
			{
				searchTerm: 'something',
				scope: 'database',
				resultsPerTable: 50,
			},
			() => {},
			() => false,
		)

		// We have 2 tables (users, posts)
		expect(result.searchedTables).toBe(2)
	})

	test('elapsedMs is set', async () => {
		const result = await searchDatabase(
			driver,
			{
				searchTerm: 'Alice',
				scope: 'database',
				resultsPerTable: 50,
			},
			() => {},
			() => false,
		)

		expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
	})

	test('generates MySQL-compatible text casts', async () => {
		const mysqlDriver = new CapturingMysqlSearchDriver()

		await searchDatabase(
			mysqlDriver,
			{
				searchTerm: 'Alice',
				scope: 'database',
				resultsPerTable: 5,
				sessionId: 'agent-session',
			},
			() => {},
			() => false,
		)

		expect(mysqlDriver.executedSql).toEqual([
			'SELECT * FROM `app`.`users` WHERE CAST(`name` AS CHAR) LIKE ? OR CAST(`age` AS CHAR) LIKE ? LIMIT ?',
		])
		expect(mysqlDriver.executedParams).toEqual([['%Alice%', '%Alice%', 5]])
		expect(mysqlDriver.schemaSessionIds).toEqual(['agent-session'])
		expect(mysqlDriver.executeSessionIds).toEqual(['agent-session'])
	})
})
