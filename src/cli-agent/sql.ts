// SQL the CLI builds itself. Identifiers always go through the shared dialect quoting —
// the only text ever interpolated raw is the documented `--where` fragment.

import { buildOrderByClause } from '@dotaz/shared/sql/builders'
import type { SqlDialect } from '@dotaz/shared/sql/dialect'
import { MysqlDialect, PostgresDialect, SqliteDialect } from '@dotaz/shared/sql/dialects'
import type { ConnectionType } from '@dotaz/shared/types/connection'
import type { SortColumn } from '@dotaz/shared/types/grid'
import { usageError } from './errors'

export function dialectFor(type: ConnectionType): SqlDialect {
	switch (type) {
		case 'postgresql':
			return new PostgresDialect()
		case 'mysql':
			return new MysqlDialect()
		case 'sqlite':
			return new SqliteDialect()
	}
}

/** `--order "created_at:desc,id"` → SortColumn[] */
export function parseOrderBy(raw: string | undefined): SortColumn[] | undefined {
	if (!raw) return undefined
	const sort: SortColumn[] = []
	for (const part of raw.split(',')) {
		const spec = part.trim()
		if (!spec) continue
		const [column, direction] = spec.split(':')
		const col = column.trim()
		if (!col) throw usageError(`Invalid --order entry "${spec}"`)
		const dir = (direction ?? 'asc').trim().toLowerCase()
		if (dir !== 'asc' && dir !== 'desc') throw usageError(`Invalid sort direction "${direction}" in --order (expected asc or desc)`)
		sort.push({ column: col, direction: dir })
	}
	return sort.length > 0 ? sort : undefined
}

/** `--columns "id,name"` → column names */
export function parseColumnList(raw: string | undefined): string[] | undefined {
	if (!raw) return undefined
	const columns = raw.split(',').map((c) => c.trim()).filter((c) => c.length > 0)
	if (columns.length === 0) throw usageError('--columns needs at least one column name')
	return columns
}

export interface RowsQueryOptions {
	schema: string
	table: string
	dialect: SqlDialect
	columns?: string[]
	/** Raw SQL fragment supplied with `--where`; interpolated as-is, wrapped in parentheses. */
	where?: string
	sort?: SortColumn[]
	limit: number
	offset: number
}

export function buildRowsQuery(opts: RowsQueryOptions): { sql: string; params: unknown[] } {
	const { dialect } = opts
	const selectList = opts.columns && opts.columns.length > 0
		? opts.columns.map((c) => dialect.quoteIdentifier(c)).join(', ')
		: '*'

	const parts = [`SELECT ${selectList} FROM ${dialect.qualifyTable(opts.schema, opts.table)}`]
	if (opts.where) parts.push(`WHERE (${opts.where})`)
	const orderBy = buildOrderByClause(opts.sort, dialect)
	if (orderBy) parts.push(orderBy)
	parts.push(`LIMIT ${dialect.placeholder(1)} OFFSET ${dialect.placeholder(2)}`)

	return { sql: parts.join(' '), params: [opts.limit, opts.offset] }
}

/**
 * EXPLAIN runs through `query.execute` on the read-only session — the app's own explain path is
 * fire-and-forget over a message channel the one-shot CLI transport cannot receive.
 */
export function buildExplainSql(type: ConnectionType, sql: string, analyze: boolean): string {
	const statement = sql.trim().replace(/;\s*$/, '')
	switch (type) {
		case 'sqlite':
			if (analyze) throw usageError('SQLite has no EXPLAIN ANALYZE', 'Drop --analyze to get the query plan.')
			return `EXPLAIN QUERY PLAN ${statement}`
		case 'mysql':
			return analyze ? `EXPLAIN ANALYZE ${statement}` : `EXPLAIN ${statement}`
		case 'postgresql':
			return analyze ? `EXPLAIN (ANALYZE, BUFFERS) ${statement}` : `EXPLAIN ${statement}`
	}
}
