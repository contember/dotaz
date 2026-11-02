import type { QueryResult } from './types/query'

/**
 * Rows one statement accounts for: what it returned when it produced a result set, what it
 * changed otherwise. `affectedRows` alone is not enough — drivers report 0 for a SELECT.
 */
export function statementRowCount(result: QueryResult): number {
	return result.columns.length > 0 ? result.rowCount : (result.affectedRows ?? result.rowCount)
}
