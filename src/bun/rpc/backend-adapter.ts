import type { RpcAdapter } from "../../shared/rpc/adapter";
import type { ConnectionManager } from "../services/connection-manager";
import type { QueryExecutor } from "../services/query-executor";
import type { AppDatabase } from "../storage/app-db";
import type { EncryptionService } from "../services/encryption";
import type { ConnectionConfig, ConnectionInfo } from "../../shared/types/connection";
import type { DatabaseInfo } from "../../shared/types/database";
import type { QueryResult, QueryHistoryEntry } from "../../shared/types/query";
import type { ExportOptions, ExportPreviewRequest, ExportResult } from "../../shared/types/export";
import type {
	SavedView,
	SavedViewConfig,
	HistoryListParams,
	RestoreParams,
	OpenDialogParams,
	SaveDialogParams,
} from "../../shared/types/rpc";
import type { DatabaseDriver } from "../db/driver";
import { TransactionManager } from "../services/transaction-manager";
import { exportToFile, exportPreview } from "../services/export-service";
import { formatSql } from "../services/sql-formatter";


export interface BackendAdapterOptions {
	stateless?: boolean;
	encryption?: EncryptionService;
	Utils?: typeof import("electrobun/bun").Utils;
}

export class BackendAdapter implements RpcAdapter {
	private txManager: TransactionManager;
	private stateless: boolean;
	private encryption?: EncryptionService;
	private Utils?: typeof import("electrobun/bun").Utils;

	constructor(
		private cm: ConnectionManager,
		private queryExecutor: QueryExecutor,
		private appDb: AppDatabase,
		opts?: BackendAdapterOptions,
	) {
		this.txManager = new TransactionManager(cm);
		this.stateless = opts?.stateless ?? false;
		this.encryption = opts?.encryption;
		this.Utils = opts?.Utils;
	}

	// ── Connections ────────────────────────────────────────

	listConnections(): ConnectionInfo[] {
		return this.cm.listConnections();
	}

	createConnection(params: { name: string; config: ConnectionConfig }): ConnectionInfo {
		return this.cm.createConnection(params);
	}

	updateConnection(params: { id: string; name: string; config: ConnectionConfig }): ConnectionInfo {
		return this.cm.updateConnection(params);
	}

	async deleteConnection(id: string): Promise<void> {
		await this.cm.deleteConnection(id);
	}

