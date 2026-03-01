// Data comparison types

/** A data source for comparison — either a table or a custom SQL query. */
export interface ComparisonSource {
	connectionId: string;
	database?: string;
	/** Source type: "table" fetches all rows from a table, "query" runs arbitrary SQL. */
	type: "table" | "query";
	/** Schema name (required when type = "table") */
	schema?: string;
	/** Table name (required when type = "table") */
	table?: string;
	/** SQL query (required when type = "query") */
	sql?: string;
}

/** Column mapping between left and right sources. */
export interface ComparisonColumnMapping {
	leftColumn: string;
	rightColumn: string;
}

/** Request to compare two data sources. */
export interface ComparisonRequest {
	left: ComparisonSource;
	right: ComparisonSource;
	/** Columns used to match/identify rows across sources. */
	keyColumns: ComparisonColumnMapping[];
	/** Column pairs to compare values for (auto-mapped by name if not specified). */
	columnMappings?: ComparisonColumnMapping[];
}

/** Diff status for a single row in the comparison result. */
export type DiffRowStatus = "matched" | "added" | "removed" | "changed";

/** A row in the comparison result with diff metadata. */
export interface DiffRow {
	status: DiffRowStatus;
	/** Values from the left source (null for "added" rows). */
	leftValues: Record<string, unknown> | null;
	/** Values from the right source (null for "removed" rows). */
	rightValues: Record<string, unknown> | null;
	/** Column names that differ (only for "changed" rows). */
	changedColumns: string[];
}

/** Summary statistics of the comparison. */
export interface ComparisonStats {
	matched: number;
	added: number;
	removed: number;
	changed: number;
	total: number;
}

/** Full result of a data comparison. */
export interface ComparisonResult {
	/** Column names from the left source. */
	leftColumns: string[];
	/** Column names from the right source. */
	rightColumns: string[];
	/** Resolved column mappings used for comparison. */
	columnMappings: ComparisonColumnMapping[];
	/** All diff rows. */
	rows: DiffRow[];
	/** Diff statistics. */
	stats: ComparisonStats;
}
