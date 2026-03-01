import type { BrowserWindow } from "electrobun/bun";
import type { DotazRPC, ExecuteQueryParams, ApplyChangesParams, GenerateSqlParams, OpenDialogParams, SaveDialogParams, ViewListParams, SaveViewParams, UpdateViewParams, HistoryListParams, RestoreParams } from "../shared/types/rpc";
import type { ConnectionManager } from "./services/connection-manager";
import type { AppDatabase } from "./storage/app-db";
import type { EncryptionService } from "./services/encryption";
import type { GridDataRequest } from "../shared/types/grid";
import type { ExportOptions, ExportPreviewRequest } from "../shared/types/export";
import { buildSelectQuery, buildCountQuery, QueryExecutor, generateChangeSql, generateChangesPreview } from "./services/query-executor";
import { TransactionManager } from "./services/transaction-manager";
import { exportToFile, exportPreview } from "./services/export-service";
import { formatSql } from "./services/sql-formatter";
import { DEFAULT_SETTINGS } from "./storage/app-db";

export interface StatelessOptions {
	stateless: boolean;
	encryption?: EncryptionService;
}

function notImplemented(method: string): never {
	throw new Error(`Not implemented yet: ${method}`);
}

export function createHandlers(cm: ConnectionManager, qe?: QueryExecutor, appDb?: AppDatabase, Utils?: typeof import("electrobun/bun").Utils, opts?: StatelessOptions) {
	const stateless = opts?.stateless ?? false;
	const encryption = opts?.encryption;
	const queryExecutor = qe ?? new QueryExecutor(cm, undefined, appDb);
	const txManager = new TransactionManager(cm);
	return {
		// ── Connection Management ─────────────────────────
		"connections.list": () => {
			return cm.listConnections();
		},
		"connections.create": ({ name, config }: { name: string; config: any }) => {
			return cm.createConnection({ name, config });
		},
		"connections.update": ({ id, name, config }: { id: string; name: string; config: any }) => {
			return cm.updateConnection({ id, name, config });
		},
		"connections.delete": async ({ id }: { id: string }) => {
			await cm.deleteConnection(id);
		},
		"connections.test": async ({ config }: { config: any }) => {
			return cm.testConnection(config);
		},
		"connections.connect": async ({ connectionId, password }: { connectionId: string; password?: string }) => {
			await cm.connect(connectionId, password ? { password } : undefined);
		},
		"connections.disconnect": async ({ connectionId }: { connectionId: string }) => {
			await cm.disconnect(connectionId);
		},

		// ── Databases (multi-database PostgreSQL) ────────
		"databases.list": async ({ connectionId }: { connectionId: string }) => {
			return cm.listDatabases(connectionId);
		},
		"databases.activate": async ({ connectionId, database }: { connectionId: string; database: string }) => {
			await cm.activateDatabase(connectionId, database);
		},
		"databases.deactivate": async ({ connectionId, database }: { connectionId: string; database: string }) => {
			await cm.deactivateDatabase(connectionId, database);
		},

		// ── Schema ───────────────────────────────────────
		"schema.getSchemas": async ({ connectionId, database }: { connectionId: string; database?: string }) => {
			const driver = cm.getDriver(connectionId, database);
			return driver.getSchemas();
		},
		"schema.getTables": async ({ connectionId, schema, database }: { connectionId: string; schema: string; database?: string }) => {
			const driver = cm.getDriver(connectionId, database);
			return driver.getTables(schema);
		},
		"schema.getColumns": async ({ connectionId, schema, table, database }: { connectionId: string; schema: string; table: string; database?: string }) => {
			const driver = cm.getDriver(connectionId, database);
			return driver.getColumns(schema, table);
		},
		"schema.getIndexes": async ({ connectionId, schema, table, database }: { connectionId: string; schema: string; table: string; database?: string }) => {
			const driver = cm.getDriver(connectionId, database);
			return driver.getIndexes(schema, table);
		},
		"schema.getForeignKeys": async ({ connectionId, schema, table, database }: { connectionId: string; schema: string; table: string; database?: string }) => {
			const driver = cm.getDriver(connectionId, database);
			return driver.getForeignKeys(schema, table);
		},

		// ── Data Grid ────────────────────────────────────
		"data.getTableData": async (req: GridDataRequest) => {
			const driver = cm.getDriver(req.connectionId, req.database);
			const { sql, params } = buildSelectQuery(
				req.schema, req.table, req.page, req.pageSize,
				req.sort, req.filters, driver,
			);
			const result = await driver.execute(sql, params);

			// Get column metadata
			const columns = await driver.getColumns(req.schema, req.table);
			const gridColumns = columns.map((c) => ({
				name: c.name,
				dataType: c.dataType,
				nullable: c.nullable,
				isPrimaryKey: c.isPrimaryKey,
			}));

			// Get total count with same filters
			const countQuery = buildCountQuery(req.schema, req.table, req.filters, driver);
			const countResult = await driver.execute(countQuery.sql, countQuery.params);
			const totalRows = Number(countResult.rows[0]?.count ?? 0);

			return {
				columns: gridColumns,
				rows: result.rows,
				totalRows,
				page: req.page,
				pageSize: req.pageSize,
			};
		},
		"data.getRowCount": async ({ connectionId, schema, table, filters, database }: { connectionId: string; schema: string; table: string; filters?: import("../shared/types/grid").ColumnFilter[]; database?: string }) => {
			const driver = cm.getDriver(connectionId, database);
			const { sql, params } = buildCountQuery(schema, table, filters, driver);
			const result = await driver.execute(sql, params);
			return { count: Number(result.rows[0]?.count ?? 0) };
		},
		"data.getColumnStats": () => {
			notImplemented("data.getColumnStats");
		},

		// ── Data Editing ─────────────────────────────────
		"data.applyChanges": async ({ connectionId, changes, database }: ApplyChangesParams) => {
			const driver = cm.getDriver(connectionId, database);
			const inExistingTx = driver.inTransaction();

			if (!inExistingTx) {
				await driver.beginTransaction();
			}
			try {
				for (const change of changes) {
					const { sql, params } = generateChangeSql(change, driver);
					await driver.execute(sql, params);
				}
				if (!inExistingTx) {
					await driver.commit();
				}
				return { appliedCount: changes.length };
			} catch (err) {
				if (!inExistingTx) {
					try {
						await driver.rollback();
					} catch {
						// Don't mask the original error
					}
				}
				throw err;
			}
		},
		"data.generateSql": ({ connectionId, changes, database }: GenerateSqlParams) => {
			const driver = cm.getDriver(connectionId, database);
			const sql = generateChangesPreview(changes, driver);
			return { sql };
		},

		// ── Query Execution ──────────────────────────────
		"query.execute": async ({ connectionId, sql, queryId, params, database }: ExecuteQueryParams) => {
			return queryExecutor.executeQuery(connectionId, sql, params, undefined, queryId, database);
		},
		"query.cancel": async ({ queryId }: { queryId: string }) => {
			await queryExecutor.cancelQuery(queryId);
		},
		"query.format": ({ sql }: { sql: string }) => {
			return { sql: formatSql(sql) };
		},

		// ── Transactions ─────────────────────────────────
		"tx.begin": async ({ connectionId, database }: { connectionId: string; database?: string }) => {
			await txManager.begin(connectionId, database);
		},
		"tx.commit": async ({ connectionId, database }: { connectionId: string; database?: string }) => {
			await txManager.commit(connectionId, database);
		},
		"tx.rollback": async ({ connectionId, database }: { connectionId: string; database?: string }) => {
			await txManager.rollback(connectionId, database);
		},
		"tx.status": ({ connectionId, database }: { connectionId: string; database?: string }) => {
			return { active: txManager.isActive(connectionId, database) };
		},

		// ── Export ────────────────────────────────────────
		"export.exportData": async (opts: ExportOptions) => {
			const driver = cm.getDriver(opts.connectionId, opts.database);
			const result = await exportToFile(driver, {
				schema: opts.schema,
				table: opts.table,
				format: opts.format,
				columns: opts.columns,
				includeHeaders: opts.includeHeaders,
				delimiter: opts.delimiter,
				batchSize: opts.batchSize,
				filters: opts.filters,
				sort: opts.sort,
				limit: opts.limit,
			}, opts.filePath);
			return { ...result, filePath: opts.filePath };
		},
		"export.preview": async (req: ExportPreviewRequest) => {
			const driver = cm.getDriver(req.connectionId, req.database);
			const content = await exportPreview(driver, {
				schema: req.schema,
				table: req.table,
				format: req.format,
				columns: req.columns,
				delimiter: req.delimiter,
				filters: req.filters,
				sort: req.sort,
				limit: req.limit,
			});
			return { content };
		},

		// ── History ───────────────────────────────────────
		"history.list": (params: HistoryListParams) => {
			if (!appDb) throw new Error("AppDatabase not available");
			return appDb.listHistory(params);
		},
		"history.clear": ({ connectionId }: { connectionId?: string }) => {
			if (!appDb) throw new Error("AppDatabase not available");
			appDb.clearHistory(connectionId);
		},

		// ── Saved Views ──────────────────────────────────
		"views.list": ({ connectionId, schemaName, tableName }: ViewListParams) => {
			if (!appDb) throw new Error("AppDatabase not available");
			return appDb.listSavedViews(connectionId, schemaName, tableName);
		},
		"views.save": ({ connectionId, schemaName, tableName, name, config }: SaveViewParams) => {
			if (!appDb) throw new Error("AppDatabase not available");
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
			const existing = appDb.listSavedViews(connectionId, schemaName, tableName);
			if (existing.some((v) => v.name === name.trim())) {
				throw new Error(`A view named "${name.trim()}" already exists for this table`);
			}
			return appDb.createSavedView({
				connectionId,
				schemaName,
				tableName,
				name: name.trim(),
				config,
			});
		},
		"views.update": ({ id, name, config }: UpdateViewParams) => {
			if (!appDb) throw new Error("AppDatabase not available");
			if (!id) {
				throw new Error("View id is required");
			}
			if (!name || !name.trim()) {
				throw new Error("View name is required");
			}
			// Check name uniqueness within the table (excluding this view)
			const current = appDb.getSavedViewById(id);
			if (!current) {
				throw new Error(`Saved view not found: ${id}`);
			}
			const existing = appDb.listSavedViews(current.connectionId, current.schemaName, current.tableName);
			if (existing.some((v) => v.id !== id && v.name === name.trim())) {
				throw new Error(`A view named "${name.trim()}" already exists for this table`);
			}
			return appDb.updateSavedView({ id, name: name.trim(), config });
		},
		"views.delete": ({ id }: { id: string }) => {
			if (!appDb) throw new Error("AppDatabase not available");
			appDb.deleteSavedView(id);
		},
		"views.listByConnection": ({ connectionId }: { connectionId: string }) => {
			if (!appDb) throw new Error("AppDatabase not available");
			return appDb.listSavedViewsByConnection(connectionId);
		},

		// ── Storage (stateless mode) ─────────────────────
		"storage.getMode": () => {
			return { stateless };
		},
		"storage.restore": async (params: RestoreParams) => {
			if (!stateless || !encryption || !appDb) return;

			// Restore connections
			for (const stored of params.connections) {
				try {
					const configJson = await encryption.decrypt(stored.encryptedConfig);
					const config = JSON.parse(configJson);
					// Insert directly into app DB with the same ID
					appDb.db.prepare(
						"INSERT OR REPLACE INTO connections (id, name, type, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
					).run(stored.id, stored.name, config.type, JSON.stringify(config), stored.createdAt, stored.updatedAt);
				} catch {
					// Skip connections that fail to decrypt (e.g. key changed)
				}
			}

			// Restore settings
			for (const [key, value] of Object.entries(params.settings)) {
				appDb.setSetting(key, value);
			}

			// Restore history
			for (const entry of params.history) {
				appDb.db.prepare(
					"INSERT OR IGNORE INTO query_history (id, connection_id, sql, status, duration_ms, row_count, error_message, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				).run(entry.id, entry.connectionId, entry.sql, entry.status, entry.durationMs ?? null, entry.rowCount ?? null, entry.errorMessage ?? null, entry.executedAt);
			}

			// Restore saved views
			for (const view of params.views) {
				appDb.db.prepare(
					"INSERT OR REPLACE INTO saved_views (id, connection_id, schema_name, table_name, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				).run(view.id, view.connectionId, view.schemaName, view.tableName, view.name, JSON.stringify(view.config), view.createdAt, view.updatedAt);
			}
		},
		"storage.encrypt": async ({ config }: { config: string }) => {
			if (!encryption) throw new Error("Encryption not available");
			const encryptedConfig = await encryption.encrypt(config);
			return { encryptedConfig };
		},

		// ── System ────────────────────────────────────────
		"system.showOpenDialog": async ({ filters, multiple }: OpenDialogParams) => {
			if (!Utils) throw new Error("Utils not available");
			const allowedFileTypes = filters && filters.length > 0
				? filters.flatMap(f => f.extensions.map(ext => `*.${ext}`)).join(",")
				: "*";

			const result = await Utils.openFileDialog({
				startingFolder: "~/",
				allowedFileTypes,
				canChooseFiles: true,
				canChooseDirectory: false,
				allowsMultipleSelection: multiple ?? false,
			});

			// Utils.openFileDialog returns [""] when cancelled
			const paths = result.filter(p => p !== "");
			return { paths, cancelled: paths.length === 0 };
		},
		"system.showSaveDialog": async ({ defaultName }: SaveDialogParams) => {
			if (!Utils) throw new Error("Utils not available");
			// Electrobun doesn't expose a native save dialog yet;
			// use directory picker + defaultName as workaround
			const result = await Utils.openFileDialog({
				startingFolder: "~/",
				allowedFileTypes: "*",
				canChooseFiles: false,
				canChooseDirectory: true,
				allowsMultipleSelection: false,
			});

			const dir = result[0];
			if (!dir || dir === "") {
				return { path: null, cancelled: true };
			}

			const path = defaultName ? `${dir}/${defaultName}` : dir;
			return { path, cancelled: false };
		},
		"settings.get": ({ key }: { key: string }) => {
			if (!appDb) throw new Error("AppDatabase not available");
			const stored = appDb.getSetting(key);
			const value = stored ?? DEFAULT_SETTINGS[key] ?? null;
			return { value };
		},
		"settings.set": ({ key, value }: { key: string; value: string }) => {
			if (!appDb) throw new Error("AppDatabase not available");
			appDb.setSetting(key, value);
		},
		"settings.getAll": () => {
			if (!appDb) throw new Error("AppDatabase not available");
			const stored = appDb.getAllSettings();
			return { ...DEFAULT_SETTINGS, ...stored };
		},
	} as const;
}

export function createRPC(cm: ConnectionManager, appDb: AppDatabase | undefined, BrowserView: typeof import("electrobun/bun").BrowserView, Utils?: typeof import("electrobun/bun").Utils) {
	return BrowserView.defineRPC<DotazRPC>({
		maxRequestTime: 30000,
		handlers: {
			requests: createHandlers(cm, undefined, appDb, Utils),
			messages: {},
		},
	});
}

export function setupStatusNotifications(
	window: BrowserWindow,
	cm: ConnectionManager,
): () => void {
	return cm.onStatusChanged((event) => {
		(window as any).webview.rpc.send["connections.statusChanged"]({
			connectionId: event.connectionId,
			state: event.state,
			error: event.error,
		});
	});
}
