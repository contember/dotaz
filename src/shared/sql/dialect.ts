import type { ConnectionType } from '../types/connection'

/**
 * Minimal interface for SQL generation helpers.
 * Implemented by DatabaseDriver (backend) and concrete dialect classes (frontend).
 */
export interface SqlDialect {
	quoteIdentifier(name: string): string
	qualifyTable(schema: string, table: string): string
	emptyInsertSql(qualifiedTable: string): string
	getDriverType(): ConnectionType
	/** Return the SQL placeholder for a 1-based parameter index (e.g. "$1" or "?"). */
	placeholder(index: number): string
}
