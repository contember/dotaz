import type { AppStateStorage } from "../app-state-storage";
import type { ConnectionConfig, ConnectionInfo } from "../../../shared/types/connection";
import type { QueryHistoryEntry } from "../../../shared/types/query";
import type { SavedView, SavedViewConfig, HistoryListParams } from "../../../shared/types/rpc";
import { isServerConfig } from "../../../shared/types/connection";
import { rpc } from "../rpc";

// ── IndexedDB helpers ────────────────────────────────────

const DB_NAME = "dotaz";
const DB_VERSION = 1;

const STORES = {
	connections: "connections",
	history: "history",
	views: "views",
} as const;

interface StoredConnectionRecord {
	id: string;
	name: string;
	config: ConnectionConfig;     // display config — password stripped
	encryptedConfig: string;      // full config encrypted by server
	rememberPassword: boolean;
	createdAt: string;
	updatedAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORES.connections)) {
				db.createObjectStore(STORES.connections, { keyPath: "id" });
			}
			if (!db.objectStoreNames.contains(STORES.history)) {
				const store = db.createObjectStore(STORES.history, { keyPath: "id", autoIncrement: true });
				store.createIndex("connectionId", "connectionId", { unique: false });
				store.createIndex("executedAt", "executedAt", { unique: false });
			}
			if (!db.objectStoreNames.contains(STORES.views)) {
				const store = db.createObjectStore(STORES.views, { keyPath: "id" });
				store.createIndex("connectionId", "connectionId", { unique: false });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

	return dbPromise;
}

