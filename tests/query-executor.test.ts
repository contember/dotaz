import type { DatabaseDriver } from '@dotaz/backend-shared/db/driver'
import type { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import {
	buildCountQuery,
	buildOrderByClause,
	buildQuickSearchClause,
	buildSelectQuery,
	buildWhereClause,
	generateDelete,
	generateInsert,
	generateUpdate,
	offsetToLineColumn,
	parseErrorPosition,
	QueryExecutor,
	splitStatements,
} from '@dotaz/backend-shared/services/query-executor'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import type { ColumnFilter, SortColumn } from '@dotaz/shared/types/grid'
import type { QueryResult } from '@dotaz/shared/types/query'
import { describe, expect, mock, test } from 'bun:test'

// Minimal mock driver for quoteIdentifier, getDriverType, qualifyTable, emptyInsertSql, placeholder
function mockDriver(type: 'postgresql' | 'sqlite' | 'mysql' = 'postgresql'): DatabaseDriver {
	const quoteIdentifier = type === 'mysql'
		? (name: string) => `\`${name.replace(/`/g, '``')}\``
		: (name: string) => `"${name.replace(/"/g, '""')}"`

	return {
		quoteIdentifier,
		getDriverType() {
			return type
		},
		qualifyTable(schema: string, table: string) {
			if (type === 'sqlite' && schema === 'main') return quoteIdentifier(table)
			return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
		},
		emptyInsertSql(qualifiedTable: string) {
			if (type === 'mysql') return `INSERT INTO ${qualifiedTable} () VALUES ()`
			return `INSERT INTO ${qualifiedTable} DEFAULT VALUES`
		},
		placeholder(index: number) {
			return type === 'mysql' ? '?' : `$${index}`
		},
	} as DatabaseDriver
}

// ── buildWhereClause ────────────────────────────────────

