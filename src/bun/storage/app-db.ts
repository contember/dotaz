import Database from "bun:sqlite";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { runMigrations } from "./migrations";
import type { ConnectionConfig, ConnectionInfo } from "../../shared/types/connection";
import type { QueryHistoryEntry, QueryHistoryStatus } from "../../shared/types/query";
import type {
	SavedView,
	SavedViewConfig,
	HistoryListParams,
} from "../../shared/types/rpc";

let instance: AppDatabase | null = null;

export class AppDatabase {
	readonly db: Database;

	private constructor(dbPath: string) {
		this.db = new Database(dbPath, { create: true });
		this.db.run("PRAGMA journal_mode = WAL");
		this.db.run("PRAGMA foreign_keys = ON");
		runMigrations(this.db);
	}

	/**
	 * Get or create the singleton AppDatabase instance.
	 * When called without arguments, uses Utils.paths.userData/dotaz.db.
	 * Pass a custom path for testing.
	 */
	static getInstance(dbPath?: string): AppDatabase {
		if (!instance) {
			const path = dbPath ?? getDefaultDbPath();
			instance = new AppDatabase(path);
		}
		return instance;
	}

	/**
	 * Reset the singleton (for testing only).
	 */
	static resetInstance(): void {
		if (instance) {
			instance.db.close();
			instance = null;
		}
	}

	// ── Connections ──────────────────────────────────────────

	listConnections(): ConnectionInfo[] {
		const rows = this.db.prepare("SELECT * FROM connections ORDER BY name").all() as ConnectionRow[];
		return rows.map(rowToConnectionInfo);
	}

	getConnectionById(id: string): ConnectionInfo | null {
		const row = this.db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as ConnectionRow | null;
		return row ? rowToConnectionInfo(row) : null;
	}

