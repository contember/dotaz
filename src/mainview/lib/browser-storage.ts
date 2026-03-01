import type { QueryHistoryEntry } from "../../shared/types/query";
import type { SavedView, StoredConnection } from "../../shared/types/rpc";

export type { StoredConnection };

const DB_NAME = "dotaz_stateless";
const DB_VERSION = 1;

const STORES = {
	connections: "connections",
	settings: "settings",
	history: "history",
	views: "views",
} as const;

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
			if (!db.objectStoreNames.contains(STORES.settings)) {
				db.createObjectStore(STORES.settings, { keyPath: "key" });
			}
			if (!db.objectStoreNames.contains(STORES.history)) {
				db.createObjectStore(STORES.history, { keyPath: "id" });
			}
			if (!db.objectStoreNames.contains(STORES.views)) {
				db.createObjectStore(STORES.views, { keyPath: "id" });
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

// ── Connections ──────────────────────────────────────────

export async function getStoredConnections(): Promise<StoredConnection[]> {
	return txOp<StoredConnection[]>(STORES.connections, "readonly", (s) => s.getAll());
}

export async function putStoredConnection(conn: StoredConnection): Promise<void> {
	await txOp(STORES.connections, "readwrite", (s) => s.put(conn));
}

export async function deleteStoredConnection(id: string): Promise<void> {
	await txOp(STORES.connections, "readwrite", (s) => s.delete(id));
}

// ── Settings ─────────────────────────────────────────────

export async function getAllSettings(): Promise<Record<string, string>> {
	const rows = await txOp<{ key: string; value: string }[]>(STORES.settings, "readonly", (s) => s.getAll());
	const result: Record<string, string> = {};
	for (const row of rows) {
		result[row.key] = row.value;
	}
	return result;
}

export async function putSetting(key: string, value: string): Promise<void> {
	await txOp(STORES.settings, "readwrite", (s) => s.put({ key, value }));
}

// ── History ──────────────────────────────────────────────

export async function getStoredHistory(): Promise<QueryHistoryEntry[]> {
	return txOp<QueryHistoryEntry[]>(STORES.history, "readonly", (s) => s.getAll());
}

export async function putHistoryEntry(entry: QueryHistoryEntry): Promise<void> {
	await txOp(STORES.history, "readwrite", (s) => s.put(entry));
}

export async function clearStoredHistory(connectionId?: string): Promise<void> {
	if (!connectionId) {
		await txOp(STORES.history, "readwrite", (s) => s.clear());
		return;
	}
	// Delete by connectionId — need to iterate since we have no index
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

// ── Views ────────────────────────────────────────────────

export async function getStoredViews(): Promise<SavedView[]> {
	return txOp<SavedView[]>(STORES.views, "readonly", (s) => s.getAll());
}

export async function putStoredView(view: SavedView): Promise<void> {
	await txOp(STORES.views, "readwrite", (s) => s.put(view));
}

export async function deleteStoredView(id: string): Promise<void> {
	await txOp(STORES.views, "readwrite", (s) => s.delete(id));
}

export async function clearStoredViewsByConnection(connectionId: string): Promise<void> {
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
