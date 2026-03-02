import type { RpcAdapter } from "./adapter";
import type { ConnectionManager } from "../services/connection-manager";
import type { QueryExecutor } from "../services/query-executor";
import type { AppDatabase } from "../storage/app-db";
import type { EncryptionService } from "../services/encryption";
import type { ConnectionConfig, ConnectionInfo } from "../../shared/types/connection";
import type { DatabaseInfo } from "../../shared/types/database";
import type { QueryResult, QueryHistoryEntry, ExplainResult } from "../../shared/types/query";
import type { ExportOptions, ExportPreviewRequest, ExportResult } from "../../shared/types/export";
import type { ImportOptions, ImportPreviewRequest, ImportPreviewResult, ImportResult } from "../../shared/types/import";
import type {
	SavedView,
	SavedViewConfig,
	HistoryListParams,
	OpenDialogParams,
	SaveDialogParams,
} from "../../shared/types/rpc";
import type { DatabaseDriver } from "../db/driver";
import { TransactionManager } from "../services/transaction-manager";
import { exportToFile, exportPreview } from "../services/export-service";
import { parseImportPreview, importData as importDataService } from "../services/import-service";
import { formatSql } from "../services/sql-formatter";


export interface BackendAdapterOptions {
	encryption?: EncryptionService;
	Utils?: typeof import("electrobun/bun").Utils;
}

export class BackendAdapter implements RpcAdapter {
	private txManager: TransactionManager;
	private encryption?: EncryptionService;
	private Utils?: typeof import("electrobun/bun").Utils;

	constructor(
		private cm: ConnectionManager,
		private queryExecutor: QueryExecutor,
		private appDb: AppDatabase,
		opts?: BackendAdapterOptions,
	) {
		this.txManager = new TransactionManager(cm);
		this.encryption = opts?.encryption;
		this.Utils = opts?.Utils;
	}

	// ── Connections ────────────────────────────────────────

	listConnections(): ConnectionInfo[] {
		return this.cm.listConnections();
	}

	createConnection(params: { name: string; config: ConnectionConfig; readOnly?: boolean }): ConnectionInfo {
		return this.cm.createConnection(params);
	}

	updateConnection(params: { id: string; name: string; config: ConnectionConfig; readOnly?: boolean }): ConnectionInfo {
		return this.cm.updateConnection(params);
	}

	setConnectionReadOnly(id: string, readOnly: boolean): ConnectionInfo {
		return this.cm.setConnectionReadOnly(id, readOnly);
	}

	async deleteConnection(id: string): Promise<void> {
		await this.cm.deleteConnection(id);
	}

	async testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string }> {
		return this.cm.testConnection(config);
	}

	async connect(connectionId: string, password?: string, encryptedConfig?: string, name?: string): Promise<void> {
		if (encryptedConfig && this.encryption) {
			// Web mode: decrypt config, register in session's in-memory app-db
			const configJson = await this.encryption.decrypt(encryptedConfig);
			const config = JSON.parse(configJson) as ConnectionConfig;
			const existing = this.appDb.getConnectionById(connectionId);
			if (!existing) {
				this.appDb.createConnectionWithId(connectionId, { name: name ?? connectionId, config });
			} else {
				this.appDb.updateConnection({ id: connectionId, name: name ?? existing.name, config });
			}
		}
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
				try { await driver.rollback(); } catch (rbErr) { console.debug("Rollback after error failed:", rbErr instanceof Error ? rbErr.message : rbErr); }
			}
			throw err;
		}
	}

	async cancelQuery(queryId: string): Promise<void> {
		await this.queryExecutor.cancelQuery(queryId);
	}

	async explainQuery(connectionId: string, sql: string, analyze: boolean, database?: string): Promise<ExplainResult> {
		return this.queryExecutor.explainQuery(connectionId, sql, analyze, database);
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

	// ── Bookmarks ────────────────────────────────────────

	listBookmarks(connectionId: string, search?: string) {
		return this.appDb.listBookmarks(connectionId, search);
	}

	createBookmark(params: { connectionId: string; name: string; description?: string; sql: string }) {
		return this.appDb.createBookmark(params);
	}

	updateBookmark(params: { id: string; name: string; description?: string; sql: string }) {
		return this.appDb.updateBookmark(params);
	}

	deleteBookmark(id: string) {
		this.appDb.deleteBookmark(id);
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

	// ── Import ────────────────────────────────────────────

	async importData(opts: ImportOptions): Promise<ImportResult> {
		const driver = this.cm.getDriver(opts.connectionId, opts.database);
		return importDataService(driver, {
			schema: opts.schema,
			table: opts.table,
			fileContent: opts.fileContent,
			format: opts.format,
			delimiter: opts.delimiter,
			hasHeader: opts.hasHeader,
			mappings: opts.mappings,
			batchSize: opts.batchSize,
		});
	}

	async importPreview(req: ImportPreviewRequest): Promise<ImportPreviewResult> {
		return parseImportPreview({
			fileContent: req.fileContent,
			format: req.format,
			delimiter: req.delimiter,
			hasHeader: req.hasHeader,
		}, req.limit);
	}

	// ── Storage ──────────────────────────────────────────

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
