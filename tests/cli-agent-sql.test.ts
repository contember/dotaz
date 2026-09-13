import { describe, expect, test } from 'bun:test'
import { CliError, EXIT } from '../src/cli-agent/errors'
import { applySqlLimit, buildExplainSql, buildRowsQuery, dialectFor, parseColumnList, parseOrderBy } from '../src/cli-agent/sql'

function exitCodeOf(fn: () => unknown): number | undefined {
	try {
		fn()
		return undefined
	} catch (err) {
		return err instanceof CliError ? err.exitCode : undefined
	}
}

describe('parseOrderBy', () => {
	test('defaults to ascending', () => {
		expect(parseOrderBy('id')).toEqual([{ column: 'id', direction: 'asc' }])
	})

	test('parses several keys with directions', () => {
		expect(parseOrderBy('created_at:desc, id')).toEqual([
			{ column: 'created_at', direction: 'desc' },
			{ column: 'id', direction: 'asc' },
		])
	})

	test('rejects an unknown direction', () => {
		expect(exitCodeOf(() => parseOrderBy('id:sideways'))).toBe(EXIT.usage)
	})

	test('undefined stays undefined', () => {
		expect(parseOrderBy(undefined)).toBeUndefined()
	})
})

describe('parseColumnList', () => {
	test('splits and trims', () => {
		expect(parseColumnList('id, name ')).toEqual(['id', 'name'])
	})

	test('rejects an empty list', () => {
		expect(exitCodeOf(() => parseColumnList(' , '))).toBe(EXIT.usage)
	})
})

describe('buildRowsQuery', () => {
	test('quotes identifiers with the PostgreSQL dialect', () => {
		const { sql, params } = buildRowsQuery({
			schema: 'public',
			table: 'orders',
			dialect: dialectFor('postgresql'),
			limit: 20,
			offset: 0,
		})
		expect(sql).toBe('SELECT * FROM "public"."orders" LIMIT $1 OFFSET $2')
		expect(params).toEqual([20, 0])
	})

	test('quotes identifiers with the MySQL dialect', () => {
		const { sql } = buildRowsQuery({ schema: 'shopdb', table: 'items', dialect: dialectFor('mysql'), limit: 5, offset: 5 })
		expect(sql).toBe('SELECT * FROM `shopdb`.`items` LIMIT ? OFFSET ?')
	})

	test('SQLite omits the main schema prefix', () => {
		const { sql } = buildRowsQuery({ schema: 'main', table: 'tasks', dialect: dialectFor('sqlite'), limit: 1, offset: 0 })
		expect(sql).toBe('SELECT * FROM "tasks" LIMIT $1 OFFSET $2')
	})

	test('column and sort identifiers are quoted, --where is not', () => {
		const { sql } = buildRowsQuery({
			schema: 'public',
			table: 'orders',
			dialect: dialectFor('postgresql'),
			columns: ['id', 'total amount'],
			sort: [{ column: 'created_at', direction: 'desc' }],
			where: "status = 'new'",
			limit: 10,
			offset: 20,
		})
		expect(sql).toBe(
			'SELECT "id", "total amount" FROM "public"."orders" WHERE (status = \'new\') ORDER BY "created_at" DESC LIMIT $1 OFFSET $2',
		)
	})

	test('embedded quotes in identifiers are escaped, not concatenated raw', () => {
		const { sql } = buildRowsQuery({ schema: 'public', table: 'we"ird', dialect: dialectFor('postgresql'), limit: 1, offset: 0 })
		expect(sql).toContain('"we""ird"')
	})
})

