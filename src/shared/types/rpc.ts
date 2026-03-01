// ---- Domain types used by handlers and adapters ----

export interface DataChange {
	type: "insert" | "update" | "delete";
	schema: string;
	table: string;
	/** Primary key values identifying the row (for update/delete) */
	primaryKeys?: Record<string, unknown>;
	/** Column values (for insert/update) */
	values?: Record<string, unknown>;
}

export interface HistoryListParams {
	connectionId?: string;
	limit?: number;
	offset?: number;
	search?: string;
}

export interface SavedViewConfig {
	columns?: string[];
	sort?: { column: string; direction: "asc" | "desc" }[];
	filters?: { column: string; operator: string; value: unknown }[];
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