	createConnection(params: { name: string; config: ConnectionConfig }): ConnectionInfo {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		this.db.prepare(
			"INSERT INTO connections (id, name, type, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		).run(id, params.name, params.config.type, JSON.stringify(params.config), now, now);
		return this.getConnectionById(id)!;
	}

	updateConnection(params: { id: string; name: string; config: ConnectionConfig }): ConnectionInfo {
		const now = new Date().toISOString();
		this.db.prepare(
			"UPDATE connections SET name = ?, type = ?, config = ?, updated_at = ? WHERE id = ?",
		).run(params.name, params.config.type, JSON.stringify(params.config), now, params.id);
		const result = this.getConnectionById(params.id);
		if (!result) throw new Error(`Connection not found: ${params.id}`);
		return result;
	}

	deleteConnection(id: string): void {
		this.db.prepare("DELETE FROM connections WHERE id = ?").run(id);
	}

	// ── Settings ─────────────────────────────────────────────

	getSetting(key: string): string | null {
		const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
		return row?.value ?? null;
	}

	setSetting(key: string, value: string): void {
		this.db.prepare(
			"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		).run(key, value);
	}

	// ── Saved Views ──────────────────────────────────────────

	listSavedViews(connectionId: string, schemaName: string, tableName: string): SavedView[] {
		const rows = this.db.prepare(
			"SELECT * FROM saved_views WHERE connection_id = ? AND schema_name = ? AND table_name = ? ORDER BY name",
		).all(connectionId, schemaName, tableName) as SavedViewRow[];
		return rows.map(rowToSavedView);
	}

	createSavedView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): SavedView {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		this.db.prepare(
			"INSERT INTO saved_views (id, connection_id, schema_name, table_name, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		).run(id, params.connectionId, params.schemaName, params.tableName, params.name, JSON.stringify(params.config), now, now);
		return this.getSavedViewById(id)!;
	}

	updateSavedView(params: { id: string; name: string; config: SavedViewConfig }): SavedView {
		const now = new Date().toISOString();
		this.db.prepare(
			"UPDATE saved_views SET name = ?, config = ?, updated_at = ? WHERE id = ?",
		).run(params.name, JSON.stringify(params.config), now, params.id);
		const result = this.getSavedViewById(params.id);
		if (!result) throw new Error(`Saved view not found: ${params.id}`);
		return result;
	}

	deleteSavedView(id: string): void {
		this.db.prepare("DELETE FROM saved_views WHERE id = ?").run(id);
	}

	getSavedViewById(id: string): SavedView | null {
		const row = this.db.prepare("SELECT * FROM saved_views WHERE id = ?").get(id) as SavedViewRow | null;
		return row ? rowToSavedView(row) : null;
	}

	// ── History ───────────────────────────────────────────────

	addHistory(params: {
		connectionId: string;
		sql: string;
		status: QueryHistoryStatus;
		durationMs?: number;
		rowCount?: number;
		errorMessage?: string;
	}): QueryHistoryEntry {
		const result = this.db.prepare(
			"INSERT INTO query_history (connection_id, sql, status, duration_ms, row_count, error_message) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
		).get(
			params.connectionId,
			params.sql,
			params.status,
			params.durationMs ?? null,
			params.rowCount ?? null,
			params.errorMessage ?? null,
		) as HistoryRow;
		return rowToHistoryEntry(result);
	}

	listHistory(params: HistoryListParams): QueryHistoryEntry[] {
		const limit = params.limit ?? 100;
		const offset = params.offset ?? 0;

		const conditions: string[] = [];
		const queryParams: unknown[] = [];

		if (params.connectionId) {
			conditions.push("connection_id = ?");
			queryParams.push(params.connectionId);
		}
		if (params.search) {
			conditions.push("sql LIKE ?");
			queryParams.push(`%${params.search}%`);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const sql = `SELECT * FROM query_history ${where} ORDER BY executed_at DESC LIMIT ? OFFSET ?`;
		queryParams.push(limit, offset);

		const rows = this.db.prepare(sql).all(...queryParams as any[]) as HistoryRow[];
		return rows.map(rowToHistoryEntry);
	}

	clearHistory(connectionId?: string): void {
		if (connectionId) {
			this.db.prepare("DELETE FROM query_history WHERE connection_id = ?").run(connectionId);
		} else {
			this.db.prepare("DELETE FROM query_history").run();
		}
	}
}

// ── Row types (SQLite column names) ──────────────────────────

interface ConnectionRow {
	id: string;
	name: string;
	type: string;
	config: string;
	created_at: string;
	updated_at: string;
}

interface SavedViewRow {
	id: string;
	connection_id: string;
	schema_name: string;
	table_name: string;
	name: string;
	config: string;
	created_at: string;
	updated_at: string;
}

interface HistoryRow {
	id: number;
	connection_id: string;
	sql: string;
	status: string;
	duration_ms: number | null;
	row_count: number | null;
	error_message: string | null;
	executed_at: string;
}

// ── Row-to-domain mappers ────────────────────────────────────

function rowToConnectionInfo(row: ConnectionRow): ConnectionInfo {
	return {
		id: row.id,
		name: row.name,
		config: JSON.parse(row.config) as ConnectionConfig,
		state: "disconnected",
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToSavedView(row: SavedViewRow): SavedView {
	return {
		id: row.id,
		connectionId: row.connection_id,
		schemaName: row.schema_name,
		tableName: row.table_name,
		name: row.name,
		config: JSON.parse(row.config) as SavedViewConfig,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToHistoryEntry(row: HistoryRow): QueryHistoryEntry {
	return {
		id: row.id,
		connectionId: row.connection_id,
		sql: row.sql,
		status: row.status as QueryHistoryStatus,
		durationMs: row.duration_ms ?? undefined,
		rowCount: row.row_count ?? undefined,
		errorMessage: row.error_message ?? undefined,
		executedAt: row.executed_at,
	};
}

// ── Default DB path ──────────────────────────────────────────

function getDefaultDbPath(): string {
	// Lazy import to avoid Electrobun dependency in tests
	const { Utils } = require("electrobun/bun");
	const dir = Utils.paths.userData;
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return join(dir, "dotaz.db");
}
