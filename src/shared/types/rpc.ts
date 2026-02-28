// RPC schema definitions per Electrobun RPC pattern
// Covers all planned methods from ARCHITECTURE.md

import type { RPCSchema } from "electrobun/bun";
import type { ConnectionConfig, ConnectionInfo, ConnectionState } from "./connection";
import type {
	ColumnInfo,
	ForeignKeyInfo,
	IndexInfo,
	SchemaInfo,
	TableInfo,
} from "./database";
import type { ExportOptions, ExportPreviewRequest, ExportResult } from "./export";
import type {
	ColumnFilter,
	GridDataRequest,
	GridDataResponse,
} from "./grid";
import type { QueryHistoryEntry, QueryResult } from "./query";

// ---- RPC request/response param types ----

export interface CreateConnectionParams {
	name: string;
	config: ConnectionConfig;
}

export interface UpdateConnectionParams {
	id: string;
	name: string;
	config: ConnectionConfig;
}

export interface ConnectionIdParams {
	connectionId: string;
}

export interface SchemaParams {
	connectionId: string;
	schema: string;
}

export interface TableParams {
	connectionId: string;
	schema: string;
	table: string;
}

export interface ExecuteQueryParams {
	connectionId: string;
	sql: string;
	params?: unknown[];
}

export interface FormatSqlParams {
	sql: string;
}

export interface TransactionStatusResult {
	active: boolean;
}

export interface ColumnStatsParams {
	connectionId: string;
	schema: string;
	table: string;
	column: string;
}

export interface ColumnStatsResult {
	distinctCount: number;
	nullCount: number;
	sampleValues: unknown[];
}

export interface DataChange {
	type: "insert" | "update" | "delete";
	schema: string;
	table: string;
	/** Primary key values identifying the row (for update/delete) */
	primaryKeys?: Record<string, unknown>;
	/** Column values (for insert/update) */
	values?: Record<string, unknown>;
}

export interface ApplyChangesParams {
	connectionId: string;
	changes: DataChange[];
}

export interface ApplyChangesResult {
	appliedCount: number;
}

export interface GenerateSqlParams {
	connectionId: string;
	changes: DataChange[];
}

export interface GenerateSqlResult {
	sql: string;
}

export interface HistoryListParams {
	connectionId?: string;
	limit?: number;
	offset?: number;
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

export interface SaveViewParams {
	connectionId: string;
	schemaName: string;
	tableName: string;
	name: string;
	config: SavedViewConfig;
}

export interface UpdateViewParams {
	id: string;
	name: string;
	config: SavedViewConfig;
}

export interface ViewListParams {
	connectionId: string;
	schemaName: string;
	tableName: string;
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

export interface SettingsGetParams {
	key: string;
}

export interface SettingsSetParams {
	key: string;
	value: string;
}

// ---- Main RPC schema ----

export type DotazRPC = {
	bun: RPCSchema<{
		requests: {
			// Connection Management
			"connections.list": {
				params: {};
				response: ConnectionInfo[];
			};
			"connections.create": {
				params: CreateConnectionParams;
				response: ConnectionInfo;
			};
			"connections.update": {
				params: UpdateConnectionParams;
				response: ConnectionInfo;
			};
			"connections.delete": {
				params: { id: string };
				response: void;
			};
			"connections.test": {
				params: { config: ConnectionConfig };
				response: { success: boolean; error?: string };
			};
			"connections.connect": {
				params: ConnectionIdParams;
				response: void;
			};
			"connections.disconnect": {
				params: ConnectionIdParams;
				response: void;
			};

			// Schema
			"schema.getSchemas": {
				params: ConnectionIdParams;
				response: SchemaInfo[];
			};
			"schema.getTables": {
				params: SchemaParams;
				response: TableInfo[];
			};
			"schema.getColumns": {
				params: TableParams;
				response: ColumnInfo[];
			};
			"schema.getIndexes": {
				params: TableParams;
				response: IndexInfo[];
			};
			"schema.getForeignKeys": {
				params: TableParams;
				response: ForeignKeyInfo[];
			};

			// Data Grid
			"data.getTableData": {
				params: GridDataRequest;
				response: GridDataResponse;
			};
			"data.getRowCount": {
				params: TableParams & { filters?: ColumnFilter[] };
				response: { count: number };
			};
			"data.getColumnStats": {
				params: ColumnStatsParams;
				response: ColumnStatsResult;
			};

			// Data Editing
			"data.applyChanges": {
				params: ApplyChangesParams;
				response: ApplyChangesResult;
			};
			"data.generateSql": {
				params: GenerateSqlParams;
				response: GenerateSqlResult;
			};

			// Query Execution
			"query.execute": {
				params: ExecuteQueryParams;
				response: QueryResult;
			};
			"query.cancel": {
				params: ConnectionIdParams;
				response: void;
			};
			"query.format": {
				params: FormatSqlParams;
				response: { sql: string };
			};

			// Transactions
			"tx.begin": {
				params: ConnectionIdParams;
				response: void;
			};
			"tx.commit": {
				params: ConnectionIdParams;
				response: void;
			};
			"tx.rollback": {
				params: ConnectionIdParams;
				response: void;
			};
			"tx.status": {
				params: ConnectionIdParams;
				response: TransactionStatusResult;
			};

			// Export
			"export.exportData": {
				params: ExportOptions;
				response: ExportResult;
			};
			"export.preview": {
				params: ExportPreviewRequest;
				response: { content: string };
			};

			// History
			"history.list": {
				params: HistoryListParams;
				response: QueryHistoryEntry[];
			};
			"history.clear": {
				params: { connectionId?: string };
				response: void;
			};

			// Saved Views
			"views.list": {
				params: ViewListParams;
				response: SavedView[];
			};
			"views.save": {
				params: SaveViewParams;
				response: SavedView;
			};
			"views.update": {
				params: UpdateViewParams;
				response: SavedView;
			};
			"views.delete": {
				params: { id: string };
				response: void;
			};

			// System
			"system.showOpenDialog": {
				params: OpenDialogParams;
				response: { paths: string[]; cancelled: boolean };
			};
			"system.showSaveDialog": {
				params: SaveDialogParams;
				response: { path: string | null; cancelled: boolean };
			};
			"settings.get": {
				params: SettingsGetParams;
				response: { value: string | null };
			};
			"settings.set": {
				params: SettingsSetParams;
				response: void;
			};
		};
		messages: {
			// Backend → Frontend notifications
			"connections.statusChanged": {
				connectionId: string;
				state: ConnectionState;
				error?: string;
			};
		};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {};
	}>;
};
