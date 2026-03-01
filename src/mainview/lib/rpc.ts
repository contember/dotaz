// Frontend RPC client — typed wrapper around transport layer
// Provides namespace access: rpc.connections.list(), rpc.schema.getTables(), etc.

import { transport } from "./transport";
import type {
	ConnectionConfig,
	ConnectionInfo,
	ConnectionState,
} from "../../shared/types/connection";
import type {
	ColumnInfo,
	DatabaseInfo,
	ForeignKeyInfo,
	IndexInfo,
	SchemaInfo,
	TableInfo,
} from "../../shared/types/database";
import type { GridDataRequest, GridDataResponse } from "../../shared/types/grid";
import type {
	ExportOptions,
	ExportPreviewRequest,
	ExportResult,
} from "../../shared/types/export";
import type { QueryHistoryEntry, QueryResult } from "../../shared/types/query";
import type {
	ApplyChangesResult,
	ColumnStatsResult,
	CreateConnectionParams,
	DataChange,
	GenerateSqlResult,
	HistoryListParams,
	RestoreParams,
	SavedView,
	SaveViewParams,
	TransactionStatusResult,
	UpdateConnectionParams,
	UpdateViewParams,
	ViewListParams,
} from "../../shared/types/rpc";

// ── Error handling ───────────────────────────────────────

export { RpcError, friendlyErrorMessage } from "./rpc-errors";
import { RpcError } from "./rpc-errors";
import { isStateless } from "./mode";
import { putStoredView, deleteStoredView, putSetting, clearStoredHistory } from "./browser-storage";

async function call<T>(method: string, params: unknown): Promise<T> {
	try {
		return await transport.call<T>(method, params);
	} catch (err) {
		throw new RpcError(method, err);
	}
}

// ── Typed RPC client ─────────────────────────────────────

