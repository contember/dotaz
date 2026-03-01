import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type {
	ConnectionConfig,
	ConnectionInfo,
	ConnectionState,
} from "../../shared/types/connection";
import type { DatabaseInfo, SchemaInfo, TableInfo } from "../../shared/types/database";
import { rpc, messages, friendlyErrorMessage } from "../lib/rpc";
import { isStateless } from "../lib/mode";
import {
	getStoredConnections,
	putStoredConnection,
	deleteStoredConnection,
	getAllSettings,
	getStoredHistory,
	getStoredViews,
	clearStoredHistory,
	clearStoredViewsByConnection,
} from "../lib/browser-storage";
import { uiStore } from "./ui";

export interface SchemaTree {
	schemas: SchemaInfo[];
	tables: Record<string, TableInfo[]>; // keyed by schema name
}

export interface ConnectionStoreState {
	connections: ConnectionInfo[];
	activeConnectionId: string | null;
	// Nested: schemaTrees[connectionId][databaseName] = SchemaTree
	schemaTrees: Record<string, Record<string, SchemaTree>>;
	availableDatabases: Record<string, DatabaseInfo[]>;
}

const [state, setState] = createStore<ConnectionStoreState>({
	connections: [],
	activeConnectionId: null,
	schemaTrees: {},
	availableDatabases: {},
});

/**
 * Optional hook called before disconnecting.
 * Returns false to prevent disconnect.
 */
let beforeDisconnectHook: ((connectionId: string) => boolean) | null = null;

function setBeforeDisconnectHook(hook: ((connectionId: string) => boolean) | null) {
	beforeDisconnectHook = hook;
}

// ── Password prompt signal (for stateless mode) ──────────
const [passwordPrompt, setPasswordPrompt] = createSignal<{
	connectionId: string;
	connectionName: string;
	resolve: (password: string | null) => void;
} | null>(null);

// ── Remember-password tracking for stateless mode ────────
const rememberPasswordMap = new Map<string, boolean>();

// ── Schema loading ───────────────────────────────────────

async function loadSchemaTree(connectionId: string, database?: string) {
	const schemas = await rpc.schema.getSchemas(connectionId, database);
	const tables: Record<string, TableInfo[]> = {};

	for (const schema of schemas) {
		tables[schema.name] = await rpc.schema.getTables(connectionId, schema.name, database);
	}

	const dbKey = database ?? getDefaultDatabaseKey(connectionId);
	if (!state.schemaTrees[connectionId]) {
		setState("schemaTrees", connectionId, {});
	}
	setState("schemaTrees", connectionId, dbKey, { schemas, tables });
}

function getDefaultDatabaseKey(connectionId: string): string {
	const conn = state.connections.find((c) => c.id === connectionId);
	if (!conn) return "__default__";
	if (conn.config.type === "postgresql") return conn.config.database;
	if (conn.config.type === "sqlite") return conn.config.path;
	return "__default__";
}

async function loadAvailableDatabases(connectionId: string) {
	try {
		const databases = await rpc.databases.list(connectionId);
		setState("availableDatabases", connectionId, databases);
	} catch {
		// Not a PostgreSQL connection or not connected
	}
}

async function activateDatabase(connectionId: string, database: string) {
	await rpc.databases.activate(connectionId, database);
	await loadSchemaTree(connectionId, database);
	await loadAvailableDatabases(connectionId);

	if (isStateless()) {
		persistConnectionConfig(connectionId);
	}
}

async function deactivateDatabase(connectionId: string, database: string) {
	await rpc.databases.deactivate(connectionId, database);

	// Remove schema tree for this database
	if (state.schemaTrees[connectionId]) {
		setState("schemaTrees", connectionId, database, undefined!);
	}

	await loadAvailableDatabases(connectionId);

	if (isStateless()) {
		persistConnectionConfig(connectionId);
	}
}