function txOp<T>(storeName: string, mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDb().then((db) => {
		return new Promise<T>((resolve, reject) => {
			const tx = db.transaction(storeName, mode);
			const store = tx.objectStore(storeName);
			const request = op(store);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	});
}

function stripPassword(config: ConnectionConfig): ConnectionConfig {
	if (isServerConfig(config)) {
		return { ...config, password: "" };
	}
	return config;
}

// ── IndexedDbAppStateStorage ─────────────────────────────

export class IndexedDbAppStateStorage implements AppStateStorage {
	readonly passConfigOnConnect = true;

	// ── Connections ──────────────────────────────────────

	async listConnections(): Promise<ConnectionInfo[]> {
		const records = await txOp<StoredConnectionRecord[]>(STORES.connections, "readonly", (s) => s.getAll());
		return records.map((r) => ({
			id: r.id,
			name: r.name,
			config: r.config,
			state: "disconnected" as const,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}));
	}

	async createConnection(name: string, config: ConnectionConfig, rememberPassword = true): Promise<ConnectionInfo> {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		const configToEncrypt = !rememberPassword && isServerConfig(config)
			? { ...config, password: "" }
			: config;
		const { encryptedConfig } = await rpc.storage.encrypt({ config: JSON.stringify(configToEncrypt) });

		const record: StoredConnectionRecord = {
			id,
			name,
			config: stripPassword(config),
			encryptedConfig,
			rememberPassword,
			createdAt: now,
			updatedAt: now,
		};

		await txOp(STORES.connections, "readwrite", (s) => s.put(record));

		return {
			id,
			name,
			config: record.config,
			state: "disconnected",
			createdAt: now,
			updatedAt: now,
		};
	}

	async updateConnection(id: string, name: string, config: ConnectionConfig, rememberPassword?: boolean): Promise<ConnectionInfo> {
		const existing = await txOp<StoredConnectionRecord | undefined>(STORES.connections, "readonly", (s) => s.get(id));
		if (!existing) throw new Error(`Connection not found: ${id}`);

		const remember = rememberPassword ?? existing.rememberPassword;
		const now = new Date().toISOString();

		const configToEncrypt = !remember && isServerConfig(config)
			? { ...config, password: "" }
			: config;
		const { encryptedConfig } = await rpc.storage.encrypt({ config: JSON.stringify(configToEncrypt) });

		const record: StoredConnectionRecord = {
			id,
			name,
			config: stripPassword(config),
			encryptedConfig,
			rememberPassword: remember,
			createdAt: existing.createdAt,
			updatedAt: now,
		};

		await txOp(STORES.connections, "readwrite", (s) => s.put(record));

		return {
			id,
			name,
			config: record.config,
			state: "disconnected",
			createdAt: record.createdAt,
			updatedAt: now,
		};
	}

	async deleteConnection(id: string): Promise<void> {
		await txOp(STORES.connections, "readwrite", (s) => s.delete(id));
		// Cascade delete history and views for this connection
		await this.clearHistory(id);
		await this.deleteViewsByConnection(id);
	}

	// ── History ──────────────────────────────────────────

	async listHistory(params: HistoryListParams): Promise<QueryHistoryEntry[]> {
		const all = await txOp<any[]>(STORES.history, "readonly", (s) => s.getAll());
		let entries = all as QueryHistoryEntry[];

		// Filter
		if (params.connectionId) {
			entries = entries.filter((e) => e.connectionId === params.connectionId);
		}
		if (params.search) {
			const search = params.search.toLowerCase();
			entries = entries.filter((e) => e.sql.toLowerCase().includes(search));
		}

		// Sort by executedAt descending
		entries.sort((a, b) => b.executedAt.localeCompare(a.executedAt));

		// Paginate
		const offset = params.offset ?? 0;
		const limit = params.limit ?? 100;
		return entries.slice(offset, offset + limit);
	}

	async addHistoryEntry(entry: Omit<QueryHistoryEntry, "id">): Promise<void> {
		await txOp(STORES.history, "readwrite", (s) => s.add(entry));
	}

	async clearHistory(connectionId?: string): Promise<void> {
		if (!connectionId) {
			await txOp(STORES.history, "readwrite", (s) => s.clear());
			return;
		}
		const db = await openDb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORES.history, "readwrite");
			const store = tx.objectStore(STORES.history);
			const request = store.openCursor();
			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor) {
					const entry = cursor.value as QueryHistoryEntry;
					if (entry.connectionId === connectionId) {
						cursor.delete();
					}
					cursor.continue();
				}
			};
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	// ── Saved Views ──────────────────────────────────────

	async listViewsByConnection(connectionId: string): Promise<SavedView[]> {
		const all = await txOp<SavedView[]>(STORES.views, "readonly", (s) => s.getAll());
		return all.filter((v) => v.connectionId === connectionId);
	}

	async saveView(params: { connectionId: string; schemaName: string; tableName: string; name: string; config: SavedViewConfig }): Promise<SavedView> {
		if (!params.name || !params.name.trim()) {
			throw new Error("View name is required");
		}
		// Check name uniqueness within the table
		const existing = await this.listViewsByConnection(params.connectionId);
		const sameTable = existing.filter((v) => v.schemaName === params.schemaName && v.tableName === params.tableName);
		if (sameTable.some((v) => v.name === params.name.trim())) {
			throw new Error(`A view named "${params.name.trim()}" already exists for this table`);
		}

		const now = new Date().toISOString();
		const view: SavedView = {
			id: crypto.randomUUID(),
			connectionId: params.connectionId,
			schemaName: params.schemaName,
			tableName: params.tableName,
			name: params.name.trim(),
			config: params.config,
			createdAt: now,
			updatedAt: now,
		};

		await txOp(STORES.views, "readwrite", (s) => s.put(view));
		return view;
	}

	async updateView(params: { id: string; name: string; config: SavedViewConfig }): Promise<SavedView> {
		if (!params.name || !params.name.trim()) {
			throw new Error("View name is required");
		}
		const current = await txOp<SavedView | undefined>(STORES.views, "readonly", (s) => s.get(params.id));
		if (!current) throw new Error(`Saved view not found: ${params.id}`);

		// Check name uniqueness (excluding this view)
		const existing = await this.listViewsByConnection(current.connectionId);
		const sameTable = existing.filter((v) => v.schemaName === current.schemaName && v.tableName === current.tableName);
		if (sameTable.some((v) => v.id !== params.id && v.name === params.name.trim())) {
			throw new Error(`A view named "${params.name.trim()}" already exists for this table`);
		}

		const now = new Date().toISOString();
		const updated: SavedView = {
			...current,
			name: params.name.trim(),
			config: params.config,
			updatedAt: now,
		};

		await txOp(STORES.views, "readwrite", (s) => s.put(updated));
		return updated;
	}

	async deleteView(id: string): Promise<void> {
		await txOp(STORES.views, "readwrite", (s) => s.delete(id));
	}

	// ── Config access ────────────────────────────────────

	async getEncryptedConfig(id: string): Promise<string | undefined> {
		const record = await txOp<StoredConnectionRecord | undefined>(STORES.connections, "readonly", (s) => s.get(id));
		return record?.encryptedConfig;
	}

	async getRememberPassword(id: string): Promise<boolean> {
		const record = await txOp<StoredConnectionRecord | undefined>(STORES.connections, "readonly", (s) => s.get(id));
		return record?.rememberPassword ?? true;
	}

	// ── Private helpers ──────────────────────────────────

	private async deleteViewsByConnection(connectionId: string): Promise<void> {
		const db = await openDb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORES.views, "readwrite");
			const store = tx.objectStore(STORES.views);
			const request = store.openCursor();
			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor) {
					const view = cursor.value as SavedView;
					if (view.connectionId === connectionId) {
						cursor.delete();
					}
					cursor.continue();
				}
			};
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}
}