describe('buildWhereClause', () => {
	const driver = mockDriver()

	test('returns empty for no filters', () => {
		expect(buildWhereClause(undefined, driver)).toEqual({ sql: '', params: [] })
		expect(buildWhereClause([], driver)).toEqual({ sql: '', params: [] })
	})

	test('eq operator', () => {
		const filters: ColumnFilter[] = [{ column: 'name', operator: 'eq', value: 'Alice' }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "name" = $1')
		expect(result.params).toEqual(['Alice'])
	})

	test('neq operator', () => {
		const filters: ColumnFilter[] = [{ column: 'name', operator: 'neq', value: 'Bob' }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "name" != $1')
		expect(result.params).toEqual(['Bob'])
	})

	test('gt operator', () => {
		const filters: ColumnFilter[] = [{ column: 'age', operator: 'gt', value: 25 }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "age" > $1')
		expect(result.params).toEqual([25])
	})

	test('gte operator', () => {
		const filters: ColumnFilter[] = [{ column: 'age', operator: 'gte', value: 25 }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "age" >= $1')
		expect(result.params).toEqual([25])
	})

	test('lt operator', () => {
		const filters: ColumnFilter[] = [{ column: 'age', operator: 'lt', value: 30 }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "age" < $1')
		expect(result.params).toEqual([30])
	})

	test('lte operator', () => {
		const filters: ColumnFilter[] = [{ column: 'age', operator: 'lte', value: 30 }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "age" <= $1')
		expect(result.params).toEqual([30])
	})

	test('like operator', () => {
		const filters: ColumnFilter[] = [{ column: 'name', operator: 'like', value: '%Ali%' }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "name" LIKE $1')
		expect(result.params).toEqual(['%Ali%'])
	})

	test('notLike operator', () => {
		const filters: ColumnFilter[] = [{ column: 'name', operator: 'notLike', value: '%test%' }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "name" NOT LIKE $1')
		expect(result.params).toEqual(['%test%'])
	})

	test('isNull operator', () => {
		const filters: ColumnFilter[] = [{ column: 'age', operator: 'isNull', value: null }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "age" IS NULL')
		expect(result.params).toEqual([])
	})

	test('isNotNull operator', () => {
		const filters: ColumnFilter[] = [{ column: 'age', operator: 'isNotNull', value: null }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "age" IS NOT NULL')
		expect(result.params).toEqual([])
	})

	test('in operator with array', () => {
		const filters: ColumnFilter[] = [{ column: 'id', operator: 'in', value: [1, 2, 3] }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "id" IN ($1, $2, $3)')
		expect(result.params).toEqual([1, 2, 3])
	})

	test('notIn operator', () => {
		const filters: ColumnFilter[] = [{ column: 'id', operator: 'notIn', value: [4, 5] }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "id" NOT IN ($1, $2)')
		expect(result.params).toEqual([4, 5])
	})

	test('multiple filters combined with AND', () => {
		const filters: ColumnFilter[] = [
			{ column: 'age', operator: 'gte', value: 20 },
			{ column: 'name', operator: 'like', value: '%A%' },
			{ column: 'email', operator: 'isNotNull', value: null },
		]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "age" >= $1 AND "name" LIKE $2 AND "email" IS NOT NULL')
		expect(result.params).toEqual([20, '%A%'])
	})

	test('paramOffset shifts parameter numbering', () => {
		const filters: ColumnFilter[] = [{ column: 'name', operator: 'eq', value: 'Alice' }]
		const result = buildWhereClause(filters, driver, 3)
		expect(result.sql).toBe('WHERE "name" = $4')
		expect(result.params).toEqual(['Alice'])
	})

	test('escapes identifiers with double quotes', () => {
		const filters: ColumnFilter[] = [{ column: 'col"name', operator: 'eq', value: 'x' }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE "col""name" = $1')
	})
})

// ── buildOrderByClause ──────────────────────────────────

describe('buildOrderByClause', () => {
	const driver = mockDriver()

	test('returns empty for no sort', () => {
		expect(buildOrderByClause(undefined, driver)).toBe('')
		expect(buildOrderByClause([], driver)).toBe('')
	})

	test('single column ascending', () => {
		const sort: SortColumn[] = [{ column: 'name', direction: 'asc' }]
		expect(buildOrderByClause(sort, driver)).toBe('ORDER BY "name" ASC')
	})

	test('single column descending', () => {
		const sort: SortColumn[] = [{ column: 'age', direction: 'desc' }]
		expect(buildOrderByClause(sort, driver)).toBe('ORDER BY "age" DESC')
	})

	test('multiple columns', () => {
		const sort: SortColumn[] = [
			{ column: 'name', direction: 'asc' },
			{ column: 'age', direction: 'desc' },
		]
		expect(buildOrderByClause(sort, driver)).toBe('ORDER BY "name" ASC, "age" DESC')
	})
})

// ── buildSelectQuery ────────────────────────────────────

describe('buildSelectQuery', () => {
	test('basic select with pagination (postgresql)', () => {
		const driver = mockDriver('postgresql')
		const result = buildSelectQuery('public', 'users', 1, 50, undefined, undefined, driver)
		expect(result.sql).toBe('SELECT * FROM "public"."users" LIMIT $1 OFFSET $2')
		expect(result.params).toEqual([50, 0])
	})

	test('page 2 offset calculation', () => {
		const driver = mockDriver('postgresql')
		const result = buildSelectQuery('public', 'users', 2, 50, undefined, undefined, driver)
		expect(result.params).toEqual([50, 50])
	})

	test('page 3 with pageSize 25', () => {
		const driver = mockDriver('postgresql')
		const result = buildSelectQuery('public', 'users', 3, 25, undefined, undefined, driver)
		expect(result.params).toEqual([25, 50])
	})

	test('with sort', () => {
		const driver = mockDriver('postgresql')
		const sort: SortColumn[] = [{ column: 'name', direction: 'asc' }]
		const result = buildSelectQuery('public', 'users', 1, 50, sort, undefined, driver)
		expect(result.sql).toBe('SELECT * FROM "public"."users" ORDER BY "name" ASC LIMIT $1 OFFSET $2')
		expect(result.params).toEqual([50, 0])
	})

	test('with filters', () => {
		const driver = mockDriver('postgresql')
		const filters: ColumnFilter[] = [{ column: 'age', operator: 'gt', value: 20 }]
		const result = buildSelectQuery('public', 'users', 1, 50, undefined, filters, driver)
		expect(result.sql).toBe('SELECT * FROM "public"."users" WHERE "age" > $1 LIMIT $2 OFFSET $3')
		expect(result.params).toEqual([20, 50, 0])
	})

	test('with sort and filters', () => {
		const driver = mockDriver('postgresql')
		const sort: SortColumn[] = [{ column: 'name', direction: 'desc' }]
		const filters: ColumnFilter[] = [
			{ column: 'age', operator: 'gte', value: 18 },
			{ column: 'email', operator: 'isNotNull', value: null },
		]
		const result = buildSelectQuery('public', 'users', 1, 100, sort, filters, driver)
		expect(result.sql).toBe(
			'SELECT * FROM "public"."users" WHERE "age" >= $1 AND "email" IS NOT NULL ORDER BY "name" DESC LIMIT $2 OFFSET $3',
		)
		expect(result.params).toEqual([18, 100, 0])
	})

	test('sqlite skips schema qualification for main', () => {
		const driver = mockDriver('sqlite')
		const result = buildSelectQuery('main', 'users', 1, 50, undefined, undefined, driver)
		expect(result.sql).toBe('SELECT * FROM "users" LIMIT $1 OFFSET $2')
	})

	test('sqlite with non-main schema qualifies', () => {
		const driver = mockDriver('sqlite')
		const result = buildSelectQuery('attached', 'users', 1, 50, undefined, undefined, driver)
		expect(result.sql).toBe('SELECT * FROM "attached"."users" LIMIT $1 OFFSET $2')
	})
})

// ── buildCountQuery ─────────────────────────────────────

describe('buildCountQuery', () => {
	test('basic count without filters', () => {
		const driver = mockDriver('postgresql')
		const result = buildCountQuery('public', 'users', undefined, driver)
		expect(result.sql).toBe('SELECT COUNT(*) AS count FROM "public"."users"')
		expect(result.params).toEqual([])
	})

	test('count with filters', () => {
		const driver = mockDriver('postgresql')
		const filters: ColumnFilter[] = [{ column: 'age', operator: 'gt', value: 25 }]
		const result = buildCountQuery('public', 'users', filters, driver)
		expect(result.sql).toBe('SELECT COUNT(*) AS count FROM "public"."users" WHERE "age" > $1')
		expect(result.params).toEqual([25])
	})

	test('sqlite count skips main schema', () => {
		const driver = mockDriver('sqlite')
		const result = buildCountQuery('main', 'users', undefined, driver)
		expect(result.sql).toBe('SELECT COUNT(*) AS count FROM "users"')
	})
})

// ── buildQuickSearchClause ────────────────────────────────

describe('buildQuickSearchClause', () => {
	const pgDriver = mockDriver('postgresql')
	const sqliteDriver = mockDriver('sqlite')

	const columns = [
		{ name: 'name', dataType: DatabaseDataType.Varchar },
		{ name: 'email', dataType: DatabaseDataType.Text },
		{ name: 'age', dataType: DatabaseDataType.Integer },
	]

	test('returns empty for empty search term', () => {
		expect(buildQuickSearchClause(columns, '', pgDriver)).toEqual({ sql: '', params: [] })
	})

	test('returns empty for empty columns', () => {
		expect(buildQuickSearchClause([], 'test', pgDriver)).toEqual({ sql: '', params: [] })
	})

	test('generates OR ILIKE conditions for PostgreSQL', () => {
		const result = buildQuickSearchClause(columns, 'alice', pgDriver)
		expect(result.sql).toBe(
			'(CAST("name" AS TEXT) ILIKE $1 OR CAST("email" AS TEXT) ILIKE $2 OR CAST("age" AS TEXT) ILIKE $3)',
		)
		expect(result.params).toEqual(['%alice%', '%alice%', '%alice%'])
	})

	test('generates OR LIKE conditions for SQLite', () => {
		const result = buildQuickSearchClause(columns, 'alice', sqliteDriver)
		expect(result.sql).toBe(
			'(CAST("name" AS TEXT) LIKE $1 OR CAST("email" AS TEXT) LIKE $2 OR CAST("age" AS TEXT) LIKE $3)',
		)
		expect(result.params).toEqual(['%alice%', '%alice%', '%alice%'])
	})

	test('excludes binary columns', () => {
		const cols = [
			{ name: 'name', dataType: DatabaseDataType.Varchar },
			{ name: 'avatar', dataType: DatabaseDataType.Binary },
		]
		const result = buildQuickSearchClause(cols, 'test', pgDriver)
		expect(result.sql).toBe('(CAST("name" AS TEXT) ILIKE $1)')
		expect(result.params).toEqual(['%test%'])
	})

	test('excludes blob columns', () => {
		const cols = [
			{ name: 'name', dataType: DatabaseDataType.Text },
			{ name: 'data', dataType: DatabaseDataType.Binary },
		]
		const result = buildQuickSearchClause(cols, 'test', sqliteDriver)
		expect(result.sql).toBe('(CAST("name" AS TEXT) LIKE $1)')
		expect(result.params).toEqual(['%test%'])
	})

	test('returns empty when all columns are binary', () => {
		const cols = [{ name: 'data', dataType: DatabaseDataType.Binary }]
		expect(buildQuickSearchClause(cols, 'test', pgDriver)).toEqual({ sql: '', params: [] })
	})

	test('respects paramOffset', () => {
		const cols = [{ name: 'name', dataType: DatabaseDataType.Text }]
		const result = buildQuickSearchClause(cols, 'test', pgDriver, 3)
		expect(result.sql).toBe('(CAST("name" AS TEXT) ILIKE $4)')
		expect(result.params).toEqual(['%test%'])
	})
})

// ── buildSelectQuery with quickSearch ────────────────────

describe('buildSelectQuery with quickSearch', () => {
	test('adds quick search to WHERE clause', () => {
		const driver = mockDriver('postgresql')
		const quickSearch = {
			sql: '(CAST("name" AS TEXT) ILIKE $1)',
			params: ['%test%'],
		}
		const result = buildSelectQuery('public', 'users', 1, 50, undefined, undefined, driver, quickSearch)
		expect(result.sql).toBe(
			'SELECT * FROM "public"."users" WHERE (CAST("name" AS TEXT) ILIKE $1) LIMIT $2 OFFSET $3',
		)
		expect(result.params).toEqual(['%test%', 50, 0])
	})

	test('combines filters and quick search with AND', () => {
		const driver = mockDriver('postgresql')
		const filters: ColumnFilter[] = [{ column: 'age', operator: 'gt', value: 20 }]
		const quickSearch = {
			sql: '(CAST("name" AS TEXT) ILIKE $2)',
			params: ['%test%'],
		}
		const result = buildSelectQuery('public', 'users', 1, 50, undefined, filters, driver, quickSearch)
		expect(result.sql).toBe(
			'SELECT * FROM "public"."users" WHERE "age" > $1 AND (CAST("name" AS TEXT) ILIKE $2) LIMIT $3 OFFSET $4',
		)
		expect(result.params).toEqual([20, '%test%', 50, 0])
	})
})

// ── buildCountQuery with quickSearch ─────────────────────

describe('buildCountQuery with quickSearch', () => {
	test('adds quick search to count query', () => {
		const driver = mockDriver('postgresql')
		const quickSearch = {
			sql: '(CAST("name" AS TEXT) ILIKE $1)',
			params: ['%test%'],
		}
		const result = buildCountQuery('public', 'users', undefined, driver, quickSearch)
		expect(result.sql).toBe(
			'SELECT COUNT(*) AS count FROM "public"."users" WHERE (CAST("name" AS TEXT) ILIKE $1)',
		)
		expect(result.params).toEqual(['%test%'])
	})

	test('combines filters and quick search in count', () => {
		const driver = mockDriver('postgresql')
		const filters: ColumnFilter[] = [{ column: 'age', operator: 'gt', value: 20 }]
		const quickSearch = {
			sql: '(CAST("name" AS TEXT) ILIKE $2)',
			params: ['%test%'],
		}
		const result = buildCountQuery('public', 'users', filters, driver, quickSearch)
		expect(result.sql).toBe(
			'SELECT COUNT(*) AS count FROM "public"."users" WHERE "age" > $1 AND (CAST("name" AS TEXT) ILIKE $2)',
		)
		expect(result.params).toEqual([20, '%test%'])
	})
})

// ── MySQL placeholder generation ────────────────────────────

describe('MySQL placeholder generation', () => {
	const driver = mockDriver('mysql')

	test('buildWhereClause uses ? placeholders', () => {
		const filters: ColumnFilter[] = [{ column: 'name', operator: 'eq', value: 'Alice' }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE `name` = ?')
		expect(result.params).toEqual(['Alice'])
	})

	test('buildWhereClause uses ? for multiple filters', () => {
		const filters: ColumnFilter[] = [
			{ column: 'age', operator: 'gte', value: 18 },
			{ column: 'name', operator: 'like', value: '%A%' },
		]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE `age` >= ? AND `name` LIKE ?')
		expect(result.params).toEqual([18, '%A%'])
	})

	test('buildWhereClause uses ? for IN operator', () => {
		const filters: ColumnFilter[] = [{ column: 'id', operator: 'in', value: [1, 2, 3] }]
		const result = buildWhereClause(filters, driver)
		expect(result.sql).toBe('WHERE `id` IN (?, ?, ?)')
		expect(result.params).toEqual([1, 2, 3])
	})

	test('buildSelectQuery uses ? placeholders for pagination', () => {
		const result = buildSelectQuery('mydb', 'products', 1, 50, undefined, undefined, driver)
		expect(result.sql).toBe('SELECT * FROM `mydb`.`products` LIMIT ? OFFSET ?')
		expect(result.params).toEqual([50, 0])
	})

	test('buildSelectQuery combines filters and pagination with ? placeholders', () => {
		const filters: ColumnFilter[] = [{ column: 'price', operator: 'gt', value: 100 }]
		const result = buildSelectQuery('mydb', 'products', 2, 25, undefined, filters, driver)
		expect(result.sql).toBe('SELECT * FROM `mydb`.`products` WHERE `price` > ? LIMIT ? OFFSET ?')
		expect(result.params).toEqual([100, 25, 25])
	})

	test('buildCountQuery uses ? placeholders', () => {
		const filters: ColumnFilter[] = [{ column: 'active', operator: 'eq', value: true }]
		const result = buildCountQuery('mydb', 'users', filters, driver)
		expect(result.sql).toBe('SELECT COUNT(*) AS count FROM `mydb`.`users` WHERE `active` = ?')
		expect(result.params).toEqual([true])
	})

	test('generateInsert uses ? placeholders', () => {
		const change = {
			type: 'insert' as const,
			schema: 'mydb',
			table: 'products',
			values: { name: 'Widget', price: 9.99 },
		}
		const result = generateInsert(change, driver)
		expect(result.sql).toBe('INSERT INTO `mydb`.`products` (`name`, `price`) VALUES (?, ?)')
		expect(result.params).toEqual(['Widget', 9.99])
	})

	test('generateUpdate uses ? placeholders', () => {
		const change = {
			type: 'update' as const,
			schema: 'mydb',
			table: 'products',
			primaryKeys: { id: 1 },
			values: { name: 'Updated Widget' },
		}
		const result = generateUpdate(change, driver)
		expect(result.sql).toBe('UPDATE `mydb`.`products` SET `name` = ? WHERE `id` = ?')
		expect(result.params).toEqual(['Updated Widget', 1])
	})

	test('generateDelete uses ? placeholders', () => {
		const change = {
			type: 'delete' as const,
			schema: 'mydb',
			table: 'products',
			primaryKeys: { id: 42 },
		}
		const result = generateDelete(change, driver)
		expect(result.sql).toBe('DELETE FROM `mydb`.`products` WHERE `id` = ?')
		expect(result.params).toEqual([42])
	})

	test('buildQuickSearchClause uses ? placeholders', () => {
		const columns = [
			{ name: 'name', dataType: DatabaseDataType.Varchar },
			{ name: 'description', dataType: DatabaseDataType.Text },
		]
		const result = buildQuickSearchClause(columns, 'test', driver)
		expect(result.sql).toBe(
			'(CAST(`name` AS TEXT) LIKE ? OR CAST(`description` AS TEXT) LIKE ?)',
		)
		expect(result.params).toEqual(['%test%', '%test%'])
	})

	test('values containing $ are not corrupted', () => {
		const change = {
			type: 'insert' as const,
			schema: 'mydb',
			table: 'products',
			values: { name: 'costs $100', description: '$1 deal' },
		}
		const result = generateInsert(change, driver)
		expect(result.sql).toBe('INSERT INTO `mydb`.`products` (`name`, `description`) VALUES (?, ?)')
		expect(result.params).toEqual(['costs $100', '$1 deal'])
		// The SQL itself contains no $N tokens that could be misinterpreted
		expect(result.sql).not.toMatch(/\$\d+/)
	})
})

// ── splitStatements ────────────────────────────────────────

describe('splitStatements', () => {
	test('single statement without semicolon', () => {
		expect(splitStatements('SELECT 1')).toEqual(['SELECT 1'])
	})

	test('single statement with trailing semicolon', () => {
		expect(splitStatements('SELECT 1;')).toEqual(['SELECT 1'])
	})

	test('multiple statements', () => {
		expect(splitStatements('SELECT 1; SELECT 2; SELECT 3')).toEqual([
			'SELECT 1',
			'SELECT 2',
			'SELECT 3',
		])
	})

	test('ignores semicolons inside single-quoted strings', () => {
		expect(splitStatements("SELECT 'a;b'; SELECT 2")).toEqual([
			"SELECT 'a;b'",
			'SELECT 2',
		])
	})

	test('ignores semicolons inside double-quoted strings', () => {
		expect(splitStatements('SELECT "a;b"; SELECT 2')).toEqual([
			'SELECT "a;b"',
			'SELECT 2',
		])
	})

	test('empty input returns empty array', () => {
		expect(splitStatements('')).toEqual([])
	})

	test('whitespace-only input returns empty array', () => {
		expect(splitStatements('   ')).toEqual([])
	})

	test('trims whitespace from statements', () => {
		expect(splitStatements('  SELECT 1 ;  SELECT 2  ')).toEqual([
			'SELECT 1',
			'SELECT 2',
		])
	})

	test('skips empty statements between semicolons', () => {
		expect(splitStatements('SELECT 1;;; SELECT 2')).toEqual([
			'SELECT 1',
			'SELECT 2',
		])
	})
})

// ── QueryExecutor ──────────────────────────────────────────

function makeSuccessResult(rows: Record<string, unknown>[] = [], durationMs = 0): QueryResult {
	const columns = rows.length > 0
		? Object.keys(rows[0]).map((name) => ({ name, dataType: DatabaseDataType.Unknown }))
		: []
	return { columns, rows, rowCount: rows.length, durationMs }
}

function makeMockDriver(overrides?: Partial<DatabaseDriver>): DatabaseDriver {
	return {
		execute: mock(async () => makeSuccessResult([{ id: 1 }])),
		cancel: mock(async () => {}),
		reserveSession: mock(async () => {}),
		releaseSession: mock(async () => {}),
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

describe('QueryExecutor', () => {
	test('executes a single SELECT and returns results', async () => {
		const rows = [{ id: 1, name: 'Alice' }]
		const driver = makeMockDriver({
			execute: mock(async () => makeSuccessResult(rows)),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'SELECT * FROM users')

		expect(results).toHaveLength(1)
		expect(results[0].rows).toEqual(rows)
		expect(results[0].columns).toEqual([
			{ name: 'id', dataType: DatabaseDataType.Unknown },
			{ name: 'name', dataType: DatabaseDataType.Unknown },
		])
		expect(results[0].error).toBeUndefined()
		expect(results[0].durationMs).toBeGreaterThanOrEqual(0)
		expect(driver.execute).toHaveBeenCalledTimes(1)
	})

	test('passes params for single-statement query', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		await executor.executeQuery('conn-1', 'SELECT * FROM users WHERE id = $1', [42])

		const calls = (driver.execute as ReturnType<typeof mock>).mock.calls
		expect(calls).toHaveLength(1)
		expect(calls[0][0]).toBe('SELECT * FROM users WHERE id = $1')
		expect(calls[0][1]).toEqual([42])
	})

	test('multi-statement execution returns multiple results', async () => {
		let callCount = 0
		const driver = makeMockDriver({
			execute: mock(async () => {
				callCount++
				return makeSuccessResult([{ n: callCount }])
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery(
			'conn-1',
			'SELECT 1; SELECT 2; SELECT 3',
		)

		expect(results).toHaveLength(3)
		expect(results[0].rows).toEqual([{ n: 1 }])
		expect(results[1].rows).toEqual([{ n: 2 }])
		expect(results[2].rows).toEqual([{ n: 3 }])
		expect(driver.execute).toHaveBeenCalledTimes(3)
	})

	test('multi-statement does not pass params to individual statements', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		await executor.executeQuery('conn-1', 'SELECT 1; SELECT 2', [42])

		// Params should be undefined for individual statements in a multi-statement batch.
		// The third argument is the ephemeral sessionId (a UUID string).
		const calls = (driver.execute as ReturnType<typeof mock>).mock.calls
		expect(calls[0][0]).toBe('SELECT 1')
		expect(calls[0][1]).toBeUndefined()
		expect(calls[0][2]).toBeString() // ephemeral sessionId
	})

	test('DML query returns affected rows', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => ({
				columns: [],
				rows: [],
				rowCount: 0,
				affectedRows: 5,
				durationMs: 10,
			})),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'DELETE FROM users WHERE age < 18')

		expect(results).toHaveLength(1)
		expect(results[0].affectedRows).toBe(5)
		expect(results[0].rows).toEqual([])
	})

	test('measures duration', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 20))
				return makeSuccessResult()
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'SELECT pg_sleep(0.02)')

		expect(results[0].durationMs).toBeGreaterThanOrEqual(15)
	})

	test('catches errors and returns them in result', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				throw new Error('relation "nope" does not exist')
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'SELECT * FROM nope')

		expect(results).toHaveLength(1)
		expect(results[0].error).toBe('relation "nope" does not exist')
		expect(results[0].rows).toEqual([])
		expect(results[0].columns).toEqual([])
		expect(results[0].durationMs).toBeGreaterThanOrEqual(0)
	})

	test('stops multi-statement execution on error', async () => {
		let callCount = 0
		const driver = makeMockDriver({
			execute: mock(async (_sql: string) => {
				callCount++
				if (callCount === 2) throw new Error('syntax error')
				return makeSuccessResult([{ n: callCount }])
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery(
			'conn-1',
			'SELECT 1; BAD SQL; SELECT 3',
		)

		expect(results).toHaveLength(2)
		expect(results[0].error).toBeUndefined()
		expect(results[1].error).toBe('syntax error')
		expect(driver.execute).toHaveBeenCalledTimes(2)
	})

	test('timeout rejects long-running queries', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 200))
				return makeSuccessResult()
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 50) // 50ms timeout

		const results = await executor.executeQuery('conn-1', 'SELECT pg_sleep(1)')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('timed out')
	})

	test('custom timeout overrides default', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 200))
				return makeSuccessResult()
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 10_000) // high default

		const results = await executor.executeQuery('conn-1', 'SELECT pg_sleep(1)', undefined, 50)

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('timed out')
	})

	test('timeout calls driver.cancel() to stop server-side query', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 200))
				return makeSuccessResult()
			}),
			cancel: mock(async () => {}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 50)

		const results = await executor.executeQuery('conn-1', 'SELECT pg_sleep(300)')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('timed out')
		expect(driver.cancel).toHaveBeenCalledTimes(1)
	})

	test('pool query passes poolQueryKey to driver.execute for targeted cancellation', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		await executor.executeQuery('conn-1', 'SELECT 1')

		const executeCalls = (driver.execute as ReturnType<typeof mock>).mock.calls
		expect(executeCalls).toHaveLength(1)
		// Pool queries should pass (sql, params, undefined sessionId, symbol poolQueryKey)
		expect(executeCalls[0][2]).toBeUndefined() // no sessionId
		expect(typeof executeCalls[0][3]).toBe('symbol') // poolQueryKey
	})

	test('timeout calls driver.cancel() with poolQueryKey to cancel only the specific query', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 200))
				return makeSuccessResult()
			}),
			cancel: mock(async () => {}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 50)

		const results = await executor.executeQuery('conn-1', 'SELECT pg_sleep(300)')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('timed out')
		// cancel should be called with (undefined, symbol) — targeting only this query
		const cancelCalls = (driver.cancel as ReturnType<typeof mock>).mock.calls
		expect(cancelCalls).toHaveLength(1)
		expect(cancelCalls[0][0]).toBeUndefined()
		expect(typeof cancelCalls[0][1]).toBe('symbol')
	})

	test('timeout calls driver.cancel() with sessionId when using a session', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 200))
				return makeSuccessResult()
			}),
			cancel: mock(async () => {}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 50)

		const results = await executor.executeQuery('conn-1', 'SELECT pg_sleep(300)', undefined, undefined, undefined, undefined, 'my-session')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('timed out')
		expect(driver.cancel).toHaveBeenCalledWith('my-session')
	})

	test('timed-out DML returns STATEMENT_UNCERTAIN', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 200))
				return makeSuccessResult()
			}),
			cancel: mock(async () => {}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 50)

		for (
			const sql of [
				'UPDATE users SET name = $1',
				'INSERT INTO t VALUES (1)',
				'DELETE FROM t WHERE id = 1',
				'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE',
			]
		) {
			const results = await executor.executeQuery('conn-1', sql)
			expect(results).toHaveLength(1)
			expect(results[0].errorCode).toBe('STATEMENT_UNCERTAIN')
			expect(results[0].error).toContain('may have been executed')
		}
	})

	test('timed-out SELECT does not return STATEMENT_UNCERTAIN', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 200))
				return makeSuccessResult()
			}),
			cancel: mock(async () => {}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 50)

		const results = await executor.executeQuery('conn-1', 'SELECT * FROM users')

		expect(results).toHaveLength(1)
		expect(results[0].errorCode).toBeUndefined()
		expect(results[0].error).toContain('timed out')
	})

	test('timed-out COMMIT still returns COMMIT_UNCERTAIN, not STATEMENT_UNCERTAIN', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 200))
				return makeSuccessResult()
			}),
			cancel: mock(async () => {}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 50)

		const results = await executor.executeQuery('conn-1', 'COMMIT', undefined, undefined, undefined, undefined, 'my-session')

		expect(results).toHaveLength(1)
		expect(results[0].errorCode).toBe('COMMIT_UNCERTAIN')
	})

	test('cancelQuery cancels a running query', async () => {
		let resolveExecute: () => void
		const executePromise = new Promise<void>((r) => {
			resolveExecute = r
		})

		const driver = makeMockDriver({
			execute: mock(async () => {
				await executePromise
				return makeSuccessResult()
			}),
			cancel: mock(async () => {
				resolveExecute!()
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 5000)

		const resultPromise = executor.executeQuery('conn-1', 'SELECT pg_sleep(10)')

		// Wait for query to start
		await new Promise((r) => setTimeout(r, 10))

		const queryIds = executor.getRunningQueryIds()
		expect(queryIds).toHaveLength(1)

		const cancelled = await executor.cancelQuery(queryIds[0])
		expect(cancelled).toBe(true)

		const results = await resultPromise
		expect(results).toHaveLength(1)
		expect(results[0].error).toBe('Query was cancelled')
		expect(driver.cancel).toHaveBeenCalled()
	})

	test('cancelQuery returns false for unknown queryId', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const cancelled = await executor.cancelQuery('nonexistent')
		expect(cancelled).toBe(false)
	})

	test('running queries are cleaned up after execution', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		expect(executor.getRunningQueryIds()).toHaveLength(0)
		await executor.executeQuery('conn-1', 'SELECT 1')
		expect(executor.getRunningQueryIds()).toHaveLength(0)
	})

	test('cancelAllForConnection cancels all queries for a specific connection', async () => {
		let resolve1: () => void
		let resolve2: () => void
		const promise1 = new Promise<void>((r) => {
			resolve1 = r
		})
		const promise2 = new Promise<void>((r) => {
			resolve2 = r
		})

		const driver1 = makeMockDriver({
			execute: mock(async () => {
				await promise1
				return makeSuccessResult()
			}),
			cancel: mock(async () => {
				resolve1!()
			}),
		})
		const driver2 = makeMockDriver({
			execute: mock(async () => {
				await promise2
				return makeSuccessResult()
			}),
			cancel: mock(async () => {
				resolve2!()
			}),
		})

		const cm = {
			getDriver: mock((connectionId: string) => connectionId === 'conn-1' ? driver1 : driver2),
		} as unknown as ConnectionManager
		const executor = new QueryExecutor(cm, 5000)

		// Start two queries on different connections
		const result1Promise = executor.executeQuery('conn-1', 'SELECT 1')
		const result2Promise = executor.executeQuery('conn-2', 'SELECT 2')

		await new Promise((r) => setTimeout(r, 10))

		expect(executor.getRunningQueryIds()).toHaveLength(2)

		// Cancel only conn-1 queries
		const cancelled = await executor.cancelAllForConnection('conn-1')
		expect(cancelled).toBe(1)

		const results1 = await result1Promise
		expect(results1[0].error).toBe('Query was cancelled')

		// conn-2 should still be running
		expect(executor.getRunningQueryIds()).toHaveLength(1)

		// Clean up conn-2
		resolve2!()
		await result2Promise
	})

	test('cancelAllForConnection returns 0 when no queries match', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const cancelled = await executor.cancelAllForConnection('nonexistent')
		expect(cancelled).toBe(0)
	})

	test('empty SQL returns empty results', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', '')
		expect(results).toEqual([])
		expect(driver.execute).not.toHaveBeenCalled()
	})

	test('captures error position from PostgreSQL-style error', async () => {
		const pgError = Object.assign(new Error('syntax error at or near "SELEC"'), {
			position: '1',
		})
		const driver = makeMockDriver({
			execute: mock(async () => {
				throw pgError
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'SELEC * FROM users')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('syntax error')
		expect(results[0].errorPosition).toBeDefined()
		expect(results[0].errorPosition!.line).toBe(1)
		expect(results[0].errorPosition!.column).toBe(1)
		expect(results[0].errorPosition!.offset).toBe(1)
	})

	test('captures error position on second line', async () => {
		const pgError = Object.assign(new Error('syntax error'), {
			position: '15',
		})
		const driver = makeMockDriver({
			execute: mock(async () => {
				throw pgError
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'SELECT *\nFROM  nope')

		expect(results[0].errorPosition).toBeDefined()
		expect(results[0].errorPosition!.line).toBe(2)
		expect(results[0].errorPosition!.column).toBe(6)
		expect(results[0].errorPosition!.offset).toBe(15)
	})

	test('no errorPosition for errors without position info', async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				throw new Error('connection lost')
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'SELECT 1')

		expect(results[0].error).toBe('connection lost')
		expect(results[0].errorPosition).toBeUndefined()
	})
})

// ── QueryExecutor — session affinity ─────────────────────

describe('QueryExecutor session affinity', () => {
	test('single-statement without sessionId does not reserve session', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		await executor.executeQuery('conn-1', 'SELECT 1')

		expect(driver.reserveSession).not.toHaveBeenCalled()
		expect(driver.releaseSession).not.toHaveBeenCalled()
	})

	test('multi-statement without sessionId auto-reserves ephemeral session', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		await executor.executeQuery('conn-1', 'SELECT 1; SELECT 2')

		expect(driver.reserveSession).toHaveBeenCalledTimes(1)
		const reservedId = (driver.reserveSession as ReturnType<typeof mock>).mock.calls[0][0]
		expect(reservedId).toStartWith('__ephemeral_')

		expect(driver.releaseSession).toHaveBeenCalledTimes(1)
		expect((driver.releaseSession as ReturnType<typeof mock>).mock.calls[0][0]).toBe(reservedId)
	})

	test('multi-statement threads ephemeral sessionId to all execute calls', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		await executor.executeQuery('conn-1', 'SELECT 1; SELECT 2; SELECT 3')

		const executeCalls = (driver.execute as ReturnType<typeof mock>).mock.calls
		expect(executeCalls).toHaveLength(3)

		const sessionId = executeCalls[0][2]
		expect(sessionId).toStartWith('__ephemeral_')
		// All statements use the same sessionId
		expect(executeCalls[1][2]).toBe(sessionId)
		expect(executeCalls[2][2]).toBe(sessionId)
	})

	test('ephemeral session is released even on error', async () => {
		let callCount = 0
		const driver = makeMockDriver({
			execute: mock(async () => {
				callCount++
				if (callCount === 2) throw new Error('fail')
				return makeSuccessResult()
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		await executor.executeQuery('conn-1', 'SELECT 1; BAD SQL; SELECT 3')

		expect(driver.reserveSession).toHaveBeenCalledTimes(1)
		expect(driver.releaseSession).toHaveBeenCalledTimes(1)
	})

	test('explicit sessionId skips ephemeral reservation', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		await executor.executeQuery('conn-1', 'SELECT 1; SELECT 2', undefined, undefined, undefined, undefined, 'my-session')

		expect(driver.reserveSession).not.toHaveBeenCalled()
		expect(driver.releaseSession).not.toHaveBeenCalled()

		const executeCalls = (driver.execute as ReturnType<typeof mock>).mock.calls
		expect(executeCalls[0][2]).toBe('my-session')
		expect(executeCalls[1][2]).toBe('my-session')
	})

	test('single-statement with explicit sessionId threads it to execute', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		await executor.executeQuery('conn-1', 'SELECT 1', undefined, undefined, undefined, undefined, 'my-session')

		const executeCalls = (driver.execute as ReturnType<typeof mock>).mock.calls
		expect(executeCalls[0][2]).toBe('my-session')
	})

	test('cancelQuery passes sessionId to driver.cancel for ephemeral session', async () => {
		let resolveExecute: () => void
		const executePromise = new Promise<void>((r) => {
			resolveExecute = r
		})

		const driver = makeMockDriver({
			execute: mock(async () => {
				await executePromise
				return makeSuccessResult()
			}),
			cancel: mock(async () => {
				resolveExecute!()
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 5000)

		const resultPromise = executor.executeQuery('conn-1', 'SELECT 1; SELECT 2')

		await new Promise((r) => setTimeout(r, 10))

		const queryIds = executor.getRunningQueryIds()
		expect(queryIds).toHaveLength(1)

		await executor.cancelQuery(queryIds[0])

		await resultPromise

		// cancel was called with the ephemeral sessionId
		const cancelCalls = (driver.cancel as ReturnType<typeof mock>).mock.calls
		expect(cancelCalls[0][0]).toStartWith('__ephemeral_')
	})

	test('cancelQuery calls driver.cancel without sessionId for single-statement', async () => {
		let resolveExecute: () => void
		const executePromise = new Promise<void>((r) => {
			resolveExecute = r
		})

		const driver = makeMockDriver({
			execute: mock(async () => {
				await executePromise
				return makeSuccessResult()
			}),
			cancel: mock(async () => {
				resolveExecute!()
			}),
		})
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm, 5000)

		const resultPromise = executor.executeQuery('conn-1', 'SELECT 1')

		await new Promise((r) => setTimeout(r, 10))

		const queryIds = executor.getRunningQueryIds()
		await executor.cancelQuery(queryIds[0])

		await resultPromise

		// cancel was called without sessionId but with poolQueryKey
		const cancelCalls = (driver.cancel as ReturnType<typeof mock>).mock.calls
		expect(cancelCalls).toHaveLength(1)
		expect(cancelCalls[0][0]).toBeUndefined()
		expect(typeof cancelCalls[0][1]).toBe('symbol')
	})
})

// ── QueryExecutor — pool transaction-control rejection ───

describe('QueryExecutor pool transaction-control rejection', () => {
	test('rejects BEGIN without sessionId', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'BEGIN')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('require a session')
		expect(driver.execute).not.toHaveBeenCalled()
	})

	test('rejects COMMIT without sessionId', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'COMMIT')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('require a session')
		expect(driver.execute).not.toHaveBeenCalled()
	})

	test('rejects ROLLBACK without sessionId', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'ROLLBACK')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('require a session')
		expect(driver.execute).not.toHaveBeenCalled()
	})

	test('rejects END without sessionId', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'END')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('require a session')
	})

	test('rejects START TRANSACTION without sessionId', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'START TRANSACTION')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('require a session')
	})

	test('allows BEGIN with sessionId', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'BEGIN', undefined, undefined, undefined, undefined, 'my-session')

		expect(results).toHaveLength(1)
		expect(results[0].error).toBeUndefined()
		expect(driver.execute).toHaveBeenCalled()
	})

	test('allows ROLLBACK TO without sessionId (savepoint, not tx control)', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'ROLLBACK TO my_savepoint')

		expect(results).toHaveLength(1)
		expect(results[0].error).toBeUndefined()
		expect(driver.execute).toHaveBeenCalled()
	})

	test('case-insensitive rejection', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', '  begin  ')

		expect(results).toHaveLength(1)
		expect(results[0].error).toContain('require a session')
	})

	test('allows regular statements without sessionId', async () => {
		const driver = makeMockDriver()
		const cm = makeMockConnectionManager(driver)
		const executor = new QueryExecutor(cm)

		const results = await executor.executeQuery('conn-1', 'SELECT 1')

		expect(results).toHaveLength(1)
		expect(results[0].error).toBeUndefined()
	})
})