	async testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string }> {
		return this.cm.testConnection(config);
	}

	async connect(connectionId: string, password?: string): Promise<void> {
		await this.cm.connect(connectionId, password ? { password } : undefined);
	}

	async disconnect(connectionId: string): Promise<void> {
		await this.cm.disconnect(connectionId);
	}

	// ── Driver access ─────────────────────────────────────

	getDriver(connectionId: string, database?: string): DatabaseDriver {
		return this.cm.getDriver(connectionId, database);
	}

	// ── Multi-database ────────────────────────────────────

	async listDatabases(connectionId: string): Promise<DatabaseInfo[]> {
		return this.cm.listDatabases(connectionId);
	}

	async activateDatabase(connectionId: string, database: string): Promise<void> {
		await this.cm.activateDatabase(connectionId, database);
	}

	async deactivateDatabase(connectionId: string, database: string): Promise<void> {
		await this.cm.deactivateDatabase(connectionId, database);
	}

	// ── Query execution ───────────────────────────────────

	async executeQuery(connectionId: string, sql: string, params?: unknown[], queryId?: string, database?: string): Promise<QueryResult[]> {
		return this.queryExecutor.executeQuery(connectionId, sql, params, undefined, queryId, database);
	}

	async executeStatements(connectionId: string, statements: { sql: string; params?: unknown[] }[], database?: string): Promise<QueryResult[]> {
		const driver = this.cm.getDriver(connectionId, database);
		const inExistingTx = driver.inTransaction();
		if (!inExistingTx) {
			await driver.beginTransaction();
		}
		try {
			const results: QueryResult[] = [];
			for (const stmt of statements) {
				const start = performance.now();
				const result = await driver.execute(stmt.sql, stmt.params);
				results.push({ ...result, durationMs: Math.round(performance.now() - start) });
			}
			if (!inExistingTx) {
				await driver.commit();
			}
			return results;
		} catch (err) {
			if (!inExistingTx) {
				try { await driver.rollback(); } catch { /* don't mask original error */ }
			}
			throw err;
		}
	}

	async cancelQuery(queryId: string): Promise<void> {
		await this.queryExecutor.cancelQuery(queryId);
	}

	// ── Transactions ──────────────────────────────────────

	async beginTransaction(connectionId: string, database?: string): Promise<void> {
		await this.txManager.begin(connectionId, database);
	}

	async commitTransaction(connectionId: string, database?: string): Promise<void> {
		await this.txManager.commit(connectionId, database);
	}

	async rollbackTransaction(connectionId: string, database?: string): Promise<void> {
		await this.txManager.rollback(connectionId, database);
	}

	// ── History ───────────────────────────────────────────

	listHistory(params: HistoryListParams): QueryHistoryEntry[] {
		return this.appDb.listHistory(params);
	}

	clearHistory(connectionId?: string): void {
		this.appDb.clearHistory(connectionId);
	}

	// ── Saved Views ──────────────────────────────────────

	listSavedViews(connectionId: string, schemaName: string, tableName: string): SavedView[] {
		return this.appDb.listSavedViews(connectionId, schemaName, tableName);
	}

	createSavedView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): SavedView {
		return this.appDb.createSavedView(params);
	}

	updateSavedView(params: { id: string; name: string; config: SavedViewConfig }): SavedView {
		return this.appDb.updateSavedView(params);
	}

	deleteSavedView(id: string): void {
		this.appDb.deleteSavedView(id);
	}

	listSavedViewsByConnection(connectionId: string): SavedView[] {
		return this.appDb.listSavedViewsByConnection(connectionId);
	}

	getSavedViewById(id: string): SavedView | null {
		return this.appDb.getSavedViewById(id);
	}

	// ── Export ────────────────────────────────────────────

	async exportData(opts: ExportOptions): Promise<ExportResult> {
		const driver = this.cm.getDriver(opts.connectionId, opts.database);
		const result = await exportToFile(driver, {
			schema: opts.schema,
			table: opts.table,
			format: opts.format,
			columns: opts.columns,
			includeHeaders: opts.includeHeaders,
			delimiter: opts.delimiter,
			encoding: opts.encoding,
			utf8Bom: opts.utf8Bom,
			batchSize: opts.batchSize,
			filters: opts.filters,
			sort: opts.sort,
			limit: opts.limit,
		}, opts.filePath);
		return { ...result, filePath: opts.filePath };
	}

	async exportPreview(req: ExportPreviewRequest): Promise<string> {
		const driver = this.cm.getDriver(req.connectionId, req.database);
		return exportPreview(driver, {
			schema: req.schema,
			table: req.table,
			format: req.format,
			columns: req.columns,
			delimiter: req.delimiter,
			filters: req.filters,
			sort: req.sort,
			limit: req.limit,
		});
	}

	// ── Storage (stateless mode) ─────────────────────────

	isStateless(): boolean {
		return this.stateless;
	}

	async restore(params: RestoreParams): Promise<void> {
		if (!this.stateless || !this.encryption) return;

		// Restore connections
		for (const stored of params.connections) {
			try {
				const configJson = await this.encryption.decrypt(stored.encryptedConfig);
				const config = JSON.parse(configJson);
				this.appDb.db.prepare(
					"INSERT OR REPLACE INTO connections (id, name, type, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
				).run(stored.id, stored.name, config.type, JSON.stringify(config), stored.createdAt, stored.updatedAt);
			} catch {
				// Skip connections that fail to decrypt
			}
		}

		// Restore settings
		for (const [key, value] of Object.entries(params.settings)) {
			this.appDb.setSetting(key, value);
		}

		// Restore history
		for (const entry of params.history) {
			this.appDb.db.prepare(
				"INSERT OR IGNORE INTO query_history (id, connection_id, sql, status, duration_ms, row_count, error_message, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			).run(entry.id, entry.connectionId, entry.sql, entry.status, entry.durationMs ?? null, entry.rowCount ?? null, entry.errorMessage ?? null, entry.executedAt);
		}

		// Restore saved views
		for (const view of params.views) {
			this.appDb.db.prepare(
				"INSERT OR REPLACE INTO saved_views (id, connection_id, schema_name, table_name, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			).run(view.id, view.connectionId, view.schemaName, view.tableName, view.name, JSON.stringify(view.config), view.createdAt, view.updatedAt);
		}
	}

	async encrypt(config: string): Promise<string> {
		if (!this.encryption) throw new Error("Encryption not available");
		return this.encryption.encrypt(config);
	}

	// ── System ────────────────────────────────────────────

	async showOpenDialog({ filters, multiple }: OpenDialogParams): Promise<{ paths: string[]; cancelled: boolean }> {
		if (!this.Utils) throw new Error("Utils not available");
		const allowedFileTypes = filters && filters.length > 0
			? filters.flatMap(f => f.extensions.map(ext => `*.${ext}`)).join(",")
			: "*";

		const result = await this.Utils.openFileDialog({
			startingFolder: "~/",
			allowedFileTypes,
			canChooseFiles: true,
			canChooseDirectory: false,
			allowsMultipleSelection: multiple ?? false,
		});

		const paths = result.filter(p => p !== "");
		return { paths, cancelled: paths.length === 0 };
	}

	async showSaveDialog({ defaultName }: SaveDialogParams): Promise<{ path: string | null; cancelled: boolean }> {
		if (!this.Utils) throw new Error("Utils not available");
		const result = await this.Utils.openFileDialog({
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
	}

	// ── SQL formatting ───────────────────────────────────

	formatSql(sql: string): string {
		return formatSql(sql);
	}
}
