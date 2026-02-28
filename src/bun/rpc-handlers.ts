import type { BrowserWindow } from "electrobun/bun";
import type { DotazRPC, ExecuteQueryParams, OpenDialogParams, SaveDialogParams } from "../shared/types/rpc";
import type { ConnectionManager } from "./services/connection-manager";
import type { GridDataRequest } from "../shared/types/grid";
import { buildSelectQuery, buildCountQuery, QueryExecutor } from "./services/query-executor";
import { formatSql } from "./services/sql-formatter";

function notImplemented(method: string): never {
	throw new Error(`Not implemented yet: ${method}`);
}

export function createHandlers(cm: ConnectionManager, qe?: QueryExecutor) {
	const queryExecutor = qe ?? new QueryExecutor(cm);
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
		"connections.connect": async ({ connectionId }: { connectionId: string }) => {
			await cm.connect(connectionId);
		},
		"connections.disconnect": async ({ connectionId }: { connectionId: string }) => {
			await cm.disconnect(connectionId);
		},

		// ── Schema ───────────────────────────────────────
		"schema.getSchemas": async ({ connectionId }: { connectionId: string }) => {
			const driver = cm.getDriver(connectionId);
			return driver.getSchemas();
		},
		"schema.getTables": async ({ connectionId, schema }: { connectionId: string; schema: string }) => {
			const driver = cm.getDriver(connectionId);
			return driver.getTables(schema);
		},
		"schema.getColumns": async ({ connectionId, schema, table }: { connectionId: string; schema: string; table: string }) => {
			const driver = cm.getDriver(connectionId);
			return driver.getColumns(schema, table);
		},
		"schema.getIndexes": async ({ connectionId, schema, table }: { connectionId: string; schema: string; table: string }) => {
			const driver = cm.getDriver(connectionId);
			return driver.getIndexes(schema, table);
		},
		"schema.getForeignKeys": async ({ connectionId, schema, table }: { connectionId: string; schema: string; table: string }) => {
			const driver = cm.getDriver(connectionId);
			return driver.getForeignKeys(schema, table);
		},

		// ── Data Grid ────────────────────────────────────
		"data.getTableData": async (req: GridDataRequest) => {
			const driver = cm.getDriver(req.connectionId);
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
		"data.getRowCount": async ({ connectionId, schema, table, filters }: { connectionId: string; schema: string; table: string; filters?: import("../shared/types/grid").ColumnFilter[] }) => {
			const driver = cm.getDriver(connectionId);
			const { sql, params } = buildCountQuery(schema, table, filters, driver);
			const result = await driver.execute(sql, params);
			return { count: Number(result.rows[0]?.count ?? 0) };
		},
		"data.getColumnStats": () => {
			notImplemented("data.getColumnStats");
		},

		// ── Data Editing (stub) ──────────────────────────
		"data.applyChanges": () => {
			notImplemented("data.applyChanges");
		},
		"data.generateSql": () => {
			notImplemented("data.generateSql");
		},

		// ── Query Execution ──────────────────────────────
		"query.execute": async ({ connectionId, sql, queryId, params }: ExecuteQueryParams) => {
			return queryExecutor.executeQuery(connectionId, sql, params, undefined, queryId);
		},
		"query.cancel": async ({ queryId }: { queryId: string }) => {
			await queryExecutor.cancelQuery(queryId);
		},
		"query.format": ({ sql }: { sql: string }) => {
			return { sql: formatSql(sql) };
		},

		// ── Transactions (stub) ───────────────────────────
		"tx.begin": () => {
			notImplemented("tx.begin");
		},
		"tx.commit": () => {
			notImplemented("tx.commit");
		},
		"tx.rollback": () => {
			notImplemented("tx.rollback");
		},
		"tx.status": () => {
			notImplemented("tx.status");
		},

		// ── Export (stub) ─────────────────────────────────
		"export.exportData": () => {
			notImplemented("export.exportData");
		},
		"export.preview": () => {
			notImplemented("export.preview");
		},

		// ── History (stub) ────────────────────────────────
		"history.list": () => {
			notImplemented("history.list");
		},
		"history.clear": () => {
			notImplemented("history.clear");
		},

		// ── Saved Views (stub) ────────────────────────────
		"views.list": () => {
			notImplemented("views.list");
		},
		"views.save": () => {
			notImplemented("views.save");
		},
		"views.update": () => {
			notImplemented("views.update");
		},
		"views.delete": () => {
			notImplemented("views.delete");
		},

		// ── System ────────────────────────────────────────
		"system.showOpenDialog": async ({ filters, multiple }: OpenDialogParams) => {
			const { Utils } = require("electrobun/bun") as typeof import("electrobun/bun");

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
			const { Utils } = require("electrobun/bun") as typeof import("electrobun/bun");

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
		"settings.get": () => {
			notImplemented("settings.get");
		},
		"settings.set": () => {
			notImplemented("settings.set");
		},
	} as const;
}

export function createRPC(cm: ConnectionManager) {
	// Lazy import to avoid Electrobun dependency in tests
	const { BrowserView } = require("electrobun/bun") as typeof import("electrobun/bun");
	return BrowserView.defineRPC<DotazRPC>({
		maxRequestTime: 30000,
		handlers: {
			requests: createHandlers(cm),
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
