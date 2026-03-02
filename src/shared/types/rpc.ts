import type { SortColumn, ColumnFilter } from "./grid";

// ---- Session types ----

export interface SessionInfo {
	sessionId: string;
	connectionId: string;
	database?: string;
	label: string;
	inTransaction: boolean;
	createdAt: number;
}

// ---- Domain types used by handlers and adapters ----

interface DataChangeBase {
	schema: string;
	table: string;
}

export interface InsertChange extends DataChangeBase {
	type: "insert";
	/** Column values for the new row. Empty/undefined means DEFAULT VALUES. */
	values?: Record<string, unknown>;
}

export interface UpdateChange extends DataChangeBase {
	type: "update";
	/** Primary key values identifying the row to update. */
	primaryKeys: Record<string, unknown>;
	/** Column values to set. */
	values: Record<string, unknown>;
}

export interface DeleteChange extends DataChangeBase {
	type: "delete";
	/** Primary key values identifying the row to delete. */
	primaryKeys: Record<string, unknown>;
}

export type DataChange = InsertChange | UpdateChange | DeleteChange;

export interface HistoryListParams {
	connectionId?: string;
	limit?: number;
	offset?: number;
	search?: string;
	/** ISO date string (YYYY-MM-DD) — inclusive lower bound on executed_at */
	startDate?: string;
	/** ISO date string (YYYY-MM-DD) — inclusive upper bound on executed_at */
	endDate?: string;
}

export interface SavedViewConfig {
	columns?: string[];
	sort?: SortColumn[];
	filters?: ColumnFilter[];
	columnWidths?: Record<string, number>;
}

export interface SavedView {
	id: string;
	connectionId: string;
	schemaName: string;
	tableName: string;
	name: string;
	config: SavedViewConfig;
	createdAt: string;
	updatedAt: string;
}

export interface QueryBookmark {
	id: string;
	connectionId: string;
	name: string;
	description: string;
	sql: string;
	createdAt: string;
	updatedAt: string;
}

// ---- Database search types ----

export type SearchScope = "database" | "schema" | "tables";

export interface SearchDatabaseParams {
	connectionId: string;
	database?: string;
	sessionId?: string;
	searchTerm: string;
	scope: SearchScope;
	schemaName?: string;
	tableNames?: string[];
	resultsPerTable?: number;
}

export interface SearchMatch {
	schema: string;
	table: string;
	column: string;
	row: Record<string, unknown>;
}

export interface SearchDatabaseResult {
	matches: SearchMatch[];
	searchedTables: number;
	totalMatches: number;
	cancelled: boolean;
	elapsedMs: number;
}

// ---- Transaction log types ----

export type TransactionLogStatus = "success" | "error";

export interface TransactionLogEntry {
	id: string;
	sql: string;
	status: TransactionLogStatus;
	durationMs: number;
	rowCount: number;
	errorMessage?: string;
	executedAt: string;
}

export interface TransactionLogParams {
	connectionId: string;
	database?: string;
	sessionId?: string;
	statusFilter?: TransactionLogStatus;
	search?: string;
}

export interface TransactionLogResult {
	entries: TransactionLogEntry[];
	pendingStatementCount: number;
	inTransaction: boolean;
}

// ---- AI SQL generation types ----

export interface AiGenerateSqlParams {
	connectionId: string;
	database?: string;
	prompt: string;
}

export interface AiGenerateSqlResult {
	sql: string;
}

export interface OpenDialogParams {
	title?: string;
	filters?: { name: string; extensions: string[] }[];
	multiple?: boolean;
}

export interface SaveDialogParams {
	title?: string;
	defaultName?: string;
	filters?: { name: string; extensions: string[] }[];
}
