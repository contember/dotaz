/**
 * Tests for SearchService — cross-table full-text search.
 *
 * Run: bun test tests/search-service.test.ts
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SqliteDriver } from '../src/backend-shared/drivers/sqlite-driver'
import { searchDatabase } from '../src/backend-shared/services/search-service'

let driver: SqliteDriver

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
})
