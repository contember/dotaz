import { DatabaseDataType, isSqlDefault } from '../types/database'
import type { ColumnFilter, SortColumn } from '../types/grid'
import type { DataChange, DeleteChange, InsertChange, UpdateChange } from '../types/rpc'
import type { SqlDialect } from './dialect'

export interface WhereClauseResult {
	sql: string
	params: unknown[]
}

export interface GeneratedStatement {
	sql: string
	params: unknown[]
}

/** Returns true if the column data type is searchable with CAST(... AS TEXT) LIKE. */
function isSearchableType(dataType: DatabaseDataType): boolean {
	// Exclude binary types that can't meaningfully be cast to text
	return dataType !== DatabaseDataType.Binary
}

/**
 * Build a quick search clause that ORs LIKE conditions across multiple columns.
 * Returns a parenthesized SQL fragment (without WHERE) and param values.
 * Uses ILIKE for PostgreSQL (true case-insensitive), LIKE for SQLite.
 */
export function buildQuickSearchClause(
	columns: { name: string; dataType: DatabaseDataType }[],
	searchTerm: string,
	dialect: SqlDialect,
	paramOffset = 0,
): WhereClauseResult {
	if (!searchTerm || columns.length === 0) {
		return { sql: '', params: [] }
	}

	const searchable = columns.filter((c) => isSearchableType(c.dataType))
	if (searchable.length === 0) {
		return { sql: '', params: [] }
	}

	const isPostgres = dialect.getDriverType() === 'postgresql'
	const likeOp = isPostgres ? 'ILIKE' : 'LIKE'
	const pattern = `%${searchTerm}%`

	const conditions: string[] = []
	const params: unknown[] = []
	let paramIndex = paramOffset

	for (const col of searchable) {
		paramIndex++
		const quoted = dialect.quoteIdentifier(col.name)
		conditions.push(`CAST(${quoted} AS TEXT) ${likeOp} ${dialect.placeholder(paramIndex)}`)
		params.push(pattern)
	}

	return {
		sql: `(${conditions.join(' OR ')})`,
		params,
	}
}

/**
 * Build a WHERE clause from an array of column filters.
 * Returns the SQL fragment (including "WHERE") and the parameter values.
 * If no filters, returns empty string and empty params.
 */
export function buildWhereClause(
	filters: ColumnFilter[] | undefined,
	dialect: SqlDialect,
	paramOffset = 0,
): WhereClauseResult {
	if (!filters || filters.length === 0) {
		return { sql: '', params: [] }
	}

	const conditions: string[] = []
	const params: unknown[] = []
	let paramIndex = paramOffset

	for (const filter of filters) {
		const col = dialect.quoteIdentifier(filter.column)

		switch (filter.operator) {
			case 'eq':
				paramIndex++
				conditions.push(`${col} = ${dialect.placeholder(paramIndex)}`)
				params.push(filter.value)
				break
			case 'neq':
				paramIndex++
				conditions.push(`${col} != ${dialect.placeholder(paramIndex)}`)
				params.push(filter.value)
				break
			case 'gt':
				paramIndex++
				conditions.push(`${col} > ${dialect.placeholder(paramIndex)}`)
				params.push(filter.value)
				break
			case 'gte':
				paramIndex++
				conditions.push(`${col} >= ${dialect.placeholder(paramIndex)}`)
				params.push(filter.value)
				break
			case 'lt':
				paramIndex++
				conditions.push(`${col} < ${dialect.placeholder(paramIndex)}`)
				params.push(filter.value)
				break
			case 'lte':
				paramIndex++
				conditions.push(`${col} <= ${dialect.placeholder(paramIndex)}`)
				params.push(filter.value)
				break
			case 'like':
				paramIndex++
				conditions.push(`${col} LIKE ${dialect.placeholder(paramIndex)}`)
				params.push(filter.value)
				break
			case 'notLike':
				paramIndex++
				conditions.push(`${col} NOT LIKE ${dialect.placeholder(paramIndex)}`)
				params.push(filter.value)
				break
			case 'in': {
				const values = Array.isArray(filter.value) ? filter.value : [filter.value]
				const placeholders = values.map(() => {
					paramIndex++
					return dialect.placeholder(paramIndex)
				})
				conditions.push(`${col} IN (${placeholders.join(', ')})`)
				params.push(...values)
				break
			}
			case 'notIn': {
				const values = Array.isArray(filter.value) ? filter.value : [filter.value]
				const placeholders = values.map(() => {
					paramIndex++
					return dialect.placeholder(paramIndex)
				})
				conditions.push(`${col} NOT IN (${placeholders.join(', ')})`)
				params.push(...values)
				break
			}
			case 'isNull':
				conditions.push(`${col} IS NULL`)
				break
			case 'isNotNull':
				conditions.push(`${col} IS NOT NULL`)
				break
		}
	}

	if (conditions.length === 0) {
		return { sql: '', params: [] }
	}

	return {
		sql: `WHERE ${conditions.join(' AND ')}`,
		params,
	}
}

