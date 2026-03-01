import type { RpcAdapter } from "../shared/rpc/adapter";
import type { WasmSqliteDriver } from "./wasm-sqlite-driver";
import type { DemoAppState } from "./demo-state";
import type { DatabaseDriver } from "../bun/db/driver";
import type { ConnectionConfig, ConnectionInfo } from "../shared/types/connection";
import type { DatabaseInfo } from "../shared/types/database";
import type { QueryResult, QueryHistoryEntry, QueryHistoryStatus } from "../shared/types/query";
import type { ExportOptions, ExportPreviewRequest, ExportResult } from "../shared/types/export";
import type {
	SavedView,
	SavedViewConfig,
	HistoryListParams,
} from "../shared/types/rpc";
import { splitStatements } from "../shared/sql/statements";
import { exportPreview as generateExportPreview } from "../bun/services/export-service";
import { formatSql } from "../bun/services/sql-formatter";

type EmitMessage = (channel: string, payload: any) => void;

export class DemoAdapter implements RpcAdapter {
	private connectedSet = new Set<string>();

	constructor(
		private driver: WasmSqliteDriver,
		private state: DemoAppState,
		private emitMessage: EmitMessage,
	) {}

	private getConnectedDriver(connectionId: string): WasmSqliteDriver {
		if (!this.connectedSet.has(connectionId)) {
			throw new Error(`Connection ${connectionId} is not connected`);
		}
		return this.driver;
	}

	getDriver(connectionId: string, _database?: string): DatabaseDriver {
		return this.getConnectedDriver(connectionId);
	}

	// ── Connections ────────────────────────────────────────

	listConnections(): ConnectionInfo[] {
		return this.state.listConnections();
	}

	createConnection(params: { name: string; config: ConnectionConfig }): ConnectionInfo {
		return this.state.createConnection(params);
	}

	updateConnection(params: { id: string; name: string; config: ConnectionConfig }): ConnectionInfo {
		return this.state.updateConnection(params);
	}

	deleteConnection(id: string): void {
		this.state.deleteConnection(id);
		this.connectedSet.delete(id);
	}

