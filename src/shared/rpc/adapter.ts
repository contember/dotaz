import type { DatabaseDriver } from "../../bun/db/driver";
import type { ConnectionConfig, ConnectionInfo } from "../types/connection";
import type { DatabaseInfo } from "../types/database";
import type { QueryResult, QueryHistoryEntry } from "../types/query";
import type { ExportOptions, ExportPreviewRequest, ExportResult } from "../types/export";
import type {
	SavedView,
	SavedViewConfig,
	HistoryListParams,
	OpenDialogParams,
	SaveDialogParams,
} from "../types/rpc";

export interface RpcAdapter {
	// ── Connections ────────────────────────────────────────
	listConnections(): ConnectionInfo[];
	createConnection(params: { name: string; config: ConnectionConfig }): ConnectionInfo;
	updateConnection(params: { id: string; name: string; config: ConnectionConfig }): ConnectionInfo;
	deleteConnection(id: string): void | Promise<void>;
	testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string }>;
	connect(connectionId: string, password?: string, encryptedConfig?: string, name?: string): Promise<void>;
	disconnect(connectionId: string): Promise<void>;

	// ── Driver access ─────────────────────────────────────
	getDriver(connectionId: string, database?: string): DatabaseDriver;

	// ── Multi-database ────────────────────────────────────
	listDatabases(connectionId: string): Promise<DatabaseInfo[]>;
	activateDatabase(connectionId: string, database: string): Promise<void>;
	deactivateDatabase(connectionId: string, database: string): Promise<void>;

	// ── Query execution ───────────────────────────────────
	executeQuery(connectionId: string, sql: string, params?: unknown[], queryId?: string, database?: string): Promise<QueryResult[]>;
	/** Execute a batch of parameterized statements sequentially, auto-wrapped in transaction. */
	executeStatements(connectionId: string, statements: { sql: string; params?: unknown[] }[], database?: string): Promise<QueryResult[]>;
	cancelQuery(queryId: string): Promise<void>;

	// ── Transactions ──────────────────────────────────────
	beginTransaction(connectionId: string, database?: string): Promise<void>;
	commitTransaction(connectionId: string, database?: string): Promise<void>;
	rollbackTransaction(connectionId: string, database?: string): Promise<void>;

	// ── History ───────────────────────────────────────────
	listHistory(params: HistoryListParams): QueryHistoryEntry[];
	clearHistory(connectionId?: string): void;

	// ── Saved Views ──────────────────────────────────────
	listSavedViews(connectionId: string, schemaName: string, tableName: string): SavedView[];
	createSavedView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): SavedView;
	updateSavedView(params: { id: string; name: string; config: SavedViewConfig }): SavedView;
	deleteSavedView(id: string): void;
	listSavedViewsByConnection(connectionId: string): SavedView[];
	getSavedViewById(id: string): SavedView | null;

	// ── Export ────────────────────────────────────────────
	exportData(opts: ExportOptions): Promise<ExportResult>;
	exportPreview(req: ExportPreviewRequest): Promise<string>;

	// ── Storage ──────────────────────────────────────────
	encrypt?(config: string): Promise<string>;

	// ── System (optional — unavailable in demo/web) ──────
	showOpenDialog?(params: OpenDialogParams): Promise<{ paths: string[]; cancelled: boolean }>;
	showSaveDialog?(params: SaveDialogParams): Promise<{ path: string | null; cancelled: boolean }>;

	// ── SQL formatting ───────────────────────────────────
	formatSql(sql: string): string;
}