// ── offsetToLineColumn ────────────────────────────────────

describe('offsetToLineColumn', () => {
	test('offset 1 on single line', () => {
		expect(offsetToLineColumn('SELECT 1', 1)).toEqual({ line: 1, column: 1 })
	})

	test('offset in the middle of single line', () => {
		expect(offsetToLineColumn('SELECT 1', 5)).toEqual({ line: 1, column: 5 })
	})

	test('offset on second line', () => {
		expect(offsetToLineColumn('SELECT *\nFROM users', 10)).toEqual({ line: 2, column: 1 })
	})

	test('offset in the middle of second line', () => {
		expect(offsetToLineColumn('SELECT *\nFROM users', 14)).toEqual({ line: 2, column: 5 })
	})

	test('offset at the end of first line (newline char)', () => {
		expect(offsetToLineColumn('SELECT *\nFROM users', 9)).toEqual({ line: 1, column: 9 })
	})

	test('offset on third line', () => {
		expect(offsetToLineColumn('SELECT *\nFROM users\nWHERE id = 1', 21)).toEqual({ line: 3, column: 1 })
	})

	test('offset past end of string clamps', () => {
		expect(offsetToLineColumn('SELECT 1', 100)).toEqual({ line: 1, column: 9 })
	})
})

// ── parseErrorPosition ──────────────────────────────────

