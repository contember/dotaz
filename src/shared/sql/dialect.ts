import type { ConnectionType } from "../types/connection";

/**
 * Minimal interface for SQL generation helpers.
 * Implemented by DatabaseDriver (backend) and concrete dialect classes (frontend).
 */
export interface SqlDialect {
	quoteIdentifier(name: string): string;
	qualifyTable(schema: string, table: string): string;
	emptyInsertSql(qualifiedTable: string): string;
	getDriverType(): ConnectionType;
}
