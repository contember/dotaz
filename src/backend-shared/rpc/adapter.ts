import type { DatabaseDriver } from "../db/driver";
import type { ConnectionConfig, ConnectionInfo } from "../../shared/types/connection";
import type { DatabaseInfo } from "../../shared/types/database";
import type { QueryResult, QueryHistoryEntry, ExplainResult } from "../../shared/types/query";
import type { ExportOptions, ExportPreviewRequest, ExportResult } from "../../shared/types/export";
import type { ImportOptions, ImportPreviewRequest, ImportPreviewResult, ImportResult } from "../../shared/types/import";
import type {
	SavedView,
	SavedViewConfig,
	HistoryListParams,
	QueryBookmark,
	OpenDialogParams,
	SaveDialogParams,
	SearchDatabaseParams,
	SearchDatabaseResult,
} from "../../shared/types/rpc";

export interface RpcAdapter {
	// ── Connections ────────────────────────────────────────
	listConnections(): ConnectionInfo[];
	createConnection(params: { name: string; config: ConnectionConfig; readOnly?: boolean; color?: string }): ConnectionInfo;
	updateConnection(params: { id: string; name: string; config: ConnectionConfig; readOnly?: boolean; color?: string }): ConnectionInfo;
	setConnectionReadOnly(id: string, readOnly: boolean): ConnectionInfo;
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
	explainQuery(connectionId: string, sql: string, analyze: boolean, database?: string): Promise<ExplainResult>;

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

	// ── Bookmarks ────────────────────────────────────────
	listBookmarks(connectionId: string, search?: string): QueryBookmark[];
	createBookmark(params: { connectionId: string; name: string; description?: string; sql: string }): QueryBookmark;
	updateBookmark(params: { id: string; name: string; description?: string; sql: string }): QueryBookmark;
	deleteBookmark(id: string): void;

	// ── Search ────────────────────────────────────────────
	searchDatabase(params: SearchDatabaseParams): Promise<SearchDatabaseResult>;

	// ── Export ────────────────────────────────────────────
	exportData(opts: ExportOptions): Promise<ExportResult>;
	exportPreview(req: ExportPreviewRequest): Promise<string>;

	// ── Import ────────────────────────────────────────────
	importData(opts: ImportOptions): Promise<ImportResult>;
	importPreview(req: ImportPreviewRequest): Promise<ImportPreviewResult>;

	// ── Storage ──────────────────────────────────────────
	encrypt?(config: string): Promise<string>;

	// ── System (optional — unavailable in demo/web) ──────
	showOpenDialog?(params: OpenDialogParams): Promise<{ paths: string[]; cancelled: boolean }>;
	showSaveDialog?(params: SaveDialogParams): Promise<{ path: string | null; cancelled: boolean }>;

	// ── SQL formatting ───────────────────────────────────
	formatSql(sql: string): string;
}
