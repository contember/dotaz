import { describe, expect, test } from 'bun:test'
import { CliError, EXIT } from '../src/cli-agent/errors'
import { buildExplainSql, buildRowsQuery, dialectFor, parseColumnList, parseOrderBy } from '../src/cli-agent/sql'

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
