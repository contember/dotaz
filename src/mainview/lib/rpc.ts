// Frontend RPC client — typed wrapper around Electrobun Electroview RPC
// Provides namespace access: rpc.connections.list(), rpc.schema.getTables(), etc.

import { Electroview } from "electrobun/view";
import type { DotazRPC } from "../../shared/types/rpc";
import type {
	ConnectionConfig,
	ConnectionInfo,
	ConnectionState,
} from "../../shared/types/connection";
import type {
	ColumnInfo,
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
	SavedView,
	SaveViewParams,
	TransactionStatusResult,
	UpdateConnectionParams,
	UpdateViewParams,
	ViewListParams,
} from "../../shared/types/rpc";

// ── Electroview RPC setup ────────────────────────────────

const electroviewRpc = Electroview.defineRPC<DotazRPC>({
	handlers: {
		requests: {},
		messages: {},
	},
});

// Instantiate Electroview to set up the RPC transport
new Electroview({ rpc: electroviewRpc });

// ── Error handling ───────────────────────────────────────

export { RpcError, friendlyErrorMessage } from "./rpc-errors";
import { RpcError } from "./rpc-errors";

async function call<T>(method: string, params: unknown): Promise<T> {
	try {
		const result = await (electroviewRpc.request as any)[method](params);
		return result as T;
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
		connect: (connectionId: string) =>
			call<void>("connections.connect", { connectionId }),
		disconnect: (connectionId: string) =>
			call<void>("connections.disconnect", { connectionId }),
	},

	schema: {
		getSchemas: (connectionId: string) =>
			call<SchemaInfo[]>("schema.getSchemas", { connectionId }),
		getTables: (connectionId: string, schema: string) =>
			call<TableInfo[]>("schema.getTables", { connectionId, schema }),
		getColumns: (connectionId: string, schema: string, table: string) =>
			call<ColumnInfo[]>("schema.getColumns", { connectionId, schema, table }),
		getIndexes: (connectionId: string, schema: string, table: string) =>
			call<IndexInfo[]>("schema.getIndexes", { connectionId, schema, table }),
		getForeignKeys: (connectionId: string, schema: string, table: string) =>
			call<ForeignKeyInfo[]>("schema.getForeignKeys", { connectionId, schema, table }),
	},

	data: {
		getTableData: (params: GridDataRequest) =>
			call<GridDataResponse>("data.getTableData", params),
		getRowCount: (connectionId: string, schema: string, table: string) =>
			call<{ count: number }>("data.getRowCount", { connectionId, schema, table }),
		getColumnStats: (connectionId: string, schema: string, table: string, column: string) =>
			call<ColumnStatsResult>("data.getColumnStats", { connectionId, schema, table, column }),
		applyChanges: (connectionId: string, changes: DataChange[]) =>
			call<ApplyChangesResult>("data.applyChanges", { connectionId, changes }),
		generateSql: (connectionId: string, changes: DataChange[]) =>
			call<GenerateSqlResult>("data.generateSql", { connectionId, changes }),
	},

	query: {
		execute: (connectionId: string, sql: string, queryId: string, params?: unknown[]) =>
			call<QueryResult[]>("query.execute", { connectionId, sql, queryId, params }),
		cancel: (queryId: string) =>
			call<void>("query.cancel", { queryId }),
		format: (sql: string) =>
			call<{ sql: string }>("query.format", { sql }),
	},

	tx: {
		begin: (connectionId: string) =>
			call<void>("tx.begin", { connectionId }),
		commit: (connectionId: string) =>
			call<void>("tx.commit", { connectionId }),
		rollback: (connectionId: string) =>
			call<void>("tx.rollback", { connectionId }),
		status: (connectionId: string) =>
			call<TransactionStatusResult>("tx.status", { connectionId }),
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
		clear: (connectionId?: string) =>
			call<void>("history.clear", { connectionId }),
	},

	views: {
		list: (params: ViewListParams) =>
			call<SavedView[]>("views.list", params),
		save: (params: SaveViewParams) =>
			call<SavedView>("views.save", params),
		update: (params: UpdateViewParams) =>
			call<SavedView>("views.update", params),
		delete: (id: string) =>
			call<void>("views.delete", { id }),
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
		set: (key: string, value: string) =>
			call<void>("settings.set", { key, value }),
	},
} as const;

// ── Message listeners ────────────────────────────────────

/** Subscribe to backend → frontend notifications */
export const messages = {
	onConnectionStatusChanged: (
		handler: (event: { connectionId: string; state: ConnectionState; error?: string }) => void,
	) => {
		electroviewRpc.addMessageListener("connections.statusChanged" as any, handler as any);
		return () => {
			electroviewRpc.removeMessageListener("connections.statusChanged" as any, handler as any);
		};
	},
};