export const rpc = {
	connections: {
		list: () =>
			call<ConnectionInfo[]>("connections.list", {}),
		create: (params: CreateConnectionParams) =>
			call<ConnectionInfo>("connections.create", params),
		update: (params: UpdateConnectionParams) =>
			call<ConnectionInfo>("connections.update", params),
		delete: (id: string) =>
			call<void>("connections.delete", { id }),
		test: (config: ConnectionConfig) =>
			call<{ success: boolean; error?: string }>("connections.test", { config }),
		connect: (connectionId: string, password?: string) =>
			call<void>("connections.connect", { connectionId, password }),
		disconnect: (connectionId: string) =>
			call<void>("connections.disconnect", { connectionId }),
	},

	databases: {
		list: (connectionId: string) =>
			call<DatabaseInfo[]>("databases.list", { connectionId }),
		activate: (connectionId: string, database: string) =>
			call<void>("databases.activate", { connectionId, database }),
		deactivate: (connectionId: string, database: string) =>
			call<void>("databases.deactivate", { connectionId, database }),
	},

	schema: {
		getSchemas: (connectionId: string, database?: string) =>
			call<SchemaInfo[]>("schema.getSchemas", { connectionId, database }),
		getTables: (connectionId: string, schema: string, database?: string) =>
			call<TableInfo[]>("schema.getTables", { connectionId, schema, database }),
		getColumns: (connectionId: string, schema: string, table: string, database?: string) =>
			call<ColumnInfo[]>("schema.getColumns", { connectionId, schema, table, database }),
		getIndexes: (connectionId: string, schema: string, table: string, database?: string) =>
			call<IndexInfo[]>("schema.getIndexes", { connectionId, schema, table, database }),
		getForeignKeys: (connectionId: string, schema: string, table: string, database?: string) =>
			call<ForeignKeyInfo[]>("schema.getForeignKeys", { connectionId, schema, table, database }),
	},

	data: {
		getTableData: (params: GridDataRequest) =>
			call<GridDataResponse>("data.getTableData", params),
		getRowCount: (connectionId: string, schema: string, table: string, database?: string) =>
			call<{ count: number }>("data.getRowCount", { connectionId, schema, table, database }),
		getColumnStats: (connectionId: string, schema: string, table: string, column: string, database?: string) =>
			call<ColumnStatsResult>("data.getColumnStats", { connectionId, schema, table, column, database }),
		applyChanges: (connectionId: string, changes: DataChange[], database?: string) =>
			call<ApplyChangesResult>("data.applyChanges", { connectionId, changes, database }),
		generateSql: (connectionId: string, changes: DataChange[], database?: string) =>
			call<GenerateSqlResult>("data.generateSql", { connectionId, changes, database }),
	},

	query: {
		execute: (connectionId: string, sql: string, queryId: string, params?: unknown[], database?: string) =>
			call<QueryResult[]>("query.execute", { connectionId, sql, queryId, params, database }),
		cancel: (queryId: string) =>
			call<void>("query.cancel", { queryId }),
		format: (sql: string) =>
			call<{ sql: string }>("query.format", { sql }),
	},

	tx: {
		begin: (connectionId: string, database?: string) =>
			call<void>("tx.begin", { connectionId, database }),
		commit: (connectionId: string, database?: string) =>
			call<void>("tx.commit", { connectionId, database }),
		rollback: (connectionId: string, database?: string) =>
			call<void>("tx.rollback", { connectionId, database }),
		status: (connectionId: string, database?: string) =>
			call<TransactionStatusResult>("tx.status", { connectionId, database }),
	},

	export: {
		exportData: (params: ExportOptions) =>
			call<ExportResult>("export.exportData", params),
		preview: (params: ExportPreviewRequest) =>
			call<{ content: string }>("export.preview", params),
	},

	history: {
		list: (params?: HistoryListParams) =>
			call<QueryHistoryEntry[]>("history.list", params ?? {}),
		clear: async (connectionId?: string) => {
			await call<void>("history.clear", { connectionId });
			if (isStateless()) clearStoredHistory(connectionId).catch((e) => console.warn("Failed to clear stored history:", e));
		},
	},

	views: {
		list: (params: ViewListParams) =>
			call<SavedView[]>("views.list", params),
		listByConnection: (connectionId: string) =>
			call<SavedView[]>("views.listByConnection", { connectionId }),
		save: async (params: SaveViewParams) => {
			const view = await call<SavedView>("views.save", params);
			if (isStateless()) putStoredView(view).catch((e) => console.warn("Failed to store view:", e));
			return view;
		},
		update: async (params: UpdateViewParams) => {
			const view = await call<SavedView>("views.update", params);
			if (isStateless()) putStoredView(view).catch((e) => console.warn("Failed to store view:", e));
			return view;
		},
		delete: async (id: string) => {
			await call<void>("views.delete", { id });
			if (isStateless()) deleteStoredView(id).catch((e) => console.warn("Failed to delete stored view:", e));
		},
	},

	system: {
		showOpenDialog: (params?: { title?: string; filters?: { name: string; extensions: string[] }[]; multiple?: boolean }) =>
			call<{ paths: string[]; cancelled: boolean }>("system.showOpenDialog", params ?? {}),
		showSaveDialog: (params?: { title?: string; defaultName?: string; filters?: { name: string; extensions: string[] }[] }) =>
			call<{ path: string | null; cancelled: boolean }>("system.showSaveDialog", params ?? {}),
	},

	settings: {
		get: (key: string) =>
			call<{ value: string | null }>("settings.get", { key }),
		set: async (key: string, value: string) => {
			await call<void>("settings.set", { key, value });
			if (isStateless()) putSetting(key, value).catch((e) => console.warn("Failed to store setting:", e));
		},
		getAll: () =>
			call<Record<string, string>>("settings.getAll", {}),
	},

	storage: {
		getMode: () =>
			call<{ stateless: boolean }>("storage.getMode", {}),
		restore: (params: RestoreParams) =>
			call<void>("storage.restore", params),
		encrypt: (config: string) =>
			call<{ encryptedConfig: string }>("storage.encrypt", { config }),
	},
} as const;

// ── Message listeners ────────────────────────────────────

/** Subscribe to backend → frontend notifications */
export const messages = {
	onConnectionStatusChanged: (
		handler: (event: { connectionId: string; state: ConnectionState; error?: string }) => void,
	) => {
		return transport.addMessageListener("connections.statusChanged", handler);
	},
	onMenuAction: (
		handler: (event: { action: string }) => void,
	) => {
		return transport.addMessageListener("menu.action", handler);
	},
};
