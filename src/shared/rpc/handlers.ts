import type { RpcAdapter } from "./adapter";
import type { SchemaData } from "../types/database";
import type { GridDataRequest } from "../types/grid";
import type { ExportOptions, ExportPreviewRequest } from "../types/export";
import type {
	ApplyChangesParams,
	GenerateSqlParams,
	ExecuteQueryParams,
	HistoryListParams,
	ViewListParams,
	SaveViewParams,
	UpdateViewParams,
	RestoreParams,
	OpenDialogParams,
	SaveDialogParams,
} from "../types/rpc";
import {
	buildSelectQuery,
	buildCountQuery,
	buildQuickSearchClause,
	generateChangeSql,
	generateChangesPreview,
} from "../sql/builders";

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
		"connections.connect": async ({ connectionId, password }: { connectionId: string; password?: string }) => {
			await adapter.connect(connectionId, password);
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
		"schema.getSchemas": async ({ connectionId, database }: { connectionId: string; database?: string }) => {
			const driver = adapter.getDriver(connectionId, database);
			return driver.getSchemas();
		},
		"schema.getTables": async ({ connectionId, schema, database }: { connectionId: string; schema: string; database?: string }) => {
			const driver = adapter.getDriver(connectionId, database);
			return driver.getTables(schema);
		},
		"schema.getColumns": async ({ connectionId, schema, table, database }: { connectionId: string; schema: string; table: string; database?: string }) => {
			const driver = adapter.getDriver(connectionId, database);
			return driver.getColumns(schema, table);
		},
		"schema.getIndexes": async ({ connectionId, schema, table, database }: { connectionId: string; schema: string; table: string; database?: string }) => {
			const driver = adapter.getDriver(connectionId, database);
			return driver.getIndexes(schema, table);
		},
		"schema.getForeignKeys": async ({ connectionId, schema, table, database }: { connectionId: string; schema: string; table: string; database?: string }) => {
			const driver = adapter.getDriver(connectionId, database);
			return driver.getForeignKeys(schema, table);
		},
		"schema.getReferencingForeignKeys": async ({ connectionId, schema, table, database }: { connectionId: string; schema: string; table: string; database?: string }) => {
			const driver = adapter.getDriver(connectionId, database);
			return driver.getReferencingForeignKeys(schema, table);
		},
		"schema.load": async ({ connectionId, database }: { connectionId: string; database?: string }): Promise<SchemaData> => {
			const driver = adapter.getDriver(connectionId, database);
			const schemas = await driver.getSchemas();

			const tables: SchemaData["tables"] = {};
			const columns: SchemaData["columns"] = {};
			const indexes: SchemaData["indexes"] = {};
			const foreignKeys: SchemaData["foreignKeys"] = {};
			const referencingForeignKeys: SchemaData["referencingForeignKeys"] = {};

			for (const schema of schemas) {
				const schemaTables = await driver.getTables(schema.name);
				tables[schema.name] = schemaTables;

				for (const table of schemaTables) {
					const key = `${schema.name}.${table.name}`;
					const [cols, idxs, fks, refFks] = await Promise.all([
						driver.getColumns(schema.name, table.name),
						driver.getIndexes(schema.name, table.name),
						driver.getForeignKeys(schema.name, table.name),
						driver.getReferencingForeignKeys(schema.name, table.name),
					]);
					columns[key] = cols;
					indexes[key] = idxs;
					foreignKeys[key] = fks;
					referencingForeignKeys[key] = refFks;
				}
			}

			return { schemas, tables, columns, indexes, foreignKeys, referencingForeignKeys };
		},

		// ── Data Grid ────────────────────────────────────
		"data.getTableData": async (req: GridDataRequest) => {
			const driver = adapter.getDriver(req.connectionId, req.database);

			// Get column metadata
			const columns = await driver.getColumns(req.schema, req.table);
			const gridColumns = columns.map((c) => ({
				name: c.name,
				dataType: c.dataType,
				nullable: c.nullable,
				isPrimaryKey: c.isPrimaryKey,
			}));

			// Build quick search clause if search term is provided
			const filterParamCount = (req.filters ?? []).reduce((sum, f) => {
				if (f.operator === "isNull" || f.operator === "isNotNull") return sum;
				if (f.operator === "in" || f.operator === "notIn") {
					return sum + (Array.isArray(f.value) ? f.value.length : 1);
				}
				return sum + 1;
			}, 0);
			const quickSearchClause = req.quickSearch
				? buildQuickSearchClause(gridColumns, req.quickSearch, driver, filterParamCount)
				: undefined;

			const { sql, params } = buildSelectQuery(
				req.schema, req.table, req.page, req.pageSize,
				req.sort, req.filters, driver, quickSearchClause,
			);
			const result = await driver.execute(sql, params);

			// Get total count with same filters + quick search
			const countQuery = buildCountQuery(req.schema, req.table, req.filters, driver, quickSearchClause);
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
		"data.getRowCount": async ({ connectionId, schema, table, filters, database }: { connectionId: string; schema: string; table: string; filters?: import("../types/grid").ColumnFilter[]; database?: string }) => {
			const driver = adapter.getDriver(connectionId, database);
			const { sql, params } = buildCountQuery(schema, table, filters, driver);
			const result = await driver.execute(sql, params);
			return { count: Number(result.rows[0]?.count ?? 0) };
		},
		"data.getColumnStats": () => {
			throw new Error("Not implemented yet: data.getColumnStats");
		},

		// ── Data Editing ─────────────────────────────────
		"data.applyChanges": async ({ connectionId, changes, database }: ApplyChangesParams) => {
			const driver = adapter.getDriver(connectionId, database);
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
			const driver = adapter.getDriver(connectionId, database);
			const sql = generateChangesPreview(changes, driver);
			return { sql };
		},

		// ── Query Execution ──────────────────────────────
		"query.execute": async ({ connectionId, sql, queryId, params, database, statements }: ExecuteQueryParams) => {
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
		"tx.status": ({ connectionId, database }: { connectionId: string; database?: string }) => {
			return { active: adapter.isTransactionActive(connectionId, database) };
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
		"views.list": ({ connectionId, schemaName, tableName }: ViewListParams) => {
			return adapter.listSavedViews(connectionId, schemaName, tableName);
		},
		"views.save": ({ connectionId, schemaName, tableName, name, config }: SaveViewParams) => {
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
		"views.update": ({ id, name, config }: UpdateViewParams) => {
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

		// ── Storage (stateless mode) ─────────────────────
		"storage.getMode": () => {
			return { stateless: adapter.isStateless() };
		},
		"storage.restore": async (params: RestoreParams) => {
			if (adapter.restore) {
				await adapter.restore(params);
			}
		},
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
		"settings.get": ({ key }: { key: string }) => {
			const stored = adapter.getSetting(key);
			const defaults = adapter.getDefaultSettings();
			const value = stored ?? defaults[key] ?? null;
			return { value };
		},
		"settings.set": ({ key, value }: { key: string; value: string }) => {
			adapter.setSetting(key, value);
		},
		"settings.getAll": () => {
			const stored = adapter.getAllSettings();
			const defaults = adapter.getDefaultSettings();
			return { ...defaults, ...stored };
		},
	} as const;
}