/**
 * Build an ORDER BY clause from sort column specifications.
 * Returns the SQL fragment (including "ORDER BY") or empty string if no sorts.
 */
export function buildOrderByClause(
	sort: SortColumn[] | undefined,
	dialect: SqlDialect,
): string {
	if (!sort || sort.length === 0) {
		return ''
	}

	const clauses = sort.map((s) => {
		const col = dialect.quoteIdentifier(s.column)
		const dir = s.direction === 'desc' ? 'DESC' : 'ASC'
		return `${col} ${dir}`
	})

	return `ORDER BY ${clauses.join(', ')}`
}

/**
 * Combine column filter WHERE clause and quick search clause into a single WHERE fragment.
 */
function combineWhereClauses(
	filterWhere: WhereClauseResult,
	quickSearch: WhereClauseResult | undefined,
): WhereClauseResult {
	const hasFilter = filterWhere.sql.length > 0
	const hasSearch = quickSearch != null && quickSearch.sql.length > 0

	if (!hasFilter && !hasSearch) return { sql: '', params: [] }
	if (hasFilter && !hasSearch) return filterWhere

	if (!hasFilter && hasSearch) {
		return {
			sql: `WHERE ${quickSearch!.sql}`,
			params: quickSearch!.params,
		}
	}

	// Both present: strip "WHERE " from filterWhere and AND them together
	const filterConditions = filterWhere.sql.replace(/^WHERE /, '')
	return {
		sql: `WHERE ${filterConditions} AND ${quickSearch!.sql}`,
		params: [...filterWhere.params, ...quickSearch!.params],
	}
}

/**
 * Append a raw custom WHERE filter expression to an existing WHERE clause result.
 * The custom filter has no parameterized values — it's user-typed raw SQL.
 */
function appendCustomFilter(
	where: WhereClauseResult,
	customFilter: string | undefined,
): WhereClauseResult {
	if (!customFilter) return where

	if (where.sql) {
		const conditions = where.sql.replace(/^WHERE /, '')
		return { sql: `WHERE ${conditions} AND (${customFilter})`, params: where.params }
	}

	return { sql: `WHERE (${customFilter})`, params: where.params }
}

/**
 * Build a complete SELECT query with pagination, sorting, and filtering.
 * Returns the SQL string and parameter values.
 */
export function buildSelectQuery(
	schema: string,
	table: string,
	page: number,
	pageSize: number,
	sort: SortColumn[] | undefined,
	filters: ColumnFilter[] | undefined,
	dialect: SqlDialect,
	quickSearch?: WhereClauseResult,
	customFilter?: string,
): { sql: string; params: unknown[] } {
	const from = dialect.qualifyTable(schema, table)
	const filterWhere = buildWhereClause(filters, dialect)
	const where = appendCustomFilter(combineWhereClauses(filterWhere, quickSearch), customFilter)
	const orderBy = buildOrderByClause(sort, dialect)

	const offset = (page - 1) * pageSize
	let paramIndex = where.params.length

	paramIndex++
	const limitParam = dialect.placeholder(paramIndex)
	paramIndex++
	const offsetParam = dialect.placeholder(paramIndex)

	const parts = [`SELECT * FROM ${from}`]
	if (where.sql) parts.push(where.sql)
	if (orderBy) parts.push(orderBy)
	parts.push(`LIMIT ${limitParam} OFFSET ${offsetParam}`)

	return {
		sql: parts.join(' '),
		params: [...where.params, pageSize, offset],
	}
}

/**
 * Build a human-readable SELECT query with values inlined (no parameter placeholders).
 * Intended for display, copy-to-clipboard, or pre-filling a SQL console — NOT for execution.
 */