describe('applySqlLimit', () => {
	test('appends LIMIT to a plain SELECT', () => {
		const limited = applySqlLimit('SELECT * FROM orders', 10, 'postgresql')
		expect(limited.mode).toBe('sql')
		expect(limited.sql).toBe('SELECT * FROM orders\nLIMIT 10')
	})

	test('every supported engine gets the same clause', () => {
		expect(applySqlLimit('select id from t', 5, 'mysql').sql).toBe('select id from t\nLIMIT 5')
		expect(applySqlLimit('select id from t', 5, 'sqlite').sql).toBe('select id from t\nLIMIT 5')
	})

	test('a trailing semicolon is dropped, so LIMIT lands inside the statement', () => {
		expect(applySqlLimit('SELECT 1;', 3, 'postgresql').sql).toBe('SELECT 1\nLIMIT 3')
	})

	test('a trailing line comment cannot swallow the clause', () => {
		const limited = applySqlLimit('SELECT 1 -- why', 3, 'postgresql')
		expect(limited.mode).toBe('sql')
		expect(limited.sql.endsWith('\nLIMIT 3')).toBe(true)
	})

	test('a CTE ending in SELECT is limited', () => {
		const limited = applySqlLimit('WITH recent AS (SELECT * FROM orders) SELECT * FROM recent', 2, 'postgresql')
		expect(limited.mode).toBe('sql')
		expect(limited.sql).toBe('WITH recent AS (SELECT * FROM orders) SELECT * FROM recent\nLIMIT 2')
	})

	test('a UNION is limited as a whole', () => {
		expect(applySqlLimit('SELECT 1 UNION SELECT 2', 1, 'postgresql').mode).toBe('sql')
	})

	test('a statement that already limits itself is left alone', () => {
		const limited = applySqlLimit('SELECT * FROM orders LIMIT 100', 10, 'postgresql')
		expect(limited).toMatchObject({ mode: 'rows', sql: 'SELECT * FROM orders LIMIT 100' })
		expect(limited.reason).toContain('already limits')
	})

	test('FETCH FIRST and a LIMIT inside a subquery also count as self-limiting', () => {
		expect(applySqlLimit('SELECT * FROM orders FETCH FIRST 5 ROWS ONLY', 10, 'postgresql').mode).toBe('rows')
		expect(applySqlLimit('SELECT * FROM (SELECT * FROM orders LIMIT 5) s', 10, 'postgresql').mode).toBe('rows')
	})

	test('multi-statement input is never rewritten', () => {
		const limited = applySqlLimit('SELECT 1; SELECT 2', 1, 'postgresql')
		expect(limited).toMatchObject({ mode: 'rows', sql: 'SELECT 1; SELECT 2' })
		expect(limited.reason).toContain('more than one statement')
	})

	test('a non-SELECT is never rewritten', () => {
		expect(applySqlLimit('UPDATE orders SET note = 1', 1, 'postgresql')).toMatchObject({ mode: 'rows' })
		expect(applySqlLimit('SHOW TABLES', 1, 'mysql')).toMatchObject({ mode: 'rows' })
		expect(applySqlLimit('EXPLAIN SELECT 1', 1, 'postgresql')).toMatchObject({ mode: 'rows' })
		expect(applySqlLimit('  ', 1, 'postgresql')).toMatchObject({ mode: 'rows' })
	})

	test('a semicolon inside a string literal does not look like a second statement', () => {
		expect(applySqlLimit("SELECT * FROM t WHERE note = 'a;b'", 1, 'sqlite').mode).toBe('sql')
	})

	test('clauses that have to stay last block the rewrite', () => {
		expect(applySqlLimit('SELECT * FROM orders FOR UPDATE', 1, 'postgresql').mode).toBe('rows')
		expect(applySqlLimit('SELECT * FROM orders OFFSET 20', 1, 'postgresql').mode).toBe('rows')
		expect(applySqlLimit('SELECT * INTO backup FROM orders', 1, 'postgresql').mode).toBe('rows')
	})

	test('a limit that is not a positive integer is refused', () => {
		expect(applySqlLimit('SELECT 1', 0, 'postgresql').mode).toBe('rows')
		expect(applySqlLimit('SELECT 1', 1.5, 'postgresql').mode).toBe('rows')
	})
})

describe('buildExplainSql', () => {
	test('PostgreSQL', () => {
		expect(buildExplainSql('postgresql', 'SELECT 1', false)).toBe('EXPLAIN SELECT 1')
		expect(buildExplainSql('postgresql', 'SELECT 1', true)).toBe('EXPLAIN (ANALYZE, BUFFERS) SELECT 1')
	})

	test('MySQL', () => {
		expect(buildExplainSql('mysql', 'SELECT 1;', false)).toBe('EXPLAIN SELECT 1')
		expect(buildExplainSql('mysql', 'SELECT 1', true)).toBe('EXPLAIN ANALYZE SELECT 1')
	})

	test('SQLite has a query plan but no ANALYZE', () => {
		expect(buildExplainSql('sqlite', 'SELECT 1', false)).toBe('EXPLAIN QUERY PLAN SELECT 1')
		expect(exitCodeOf(() => buildExplainSql('sqlite', 'SELECT 1', true))).toBe(EXIT.usage)
	})
})
