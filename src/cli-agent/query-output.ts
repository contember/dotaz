// Shared rendering for anything that comes back as one or more QueryResult sets.

import type { QueryResult } from '@dotaz/shared/types/query'
import type { RenderColumn, Section } from './format'

function columnsOf(result: QueryResult): RenderColumn[] {
	return result.columns.map((c) => ({ name: c.name, dataType: c.dataType }))
}

export function queryResultSections(results: QueryResult[]): Section[] {
	return results.map((result, index) => {
		const title = results.length > 1 ? `-- statement ${index + 1} (${result.durationMs}ms)` : undefined
		if (result.columns.length === 0) {
			return {
				title,
				kind: 'kv',
				columns: [{ name: 'affectedRows' }, { name: 'durationMs' }],
				rows: [{ affectedRows: result.affectedRows ?? 0, durationMs: result.durationMs }],
			}
		}
		return { title, columns: columnsOf(result), rows: result.rows, empty: '(no rows)' }
	})
}

export function queryResultJson(results: QueryResult[]): Record<string, unknown> {
	if (results.length === 1) {
		const [result] = results
		return {
			columns: result.columns,
			rows: result.rows,
			rowCount: result.rowCount,
			affectedRows: result.affectedRows,
			durationMs: result.durationMs,
		}
	}
	return {
		results: results.map((result) => ({
			columns: result.columns,
			rows: result.rows,
			rowCount: result.rowCount,
			affectedRows: result.affectedRows,
			durationMs: result.durationMs,
		})),
	}
}

/** A driver can report a failure inside the result set instead of throwing. */
export function firstResultError(results: QueryResult[]): string | undefined {
	return results.find((result) => result.error)?.error
}

export function queryNotes(results: QueryResult[]): string[] {
	return results
		.map((result, index) => {
			const prefix = results.length > 1 ? `statement ${index + 1}: ` : ''
			return `${prefix}${result.rowCount} row(s) in ${result.durationMs}ms`
		})
}
