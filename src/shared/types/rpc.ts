import type { SortColumn, ColumnFilter } from "./grid";

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
