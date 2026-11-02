import type { QueryResult } from './types/query'

/**
 * Rows one statement accounts for: what it returned when it returned rows, what it changed
 * otherwise. `affectedRows` alone is not enough — drivers report 0 for a SELECT. Drivers derive
 * `columns` from the first row, so a zero-row read takes the `affectedRows` branch, which is 0.
 */
export function statementRowCount(result: QueryResult): number {
	return result.columns.length > 0 ? result.rowCount : (result.affectedRows ?? result.rowCount)
}