	async testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string }> {
		if (config.type === "sqlite") {
			return { success: true };
		}
		return { success: false, error: "Only SQLite connections are supported in demo mode" };
	}

	async connect(connectionId: string, _password?: string, _encryptedConfig?: string, _name?: string): Promise<void> {
		const conn = this.state.getConnectionById(connectionId);
		if (!conn) throw new Error(`Connection not found: ${connectionId}`);

		this.emitMessage("connections.statusChanged", {
			connectionId,
			state: "connecting",
		});

		this.connectedSet.add(connectionId);

		this.emitMessage("connections.statusChanged", {
			connectionId,
			state: "connected",
		});
	}

	async disconnect(connectionId: string): Promise<void> {
		this.connectedSet.delete(connectionId);
		this.emitMessage("connections.statusChanged", {
			connectionId,
			state: "disconnected",
		});
	}

	// ── Driver access (RpcAdapter interface) ─────────────

	// ── Multi-database (not available in demo) ────────────

	async listDatabases(): Promise<DatabaseInfo[]> {
		return [];
	}

	async activateDatabase(): Promise<void> {
		throw new Error("Multi-database is not available in demo mode");
	}

	async deactivateDatabase(): Promise<void> {
		throw new Error("Multi-database is not available in demo mode");
	}

	// ── Query execution ───────────────────────────────────

	async executeQuery(connectionId: string, sql: string, params?: unknown[]): Promise<QueryResult[]> {
		const d = this.getConnectedDriver(connectionId);
		const statements = splitStatements(sql);

		if (statements.length === 0) {
			return [];
		}

		const results: QueryResult[] = [];

		for (const stmt of statements) {
			const start = performance.now();
			try {
				const result = await d.execute(
					stmt,
					statements.length === 1 ? params : undefined,
				);
				results.push({
					...result,
					durationMs: Math.round(performance.now() - start),
				});
			} catch (err) {
				results.push({
					columns: [],
					rows: [],
					rowCount: 0,
					durationMs: Math.round(performance.now() - start),
					error: err instanceof Error ? err.message : String(err),
				});
				break;
			}
		}

		this.logHistory(connectionId, sql, results);
		return results;
	}

	async executeStatements(connectionId: string, statements: { sql: string; params?: unknown[] }[]): Promise<QueryResult[]> {
		const d = this.getConnectedDriver(connectionId);
		const inExistingTx = d.inTransaction();
		if (!inExistingTx) {
			await d.beginTransaction();
		}
		try {
			const results: QueryResult[] = [];
			for (const stmt of statements) {
				const start = performance.now();
				const result = await d.execute(stmt.sql, stmt.params);
				results.push({ ...result, durationMs: Math.round(performance.now() - start) });
			}
			if (!inExistingTx) {
				await d.commit();
			}
			return results;
		} catch (err) {
			if (!inExistingTx) {
				try { await d.rollback(); } catch { /* don't mask original error */ }
			}
			throw err;
		}
	}

	async cancelQuery(): Promise<void> {
		// WASM SQLite operations are synchronous; cancellation is a no-op
	}

	// ── Transactions ──────────────────────────────────────

	async beginTransaction(connectionId: string): Promise<void> {
		const d = this.getConnectedDriver(connectionId);
		if (d.inTransaction()) {
			throw new Error("Transaction already active");
		}
		await d.beginTransaction();
	}

	async commitTransaction(connectionId: string): Promise<void> {
		const d = this.getConnectedDriver(connectionId);
		if (!d.inTransaction()) {
			throw new Error("No active transaction");
		}
		await d.commit();
	}

	async rollbackTransaction(connectionId: string): Promise<void> {
		const d = this.getConnectedDriver(connectionId);
		if (!d.inTransaction()) {
			throw new Error("No active transaction");
		}
		await d.rollback();
	}

	// ── History ───────────────────────────────────────────

	listHistory(params: HistoryListParams): QueryHistoryEntry[] {
		return this.state.listHistory(params);
	}

	clearHistory(connectionId?: string): void {
		this.state.clearHistory(connectionId);
	}

	// ── Saved Views ──────────────────────────────────────

	listSavedViews(connectionId: string, schemaName: string, tableName: string): SavedView[] {
		return this.state.listSavedViews(connectionId, schemaName, tableName);
	}

	createSavedView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): SavedView {
		return this.state.createSavedView(params);
	}

	updateSavedView(params: { id: string; name: string; config: SavedViewConfig }): SavedView {
		return this.state.updateSavedView(params);
	}

	deleteSavedView(id: string): void {
		this.state.deleteSavedView(id);
	}

	listSavedViewsByConnection(connectionId: string): SavedView[] {
		return this.state.listSavedViewsByConnection(connectionId);
	}

	getSavedViewById(id: string): SavedView | null {
		return this.state.getSavedViewById(id);
	}

	// ── Export ────────────────────────────────────────────

	async exportData(opts: ExportOptions): Promise<ExportResult> {
		const d = this.getConnectedDriver(opts.connectionId);
		const content = await generateExportPreview(d, {
			schema: opts.schema,
			table: opts.table,
			format: opts.format,
			columns: opts.columns,
			delimiter: opts.delimiter,
			filters: opts.filters,
			sort: opts.sort,
			limit: opts.limit,
		});

		// Trigger browser download
		const mimeTypes: Record<string, string> = {
			csv: "text/csv",
			json: "application/json",
			sql: "text/sql",
		};
		const blob = new Blob([content], { type: mimeTypes[opts.format] ?? "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = opts.filePath || `export.${opts.format}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		const encoder = new TextEncoder();
		return {
			rowCount: content.split("\n").length,
			filePath: opts.filePath,
			sizeBytes: encoder.encode(content).length,
		};
	}

	async exportPreview(req: ExportPreviewRequest): Promise<string> {
		const d = this.getConnectedDriver(req.connectionId);
		return generateExportPreview(d, {
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

	// ── SQL formatting ───────────────────────────────────

	formatSql(sql: string): string {
		return formatSql(sql);
	}

	// ── Private ──────────────────────────────────────────

	private logHistory(connectionId: string, sql: string, results: QueryResult[]): void {
		const hasError = results.some((r) => r.error);
		const totalDuration = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
		const totalRows = results.reduce((sum, r) => sum + (r.affectedRows ?? r.rowCount), 0);
		const errorMessage = results.find((r) => r.error)?.error;

		try {
			this.state.addHistory({
				connectionId,
				sql,
				status: (hasError ? "error" : "success") as QueryHistoryStatus,
				durationMs: Math.round(totalDuration),
				rowCount: totalRows,
				errorMessage,
			});
		} catch {
			// Don't let history logging break query execution
		}
	}
}
