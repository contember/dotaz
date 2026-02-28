import { createStore } from "solid-js/store";
import type {
	ConnectionConfig,
	ConnectionInfo,
	ConnectionState,
} from "../../shared/types/connection";
import type { SchemaInfo, TableInfo } from "../../shared/types/database";
import { rpc, messages, friendlyErrorMessage } from "../lib/rpc";
import { uiStore } from "./ui";

export interface SchemaTree {
	schemas: SchemaInfo[];
	tables: Record<string, TableInfo[]>; // keyed by schema name
}

export interface ConnectionStoreState {
	connections: ConnectionInfo[];
	activeConnectionId: string | null;
	schemaTrees: Record<string, SchemaTree>; // keyed by connection id
}

const [state, setState] = createStore<ConnectionStoreState>({
	connections: [],
	activeConnectionId: null,
	schemaTrees: {},
});

/**
 * Optional hook called before disconnecting.
 * Returns false to prevent disconnect.
 */
let beforeDisconnectHook: ((connectionId: string) => boolean) | null = null;

function setBeforeDisconnectHook(hook: ((connectionId: string) => boolean) | null) {
	beforeDisconnectHook = hook;
}

// ── Schema loading ───────────────────────────────────────

async function loadSchemaTree(connectionId: string) {
	const schemas = await rpc.schema.getSchemas(connectionId);
	const tables: Record<string, TableInfo[]> = {};

	for (const schema of schemas) {
		tables[schema.name] = await rpc.schema.getTables(connectionId, schema.name);
	}

	setState("schemaTrees", connectionId, { schemas, tables });
}

// ── Actions ──────────────────────────────────────────────

async function loadConnections() {
	const list = await rpc.connections.list();
	setState("connections", list);
}

async function createConnection(name: string, config: ConnectionConfig): Promise<ConnectionInfo> {
	const conn = await rpc.connections.create({ name, config });
	setState("connections", (prev) => [...prev, conn]);
	return conn;
}

async function updateConnection(id: string, name: string, config: ConnectionConfig): Promise<ConnectionInfo> {
	const conn = await rpc.connections.update({ id, name, config });
	setState("connections", (c) => c.id === id, conn);
	return conn;
}

async function deleteConnection(id: string) {
	await rpc.connections.delete(id);
	setState("connections", (prev) => prev.filter((c) => c.id !== id));
	// Clean up schema tree
	setState("schemaTrees", id, undefined!);
	if (state.activeConnectionId === id) {
		setState("activeConnectionId", null);
	}
}

async function connectTo(id: string) {
	updateConnectionState(id, "connecting");
	try {
		await rpc.connections.connect(id);
		// Status will be updated via the statusChanged event
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		updateConnectionState(id, "error", message);
	}
}

async function disconnectFrom(id: string) {
	if (beforeDisconnectHook && !beforeDisconnectHook(id)) {
		return;
	}
	await rpc.connections.disconnect(id);
	// Status will be updated via the statusChanged event
	// Clean up schema tree
	setState("schemaTrees", id, undefined!);
}

function setActiveConnection(id: string | null) {
	setState("activeConnectionId", id);
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
		loadSchemaTree(event.connectionId);
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
	getSchemaTree(connectionId: string): SchemaTree | undefined {
		return state.schemaTrees[connectionId];
	},
	loadConnections,
	createConnection,
	updateConnection,
	deleteConnection,
	connectTo,
	disconnectFrom,
	setActiveConnection,
	loadSchemaTree,
	setBeforeDisconnectHook,
};