async function persistConnectionConfig(connectionId: string) {
	// Re-fetch connection info and persist to IndexedDB
	try {
		const list = await rpc.connections.list();
		const conn = list.find((c) => c.id === connectionId);
		if (!conn) return;

		const remember = rememberPasswordMap.get(connectionId) ?? true;
		const configToStore = !remember && conn.config.type === "postgresql"
			? { ...conn.config, password: "" }
			: conn.config;
		const { encryptedConfig } = await rpc.storage.encrypt(JSON.stringify(configToStore));
		await putStoredConnection({
			id: connectionId,
			name: conn.name,
			encryptedConfig,
			rememberPassword: remember,
			createdAt: conn.createdAt,
			updatedAt: conn.updatedAt,
		});
	} catch (e) {
		console.warn("Failed to persist connection config:", e);
	}
}

// ── Actions ──────────────────────────────────────────────

async function loadConnections() {
	if (isStateless()) {
		// Restore data from IndexedDB into server's in-memory DB
		const [storedConns, settings, history, views] = await Promise.all([
			getStoredConnections(),
			getAllSettings(),
			getStoredHistory(),
			getStoredViews(),
		]);

		// Track rememberPassword from stored connections
		for (const sc of storedConns) {
			rememberPasswordMap.set(sc.id, sc.rememberPassword);
		}

		if (storedConns.length > 0 || Object.keys(settings).length > 0 || history.length > 0 || views.length > 0) {
			await rpc.storage.restore({
				connections: storedConns,
				settings,
				history,
				views,
			});
		}
	}

	const list = await rpc.connections.list();
	setState("connections", list);
	// Load schema trees for connections the backend reports as already connected
	// (e.g. after a frontend-only reload while the backend stayed alive)
	for (const conn of list) {
		if (conn.state === "connected") {
			loadSchemaTreesForConnection(conn);
		}
	}
}

async function loadSchemaTreesForConnection(conn: ConnectionInfo) {
	// Load default database schema tree
	loadSchemaTree(conn.id);

	// For PostgreSQL, load active databases and their schema trees
	if (conn.config.type === "postgresql") {
		loadAvailableDatabases(conn.id);
		const activeDbs = conn.config.activeDatabases ?? [];
		for (const db of activeDbs) {
			if (db !== conn.config.database) {
				loadSchemaTree(conn.id, db);
			}
		}
	}
}

async function createConnection(name: string, config: ConnectionConfig, rememberPassword = true): Promise<ConnectionInfo> {
	const conn = await rpc.connections.create({ name, config });
	setState("connections", (prev) => [...prev, conn]);

	if (isStateless()) {
		rememberPasswordMap.set(conn.id, rememberPassword);
		const configToStore = !rememberPassword && config.type === "postgresql"
			? { ...config, password: "" }
			: config;
		const { encryptedConfig } = await rpc.storage.encrypt(JSON.stringify(configToStore));
		await putStoredConnection({
			id: conn.id,
			name,
			encryptedConfig,
			rememberPassword,
			createdAt: conn.createdAt,
			updatedAt: conn.updatedAt,
		});
	}

	return conn;
}

async function updateConnection(id: string, name: string, config: ConnectionConfig, rememberPassword?: boolean): Promise<ConnectionInfo> {
	const conn = await rpc.connections.update({ id, name, config });
	setState("connections", (c) => c.id === id, conn);

	if (isStateless()) {
		const remember = rememberPassword ?? rememberPasswordMap.get(id) ?? true;
		rememberPasswordMap.set(id, remember);
		const configToStore = !remember && config.type === "postgresql"
			? { ...config, password: "" }
			: config;
		const { encryptedConfig } = await rpc.storage.encrypt(JSON.stringify(configToStore));
		await putStoredConnection({
			id,
			name,
			encryptedConfig,
			rememberPassword: remember,
			createdAt: conn.createdAt,
			updatedAt: conn.updatedAt,
		});
	}

	return conn;
}

async function deleteConnection(id: string) {
	await rpc.connections.delete(id);
	setState("connections", (prev) => prev.filter((c) => c.id !== id));
	// Clean up schema trees and available databases
	setState("schemaTrees", id, undefined!);
	setState("availableDatabases", id, undefined!);
	if (state.activeConnectionId === id) {
		setState("activeConnectionId", null);
	}

	if (isStateless()) {
		rememberPasswordMap.delete(id);
		await Promise.all([
			deleteStoredConnection(id),
			clearStoredHistory(id),
			clearStoredViewsByConnection(id),
		]);
	}
}

