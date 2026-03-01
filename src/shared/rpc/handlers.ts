import type { RpcAdapter } from "./adapter";
import type { ExportOptions, ExportPreviewRequest } from "../types/export";
import type {
	HistoryListParams,
	SavedViewConfig,
	OpenDialogParams,
	SaveDialogParams,
} from "../types/rpc";

export function createHandlers(adapter: RpcAdapter) {
	return {
		// ── Connection Management ─────────────────────────
		"connections.list": () => {
			return adapter.listConnections();
		},
		"connections.create": ({ name, config }: { name: string; config: any }) => {
			return adapter.createConnection({ name, config });
		},
		"connections.update": ({ id, name, config }: { id: string; name: string; config: any }) => {
			return adapter.updateConnection({ id, name, config });
		},
		"connections.delete": async ({ id }: { id: string }) => {
			await adapter.deleteConnection(id);
		},
		"connections.test": async ({ config }: { config: any }) => {
			return adapter.testConnection(config);
		},
		"connections.connect": async ({ connectionId, password, encryptedConfig, name }: { connectionId: string; password?: string; encryptedConfig?: string; name?: string }) => {
			await adapter.connect(connectionId, password, encryptedConfig, name);
		},
		"connections.disconnect": async ({ connectionId }: { connectionId: string }) => {
			await adapter.disconnect(connectionId);
		},

		// ── Databases (multi-database PostgreSQL) ────────
		"databases.list": async ({ connectionId }: { connectionId: string }) => {
			return adapter.listDatabases(connectionId);
		},
		"databases.activate": async ({ connectionId, database }: { connectionId: string; database: string }) => {
			await adapter.activateDatabase(connectionId, database);
		},
		"databases.deactivate": async ({ connectionId, database }: { connectionId: string; database: string }) => {
			await adapter.deactivateDatabase(connectionId, database);
		},

		// ── Schema ───────────────────────────────────────
		"schema.load": async ({ connectionId, database }: { connectionId: string; database?: string }) => {
			const driver = adapter.getDriver(connectionId, database);
			return driver.loadSchema();
		},

		// ── Query Execution ──────────────────────────────
		"query.execute": async ({ connectionId, sql, queryId, params, database, statements }: {
			connectionId: string; sql: string; queryId: string;
			params?: unknown[]; database?: string;
			statements?: { sql: string; params?: unknown[] }[];
		}) => {
			if (statements && statements.length > 0) {
				return adapter.executeStatements(connectionId, statements, database);
			}
			return adapter.executeQuery(connectionId, sql, params, queryId, database);
		},
		"query.cancel": async ({ queryId }: { queryId: string }) => {
			await adapter.cancelQuery(queryId);
		},
		"query.format": ({ sql }: { sql: string }) => {
			return { sql: adapter.formatSql(sql) };
		},

		// ── Transactions ─────────────────────────────────
		"tx.begin": async ({ connectionId, database }: { connectionId: string; database?: string }) => {
			await adapter.beginTransaction(connectionId, database);
		},
		"tx.commit": async ({ connectionId, database }: { connectionId: string; database?: string }) => {
			await adapter.commitTransaction(connectionId, database);
		},
		"tx.rollback": async ({ connectionId, database }: { connectionId: string; database?: string }) => {
			await adapter.rollbackTransaction(connectionId, database);
		},

		// ── Export ────────────────────────────────────────
		"export.exportData": async (opts: ExportOptions) => {
			return adapter.exportData(opts);
		},
		"export.preview": async (req: ExportPreviewRequest) => {
			const content = await adapter.exportPreview(req);
			return { content };
		},

		// ── History ───────────────────────────────────────
		"history.list": (params: HistoryListParams) => {
			return adapter.listHistory(params);
		},
		"history.clear": ({ connectionId }: { connectionId?: string }) => {
			adapter.clearHistory(connectionId);
		},

		// ── Saved Views ──────────────────────────────────
		"views.save": ({ connectionId, schemaName, tableName, name, config }: {
			connectionId: string; schemaName: string; tableName: string;
			name: string; config: SavedViewConfig;
		}) => {
			if (!name || !name.trim()) {
				throw new Error("View name is required");
			}
			if (!connectionId) {
				throw new Error("connectionId is required");
			}
			if (!tableName) {
				throw new Error("tableName is required");
			}
			// Check name uniqueness within the table
			const existing = adapter.listSavedViews(connectionId, schemaName, tableName);
			if (existing.some((v) => v.name === name.trim())) {
				throw new Error(`A view named "${name.trim()}" already exists for this table`);
			}
			return adapter.createSavedView({
				connectionId,
				schemaName,
				tableName,
				name: name.trim(),
				config,
			});
		},
		"views.update": ({ id, name, config }: {
			id: string; name: string; config: SavedViewConfig;
		}) => {
			if (!id) {
				throw new Error("View id is required");
			}
			if (!name || !name.trim()) {
				throw new Error("View name is required");
			}
			// Check name uniqueness within the table (excluding this view)
			const current = adapter.getSavedViewById(id);
			if (!current) {
				throw new Error(`Saved view not found: ${id}`);
			}
			const existing = adapter.listSavedViews(current.connectionId, current.schemaName, current.tableName);
			if (existing.some((v) => v.id !== id && v.name === name.trim())) {
				throw new Error(`A view named "${name.trim()}" already exists for this table`);
			}
			return adapter.updateSavedView({ id, name: name.trim(), config });
		},
		"views.delete": ({ id }: { id: string }) => {
			adapter.deleteSavedView(id);
		},
		"views.listByConnection": ({ connectionId }: { connectionId: string }) => {
			return adapter.listSavedViewsByConnection(connectionId);
		},

		// ── Storage ──────────────────────────────────────
		"storage.encrypt": async ({ config }: { config: string }) => {
			if (!adapter.encrypt) {
				throw new Error("Encryption not available");
			}
			const encryptedConfig = await adapter.encrypt(config);
			return { encryptedConfig };
		},

		// ── System ────────────────────────────────────────
		"system.showOpenDialog": async (params: OpenDialogParams) => {
			if (!adapter.showOpenDialog) {
				return { paths: [] as string[], cancelled: true };
			}
			return adapter.showOpenDialog(params);
		},
		"system.showSaveDialog": async (params: SaveDialogParams) => {
			if (!adapter.showSaveDialog) {
				return { path: null as string | null, cancelled: true };
			}
			return adapter.showSaveDialog(params);
		},
	} as const;
}