export function buildReadableSelectQuery(
	schema: string,
	table: string,
	page: number,
	pageSize: number,
	sort: SortColumn[] | undefined,
	filters: ColumnFilter[] | undefined,
	dialect: SqlDialect,
	customFilter?: string,
): string {
	const from = dialect.qualifyTable(schema, table)
	const orderBy = buildOrderByClause(sort, dialect)
	const offset = (page - 1) * pageSize

	const parts = [`SELECT * FROM ${from}`]

	const whereConditions: string[] = []

	if (filters && filters.length > 0) {
		for (const filter of filters) {
			const col = dialect.quoteIdentifier(filter.column)
			switch (filter.operator) {
				case 'eq': whereConditions.push(`${col} = ${sqlLiteral(filter.value)}`); break
				case 'neq': whereConditions.push(`${col} != ${sqlLiteral(filter.value)}`); break
				case 'gt': whereConditions.push(`${col} > ${sqlLiteral(filter.value)}`); break
				case 'gte': whereConditions.push(`${col} >= ${sqlLiteral(filter.value)}`); break
				case 'lt': whereConditions.push(`${col} < ${sqlLiteral(filter.value)}`); break
				case 'lte': whereConditions.push(`${col} <= ${sqlLiteral(filter.value)}`); break
				case 'like': whereConditions.push(`${col} LIKE ${sqlLiteral(filter.value)}`); break
				case 'notLike': whereConditions.push(`${col} NOT LIKE ${sqlLiteral(filter.value)}`); break
				case 'in': {
					const vals = (Array.isArray(filter.value) ? filter.value : [filter.value]).map(sqlLiteral)
					whereConditions.push(`${col} IN (${vals.join(', ')})`)
					break
				}
				case 'notIn': {
					const vals = (Array.isArray(filter.value) ? filter.value : [filter.value]).map(sqlLiteral)
					whereConditions.push(`${col} NOT IN (${vals.join(', ')})`)
					break
				}
				case 'isNull': whereConditions.push(`${col} IS NULL`); break
				case 'isNotNull': whereConditions.push(`${col} IS NOT NULL`); break
			}
		}
	}

	if (customFilter) {
		whereConditions.push(`(${customFilter})`)
	}

	if (whereConditions.length > 0) {
		parts.push(`WHERE ${whereConditions.join(' AND ')}`)
	}
	if (orderBy) parts.push(orderBy)
	parts.push(`LIMIT ${pageSize} OFFSET ${offset}`)

	return parts.join('\n')
}

function sqlLiteral(value: unknown): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
	return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Build a COUNT(*) query with optional filtering.
 * Returns the SQL string and parameter values.
 */
export function buildCountQuery(
	schema: string,
	table: string,
	filters: ColumnFilter[] | undefined,
	dialect: SqlDialect,
	quickSearch?: WhereClauseResult,
	customFilter?: string,
): { sql: string; params: unknown[] } {
	const from = dialect.qualifyTable(schema, table)
	const filterWhere = buildWhereClause(filters, dialect)
	const where = appendCustomFilter(combineWhereClauses(filterWhere, quickSearch), customFilter)

	const parts = [`SELECT COUNT(*) AS count FROM ${from}`]
	if (where.sql) parts.push(where.sql)

	return {
		sql: parts.join(' '),
		params: where.params,
	}
}

// ── Data Editing SQL Generation ─────────────────────────────

/**
 * Generate an INSERT statement from an InsertChange.
 */
export function generateInsert(change: InsertChange, dialect: SqlDialect): GeneratedStatement {
	const values = change.values
	const table = dialect.qualifyTable(change.schema, change.table)

	if (!values || Object.keys(values).length === 0) {
		return {
			sql: dialect.emptyInsertSql(table),
			params: [],
		}
	}

	const columns = Object.keys(values)
	const quotedCols = columns.map((c) => dialect.quoteIdentifier(c))
	const params: unknown[] = []
	let paramIndex = 0

	const valueParts = columns.map((c) => {
		if (isSqlDefault(values[c])) {
			return 'DEFAULT'
		}
		paramIndex++
		params.push(values[c])
		return dialect.placeholder(paramIndex)
	})

	return {
		sql: `INSERT INTO ${table} (${quotedCols.join(', ')}) VALUES (${valueParts.join(', ')})`,
		params,
	}
}

/**
 * Generate an UPDATE statement from an UpdateChange.
 * Only updates the columns specified in `values`.
 */