async function connectTo(id: string, password?: string) {
	// In stateless mode, if password not remembered, prompt for it
	if (isStateless() && !password && rememberPasswordMap.get(id) === false) {
		const conn = state.connections.find((c) => c.id === id);
		const connName = conn?.name ?? "Connection";
		const prompted = await promptForPassword(id, connName);
		if (!prompted) return; // User cancelled
		password = prompted;
	}

	updateConnectionState(id, "connecting");
	try {
		await rpc.connections.connect(id, password);
		// Status will be updated via the statusChanged event
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		updateConnectionState(id, "error", message);
	}
}

function promptForPassword(connectionId: string, connectionName: string): Promise<string | null> {
	return new Promise((resolve) => {
		setPasswordPrompt({ connectionId, connectionName, resolve });
	});
}

function resolvePasswordPrompt(password: string | null) {
	const prompt = passwordPrompt();
	if (prompt) {
		prompt.resolve(password);
		setPasswordPrompt(null);
	}
}

async function disconnectFrom(id: string) {
	if (beforeDisconnectHook && !beforeDisconnectHook(id)) {
		return;
	}
	await rpc.connections.disconnect(id);
	// Status will be updated via the statusChanged event
	// Clean up schema trees and available databases
	setState("schemaTrees", id, undefined!);
	setState("availableDatabases", id, undefined!);
}

function setActiveConnection(id: string | null) {
	setState("activeConnectionId", id);
}

function getRememberPassword(id: string): boolean {
	return rememberPasswordMap.get(id) ?? true;
}

// ── Internal helpers ─────────────────────────────────────

function updateConnectionState(connectionId: string, connState: ConnectionState, error?: string) {
	const idx = state.connections.findIndex((c) => c.id === connectionId);
	if (idx === -1) return;
	setState("connections", idx, "state", connState);
	if (error !== undefined) {
		setState("connections", idx, "error", error);
	} else {
		setState("connections", idx, "error", undefined);
	}
}

// ── Backend event listener ───────────────────────────────

messages.onConnectionStatusChanged((event) => {
	updateConnectionState(event.connectionId, event.state, event.error);
	if (event.state === "connected") {
		const conn = state.connections.find((c) => c.id === event.connectionId);
		if (conn) {
			loadSchemaTreesForConnection(conn);
		} else {
			loadSchemaTree(event.connectionId);
		}
	}
	if (event.state === "error" && event.error) {
		const conn = state.connections.find((c) => c.id === event.connectionId);
		const name = conn?.name ?? "Connection";
		uiStore.addToast("error", `${name}: ${friendlyErrorMessage(event.error)}`);
	}
});

// ── Export ────────────────────────────────────────────────

export const connectionsStore = {
	get connections() {
		return state.connections;
	},
	get activeConnectionId() {
		return state.activeConnectionId;
	},
	get activeConnection() {
		return state.connections.find((c) => c.id === state.activeConnectionId) ?? null;
	},
	get schemaTrees() {
		return state.schemaTrees;
	},
	get passwordPrompt() {
		return passwordPrompt();
	},
	get availableDatabases() {
		return state.availableDatabases;
	},
	getSchemaTree(connectionId: string, database?: string): SchemaTree | undefined {
		const connTrees = state.schemaTrees[connectionId];
		if (!connTrees) return undefined;
		const dbKey = database ?? getDefaultDatabaseKey(connectionId);
		return connTrees[dbKey];
	},
	getActiveDatabaseNames(connectionId: string): string[] {
		const connTrees = state.schemaTrees[connectionId];
		if (!connTrees) return [];
		return Object.keys(connTrees);
	},
	getAvailableDatabases(connectionId: string): DatabaseInfo[] {
		return state.availableDatabases[connectionId] ?? [];
	},
	getRememberPassword,
	loadConnections,
	createConnection,
	updateConnection,
	deleteConnection,
	connectTo,
	disconnectFrom,
	setActiveConnection,
	loadSchemaTree,
	loadAvailableDatabases,
	activateDatabase,
	deactivateDatabase,
	setBeforeDisconnectHook,
	resolvePasswordPrompt,
};