describe('parseErrorPosition', () => {
	test('parses PostgreSQL position field', () => {
		const err = Object.assign(new Error('syntax error'), { position: '7' })
		const result = parseErrorPosition(err, 'SELEC * FROM users')
		expect(result).toBeDefined()
		expect(result!.offset).toBe(7)
		expect(result!.line).toBe(1)
		expect(result!.column).toBe(7)
	})

	test('parses numeric position', () => {
		const err = Object.assign(new Error('syntax error'), { position: 7 })
		const result = parseErrorPosition(err, 'SELEC * FROM users')
		expect(result).toBeDefined()
		expect(result!.offset).toBe(7)
	})

	test('returns undefined for errors without position', () => {
		const err = new Error('connection lost')
		expect(parseErrorPosition(err, 'SELECT 1')).toBeUndefined()
	})

	test('returns undefined for null input', () => {
		expect(parseErrorPosition(null, 'SELECT 1')).toBeUndefined()
	})

	test('returns undefined for non-object input', () => {
		expect(parseErrorPosition('string error', 'SELECT 1')).toBeUndefined()
	})

	test('parses SQLite offset from error message', () => {
		const err = new Error('near "SELEC": syntax error at offset 0')
		const result = parseErrorPosition(err, 'SELEC * FROM users')
		expect(result).toBeDefined()
		expect(result!.offset).toBe(1) // 0-based converted to 1-based
		expect(result!.line).toBe(1)
		expect(result!.column).toBe(1)
	})

	test('returns undefined for invalid position value', () => {
		const err = Object.assign(new Error('error'), { position: 'abc' })
		expect(parseErrorPosition(err, 'SELECT 1')).toBeUndefined()
	})

	test('returns undefined for position 0', () => {
		const err = Object.assign(new Error('error'), { position: '0' })
		expect(parseErrorPosition(err, 'SELECT 1')).toBeUndefined()
	})
})
