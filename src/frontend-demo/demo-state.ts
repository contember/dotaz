import type { ConnectionConfig, ConnectionInfo } from "../shared/types/connection";
import type { QueryHistoryEntry, QueryHistoryStatus } from "../shared/types/query";
import type {
	SavedView,
	SavedViewConfig,
	HistoryListParams,
} from "../shared/types/rpc";

const DEMO_CONNECTION_ID = "demo-bookstore";

/**
 * In-memory app state for demo mode.
 * Replaces AppDatabase — uses plain Maps and arrays.
 * Everything resets on page reload.
 */
export class DemoAppState {
	private connections = new Map<string, ConnectionInfo>();
	private settings = new Map<string, string>();
	private views = new Map<string, SavedView>();
	private history: QueryHistoryEntry[] = [];
	private historyIdCounter = 0;

	constructor() {
		// Pre-populate with demo connection
		const now = new Date().toISOString();
		this.connections.set(DEMO_CONNECTION_ID, {
			id: DEMO_CONNECTION_ID,
			name: "Bookstore (Demo)",
			config: { type: "sqlite", path: ":memory:" } as ConnectionConfig,
			state: "disconnected",
			createdAt: now,
			updatedAt: now,
		});
	}

	// ── Connections ──────────────────────────────────────────

	listConnections(): ConnectionInfo[] {
		return Array.from(this.connections.values()).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	}

	getConnectionById(id: string): ConnectionInfo | null {
		return this.connections.get(id) ?? null;
	}

	createConnection(params: { name: string; config: ConnectionConfig }): ConnectionInfo {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const conn: ConnectionInfo = {
			id,
			name: params.name,
			config: params.config,
			state: "disconnected",
			createdAt: now,
			updatedAt: now,
		};
		this.connections.set(id, conn);
		return conn;
	}

	updateConnection(params: { id: string; name: string; config: ConnectionConfig }): ConnectionInfo {
		const existing = this.connections.get(params.id);
		if (!existing) throw new Error(`Connection not found: ${params.id}`);
		const now = new Date().toISOString();
		const updated: ConnectionInfo = {
			...existing,
			name: params.name,
			config: params.config,
			updatedAt: now,
		};
		this.connections.set(params.id, updated);
		return updated;
	}

	deleteConnection(id: string): void {
		this.connections.delete(id);
	}

	// ── Settings ─────────────────────────────────────────────

	getSetting(key: string): string | null {
		return this.settings.get(key) ?? null;
	}

	setSetting(key: string, value: string): void {
		this.settings.set(key, value);
	}

	getAllSettings(): Record<string, string> {
		const result: Record<string, string> = {};
		for (const [key, value] of this.settings) {
			result[key] = value;
		}
		return result;
	}

	// ── Saved Views ──────────────────────────────────────────

	listSavedViews(connectionId: string, schemaName: string, tableName: string): SavedView[] {
		return Array.from(this.views.values())
			.filter(
				(v) =>
					v.connectionId === connectionId &&
					v.schemaName === schemaName &&
					v.tableName === tableName,
			)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	createSavedView(params: {
		connectionId: string;
		schemaName: string;
		tableName: string;
		name: string;
		config: SavedViewConfig;
	}): SavedView {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const view: SavedView = {
			id,
			connectionId: params.connectionId,
			schemaName: params.schemaName,
			tableName: params.tableName,
			name: params.name,
			config: params.config,
			createdAt: now,
			updatedAt: now,
		};
		this.views.set(id, view);
		return view;
	}

	updateSavedView(params: { id: string; name: string; config: SavedViewConfig }): SavedView {
		const existing = this.views.get(params.id);
		if (!existing) throw new Error(`Saved view not found: ${params.id}`);
		const now = new Date().toISOString();
		const updated: SavedView = {
			...existing,
			name: params.name,
			config: params.config,
			updatedAt: now,
		};
		this.views.set(params.id, updated);
		return updated;
	}

	deleteSavedView(id: string): void {
		this.views.delete(id);
	}

	listSavedViewsByConnection(connectionId: string): SavedView[] {
		return Array.from(this.views.values())
			.filter((v) => v.connectionId === connectionId)
			.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.name.localeCompare(b.name));
	}

	getSavedViewById(id: string): SavedView | null {
		return this.views.get(id) ?? null;
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
		this.historyIdCounter++;
		const entry: QueryHistoryEntry = {
			id: this.historyIdCounter,
			connectionId: params.connectionId,
			sql: params.sql,
			status: params.status,
			durationMs: params.durationMs,
			rowCount: params.rowCount,
			errorMessage: params.errorMessage,
			executedAt: new Date().toISOString(),
		};
		this.history.unshift(entry);
		// Keep max 1000 entries
		if (this.history.length > 1000) {
			this.history.length = 1000;
		}
		return entry;
	}

	listHistory(params: HistoryListParams): QueryHistoryEntry[] {
		let filtered = this.history;

		if (params.connectionId) {
			filtered = filtered.filter((h) => h.connectionId === params.connectionId);
		}
		if (params.search) {
			const search = params.search.toLowerCase();
			filtered = filtered.filter((h) => h.sql.toLowerCase().includes(search));
		}

		const offset = params.offset ?? 0;
		const limit = params.limit ?? 100;
		return filtered.slice(offset, offset + limit);
	}

	clearHistory(connectionId?: string): void {
		if (connectionId) {
			this.history = this.history.filter((h) => h.connectionId !== connectionId);
		} else {
			this.history = [];
		}
	}
}
