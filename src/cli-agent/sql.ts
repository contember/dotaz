// SQL the CLI builds itself. Identifiers always go through the shared dialect quoting —
// the only text ever interpolated raw is the documented `--where` fragment.

import { buildOrderByClause } from '@dotaz/shared/sql/builders'
import type { SqlDialect } from '@dotaz/shared/sql/dialect'
import { MysqlDialect, PostgresDialect, SqliteDialect } from '@dotaz/shared/sql/dialects'
import { classifyStatement, isReadOnlySql, isUnlimitedSelect, splitStatements, stripLiteralsAndComments } from '@dotaz/shared/sql/statements'
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

/** Where `--limit` took effect: in the statement the database ran, or only in what we printed. */
export type SqlLimitMode = 'sql' | 'rows'

export interface SqlLimit {
	/** The statement to execute — unchanged unless `mode` is `'sql'`. */
	sql: string
	mode: SqlLimitMode
	/** Why the limit stayed out of the SQL (`mode: 'rows'` only). */
	reason?: string
}

/** Only a plain SELECT (or a CTE ending in one) can take a trailing LIMIT without changing meaning. */
const LIMITABLE_START = /^(SELECT|WITH)\b/
/** A locking clause must stay last, so LIMIT cannot simply be appended after it. */
const LOCKING_CLAUSE = /\bFOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/
/** `SELECT … INTO …` (PostgreSQL table, MySQL OUTFILE/variable) is not a plain result set. */
const INTO_CLAUSE = /\bINTO\b/

function normalizeForLimit(sql: string): string {
	return stripLiteralsAndComments(sql).replace(/\s+/g, ' ').trim().toUpperCase()
}

/**
 * Every engine Dotaz speaks spells row limiting the same way — the switch keeps that a decision.
 * The count is inlined rather than bound: it is a checked positive integer, and a placeholder
 * would have to guess the numbering of whatever `--param` bindings the caller already wrote.
 */
function limitClause(type: ConnectionType, limit: number): string {
	switch (type) {
		case 'postgresql':
		case 'mysql':
		case 'sqlite':
			return `LIMIT ${limit}`
	}
}

/**
 * Push `--limit` into the statement itself, so the database stops producing rows nobody reads.
 * Deliberately conservative: anything we cannot rewrite with certainty is returned untouched
 * with a reason, and the caller trims the printed rows instead.
 */
export function applySqlLimit(sql: string, limit: number, type: ConnectionType): SqlLimit {
	const keep = (reason: string): SqlLimit => ({ sql, mode: 'rows', reason })
	if (!Number.isSafeInteger(limit) || limit <= 0) return keep('the limit is not a positive integer')

	// Fails closed on anything the classifier cannot prove is a read
	if (!isReadOnlySql(sql)) return keep('the statement is not provably read-only')

	const statements = splitStatements(sql)
	if (statements.length === 0) return keep('there is no statement to limit')
	if (statements.length > 1) return keep('the input holds more than one statement')

	const [statement] = statements
	if (classifyStatement(statement) !== 'read') return keep('the statement is not a read-only SELECT')

	const normalized = normalizeForLimit(statement)
	if (!LIMITABLE_START.test(normalized)) return keep('only SELECT and WITH … SELECT can take a trailing LIMIT')
	if (!isUnlimitedSelect(statement)) return keep('the statement already limits its own rows')
	if (/\bOFFSET\b/.test(normalized)) return keep('OFFSET without LIMIT is dialect-specific')
	if (LOCKING_CLAUSE.test(normalized)) return keep('a locking clause has to stay last')
	if (INTO_CLAUSE.test(normalized)) return keep('SELECT … INTO does not return a result set')

	// Newline, not a space: the statement may well end in a line comment
	return { sql: `${statement}\n${limitClause(type, limit)}`, mode: 'sql' }
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