export function generateUpdate(change: UpdateChange, dialect: SqlDialect): GeneratedStatement {
	const { primaryKeys, values } = change

	if (Object.keys(primaryKeys).length === 0) {
		throw new Error('UPDATE change requires primaryKeys')
	}
	if (Object.keys(values).length === 0) {
		throw new Error('UPDATE change requires values')
	}

	const table = dialect.qualifyTable(change.schema, change.table)
	const setCols = Object.keys(values)
	const pkCols = Object.keys(primaryKeys)
	const params: unknown[] = []
	let paramIndex = 0

	const setClauses = setCols.map((col) => {
		if (isSqlDefault(values[col])) {
			return `${dialect.quoteIdentifier(col)} = DEFAULT`
		}
		paramIndex++
		params.push(values[col])
		return `${dialect.quoteIdentifier(col)} = ${dialect.placeholder(paramIndex)}`
	})

	const whereClauses = pkCols.map((col) => {
		paramIndex++
		params.push(primaryKeys[col])
		return `${dialect.quoteIdentifier(col)} = ${dialect.placeholder(paramIndex)}`
	})

	return {
		sql: `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`,
		params,
	}
}

/**
 * Generate a DELETE statement from a DeleteChange.
 */
export function generateDelete(change: DeleteChange, dialect: SqlDialect): GeneratedStatement {
	const { primaryKeys } = change

	if (Object.keys(primaryKeys).length === 0) {
		throw new Error('DELETE change requires primaryKeys')
	}

	const table = dialect.qualifyTable(change.schema, change.table)
	const pkCols = Object.keys(primaryKeys)
	const params: unknown[] = []

	const whereClauses = pkCols.map((col, i) => {
		params.push(primaryKeys[col])
		return `${dialect.quoteIdentifier(col)} = ${dialect.placeholder(i + 1)}`
	})

	return {
		sql: `DELETE FROM ${table} WHERE ${whereClauses.join(' AND ')}`,
		params,
	}
}

/**
 * Generate a parameterized SQL statement for a single DataChange.
 */
export function generateChangeSql(change: DataChange, dialect: SqlDialect): GeneratedStatement {
	switch (change.type) {
		case 'insert':
			return generateInsert(change, dialect)
		case 'update':
			return generateUpdate(change, dialect)
		case 'delete':
			return generateDelete(change, dialect)
		default:
			throw new Error(`Unknown change type: ${(change as any).type}`)
	}
}

/**
 * Format a value for readable SQL preview (not for execution).
 */
export function formatValueForPreview(value: unknown): string {
	if (isSqlDefault(value)) return 'DEFAULT'
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
	if (typeof value === 'string') {
		return `'${value.replace(/'/g, "''")}'`
	}
	if (typeof value === 'object') {
		return `'${JSON.stringify(value).replace(/'/g, "''")}'`
	}
	return String(value)
}

/**
 * Generate a human-readable SQL string for a single DataChange (for preview).
 * Values are inlined rather than parameterized.
 */
export function generateChangePreview(change: DataChange, dialect: SqlDialect): string {
	const table = dialect.qualifyTable(change.schema, change.table)

	switch (change.type) {
		case 'insert': {
			const values = change.values
			if (!values || Object.keys(values).length === 0) {
				return `${dialect.emptyInsertSql(table)};`
			}
			const columns = Object.keys(values)
			const quotedCols = columns.map((c) => dialect.quoteIdentifier(c))
			const formattedVals = columns.map((c) => formatValueForPreview(values[c]))
			return `INSERT INTO ${table} (${quotedCols.join(', ')}) VALUES (${formattedVals.join(', ')});`
		}
		case 'update': {
			const { primaryKeys, values } = change
			const setCols = Object.keys(values)
			const pkCols = Object.keys(primaryKeys)
			const setClauses = setCols.map(
				(col) => `${dialect.quoteIdentifier(col)} = ${formatValueForPreview(values[col])}`,
			)
			const whereClauses = pkCols.map(
				(col) => `${dialect.quoteIdentifier(col)} = ${formatValueForPreview(primaryKeys[col])}`,
			)
			return `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')};`
		}
		case 'delete': {
			const { primaryKeys } = change
			const pkCols = Object.keys(primaryKeys)
			const whereClauses = pkCols.map(
				(col) => `${dialect.quoteIdentifier(col)} = ${formatValueForPreview(primaryKeys[col])}`,
			)
			return `DELETE FROM ${table} WHERE ${whereClauses.join(' AND ')};`
		}
	}
}

/**
 * Generate a readable SQL preview for multiple changes.
 */
export function generateChangesPreview(changes: DataChange[], dialect: SqlDialect): string {
	return changes.map((c) => generateChangePreview(c, dialect)).join('\n')
}
