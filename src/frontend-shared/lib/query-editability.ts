/**
 * Pure logic for determining whether query results are editable inline.
 *
 * Takes SQL + schema metadata and produces editability info for each result set.
 */

import { analyzeSelectSource } from '@dotaz/shared/sql/editability.js'
import { splitStatements } from '@dotaz/shared/sql/statements.js'
import type { QueryEditability, QueryResult } from '@dotaz/shared/types/query.js'

export interface SchemaLookup {
	getColumns(connectionId: string, schema: string, table: string, database?: string): {
		name: string
		isPrimaryKey: boolean
	}[]
}

export interface EditabilityAnalysis {
	editability: Record<number, QueryEditability>
	editableRows: Record<number, Record<string, unknown>[]>
}

/**
 * Analyze query results to determine which ones are editable.
 *
 * This is pure business logic: given SQL, results, and schema metadata,
 * it returns editability info and mutable row copies for editable results.
 */
export function analyzeResultEditability(
	sql: string,
	results: QueryResult[],
	connectionId: string,
	defaultSchema: string,
	database: string | undefined,
	schemaLookup: SchemaLookup,
): EditabilityAnalysis {
	const statements = splitStatements(sql)
	const editability: Record<number, QueryEditability> = {}
	const editableRows: Record<number, Record<string, unknown>[]> = {}

	for (let i = 0; i < results.length; i++) {
		const result = results[i]
		if (!result.columns.length || result.error) continue

		const stmt = statements[i] ?? sql
		const analysis = analyzeSelectSource(stmt)

		if (!analysis.editable) {
			editability[i] = { editable: false, reason: analysis.reason }
			continue
		}

		const source = analysis.source
		const schema = source.schema ?? defaultSchema
		const columns = schemaLookup.getColumns(connectionId, schema, source.table, database)

		if (columns.length === 0) {
			editability[i] = { editable: false, reason: 'unknown_table' }
			continue
		}

		const pkColumns = columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
		if (pkColumns.length === 0) {
			editability[i] = { editable: false, reason: 'no_pk' }
			continue
		}

		const resultColumnNames = new Set(result.columns.map((c) => c.name))
		const missingPks = pkColumns.filter((pk) => !resultColumnNames.has(pk))
		if (missingPks.length > 0) {
			editability[i] = { editable: false, reason: 'no_pk' }
			continue
		}

		const tableColumnNames = new Set(columns.map((c) => c.name))
		const editableColumns = result.columns
			.map((c) => c.name)
			.filter((name) => tableColumnNames.has(name))

		editability[i] = {
			editable: true,
			schema,
			table: source.table,
			primaryKeys: pkColumns,
			editableColumns,
		}

		editableRows[i] = result.rows.map((row) => ({ ...row }))
	}

	return { editability, editableRows }
}
