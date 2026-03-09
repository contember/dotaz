import type { ColumnInfo, TableInfo } from '@dotaz/shared/types/database'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import type { SearchMatch } from '@dotaz/shared/types/rpc'
import type { DatabaseDriver } from '../db/driver'

export interface SearchDatabaseOptions {
	searchTerm: string
	scope: 'database' | 'schema' | 'tables'
	schemaName?: string
	tableNames?: string[]
	resultsPerTable: number
}

export interface SearchDatabaseResult {
	matches: SearchMatch[]
	searchedTables: number
	totalMatches: number
	cancelled: boolean
	elapsedMs: number
}

/** Returns true if the column data type is searchable with CAST(... AS TEXT) LIKE. */
function isSearchableColumn(col: ColumnInfo): boolean {
	return col.dataType !== DatabaseDataType.Binary
}

/**
 * Search for a text term across all tables in scope.
 * Iterates tables sequentially to avoid overloading the database.
 */
export async function searchDatabase(
	driver: DatabaseDriver,
	opts: SearchDatabaseOptions,
	onProgress: (tableName: string, searched: number, total: number) => void,
	isCancelled: () => boolean,
): Promise<SearchDatabaseResult> {
	const start = performance.now()
	const schema = await driver.loadSchema()

	// Determine which tables to search based on scope
	const tablesToSearch: TableInfo[] = []
	for (const [schemaName, tables] of Object.entries(schema.tables)) {
		if (opts.scope === 'schema' && opts.schemaName && schemaName !== opts.schemaName) continue

		for (const table of tables) {
			if (table.type !== 'table') continue // skip views and materialized views for performance
			if (opts.scope === 'tables' && opts.tableNames) {
				if (!opts.tableNames.includes(table.name)) continue
			}
			tablesToSearch.push(table)
		}
	}

	const matches: SearchMatch[] = []
	let totalMatches = 0
	let searchedTables = 0

	const isPostgres = driver.getDriverType() === 'postgresql'
	const likeOp = isPostgres ? 'ILIKE' : 'LIKE'

	for (const table of tablesToSearch) {
		if (isCancelled()) {
			return { matches, searchedTables, totalMatches, cancelled: true, elapsedMs: Math.round(performance.now() - start) }
		}

		onProgress(table.name, searchedTables, tablesToSearch.length)

		const key = `${table.schema}.${table.name}`
		const columns = schema.columns[key] ?? []
		const searchable = columns.filter(isSearchableColumn)

		if (searchable.length === 0) {
			searchedTables++
			continue
		}

		// Build WHERE clause: OR across all searchable columns
		const conditions: string[] = []
		const params: unknown[] = []
		let paramIndex = 0

		for (const col of searchable) {
			paramIndex++
			const quoted = driver.quoteIdentifier(col.name)
			conditions.push(`CAST(${quoted} AS TEXT) ${likeOp} ${driver.placeholder(paramIndex)}`)
			params.push(`%${opts.searchTerm}%`)
		}

		const qualifiedTable = driver.qualifyTable(table.schema, table.name)
		paramIndex++
		const limitPlaceholder = driver.placeholder(paramIndex)
		const sql = `SELECT * FROM ${qualifiedTable} WHERE ${conditions.join(' OR ')} LIMIT ${limitPlaceholder}`
		params.push(opts.resultsPerTable)

		try {
			const result = await driver.execute(sql, params)
			for (const row of result.rows) {
				// Find which column(s) matched
				const rowRecord = row as Record<string, unknown>
				for (const col of searchable) {
					const value = rowRecord[col.name]
					if (value == null) continue
					const textVal = String(value)
					const matches_ = isPostgres
						? textVal.toLowerCase().includes(opts.searchTerm.toLowerCase())
						: textVal.toLowerCase().includes(opts.searchTerm.toLowerCase())
					if (matches_) {
						matches.push({
							schema: table.schema,
							table: table.name,
							column: col.name,
							row: rowRecord,
						})
						totalMatches++
						break // one match per row is enough
					}
				}
			}
		} catch (err) {
			// Skip tables that fail (e.g., permission issues) and continue
			console.debug(`Search: skipped ${table.schema}.${table.name}:`, err instanceof Error ? err.message : err)
		}

		searchedTables++
	}

	return {
		matches,
		searchedTables,
		totalMatches,
		cancelled: false,
		elapsedMs: Math.round(performance.now() - start),
	}
}
