import type { DatabaseDriver } from "../db/driver";
import { PostgresDriver } from "../db/postgres-driver";
import { SqliteDriver } from "../db/sqlite-driver";
import type { AppDatabase } from "../storage/app-db";
import type {
	ConnectionConfig,
	ConnectionInfo,
	ConnectionState,
} from "../../shared/types/connection";

export interface StatusChangeEvent {
	connectionId: string;
	state: ConnectionState;
	error?: string;
}

export type StatusChangeListener = (event: StatusChangeEvent) => void;

export class ConnectionManager {
	private drivers = new Map<string, DatabaseDriver>();
	private states = new Map<
		string,
		{ state: ConnectionState; error?: string }
	>();
	private listeners: StatusChangeListener[] = [];
	private appDb: AppDatabase;

	constructor(appDb: AppDatabase) {
		this.appDb = appDb;
	}

	// ── Connection lifecycle ────────────────────────────────

	async connect(connectionId: string): Promise<void> {
		const connInfo = this.appDb.getConnectionById(connectionId);
		if (!connInfo) {
			throw new Error(`Connection not found: ${connectionId}`);
		}

		// Disconnect existing driver if already active
		if (this.drivers.has(connectionId)) {
			await this.disconnectDriver(connectionId);
		}

		this.setConnectionState(connectionId, "connecting");

		try {
			validateConfig(connInfo.config);
			const driver = createDriver(connInfo.config);
			await driver.connect(connInfo.config);
			this.drivers.set(connectionId, driver);
			this.setConnectionState(connectionId, "connected");
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Unknown connection error";
			this.setConnectionState(connectionId, "error", message);
			throw err;
		}
	}

	async disconnect(connectionId: string): Promise<void> {
		await this.disconnectDriver(connectionId);
		this.setConnectionState(connectionId, "disconnected");
	}

	async reconnect(connectionId: string): Promise<void> {
		if (this.drivers.has(connectionId)) {
			await this.disconnectDriver(connectionId);
		}
		await this.connect(connectionId);
	}

	// ── Active connection access ────────────────────────────

	getDriver(connectionId: string): DatabaseDriver {
		const driver = this.drivers.get(connectionId);
		if (!driver) {
			throw new Error(
				`No active connection for id: ${connectionId}`,
			);
		}
		return driver;
	}

	getConnectionState(connectionId: string): ConnectionState {
		return this.states.get(connectionId)?.state ?? "disconnected";
	}

	// ── CRUD delegation to AppDatabase ──────────────────────

	listConnections(): ConnectionInfo[] {
		const connections = this.appDb.listConnections();
		return connections.map((conn) => ({
			...conn,
			state: this.getConnectionState(conn.id),
			error: this.states.get(conn.id)?.error,
		}));
	}

	createConnection(params: {
		name: string;
		config: ConnectionConfig;
	}): ConnectionInfo {
		validateConfig(params.config);
		return this.appDb.createConnection(params);
	}

	updateConnection(params: {
		id: string;
		name: string;
		config: ConnectionConfig;
	}): ConnectionInfo {
		validateConfig(params.config);
		const updated = this.appDb.updateConnection(params);
		return {
			...updated,
			state: this.getConnectionState(params.id),
			error: this.states.get(params.id)?.error,
		};
	}

	async deleteConnection(id: string): Promise<void> {
		// Disconnect if active before deleting
		if (this.drivers.has(id)) {
			await this.disconnectDriver(id);
		}
		this.states.delete(id);
		this.appDb.deleteConnection(id);
	}

	async testConnection(
		config: ConnectionConfig,
	): Promise<{ success: boolean; error?: string }> {
		validateConfig(config);
		const driver = createDriver(config);
		try {
			await driver.connect(config);
			await driver.disconnect();
			return { success: true };
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Unknown connection error";
			return { success: false, error: message };
		}
	}

	// ── Event system ────────────────────────────────────────

	onStatusChanged(listener: StatusChangeListener): () => void {
		this.listeners.push(listener);
		return () => {
			const idx = this.listeners.indexOf(listener);
			if (idx >= 0) this.listeners.splice(idx, 1);
		};
	}

	// ── Cleanup ─────────────────────────────────────────────

	async disconnectAll(): Promise<void> {
		const ids = [...this.drivers.keys()];
		for (const id of ids) {
			await this.disconnect(id);
		}
	}

	// ── Private helpers ─────────────────────────────────────

	private async disconnectDriver(connectionId: string): Promise<void> {
		const driver = this.drivers.get(connectionId);
		if (driver) {
			try {
				await driver.disconnect();
			} finally {
				this.drivers.delete(connectionId);
			}
		}
	}

	private setConnectionState(
		connectionId: string,
		state: ConnectionState,
		error?: string,
	): void {
		this.states.set(connectionId, { state, error });
		for (const listener of this.listeners) {
			listener({ connectionId, state, error });
		}
	}
}

// ── Factory helpers ─────────────────────────────────────────

function createDriver(config: ConnectionConfig): DatabaseDriver {
	switch (config.type) {
		case "postgresql":
			return new PostgresDriver();
		case "sqlite":
			return new SqliteDriver();
		default:
			throw new Error(
				`Unsupported connection type: ${(config as any).type}`,
			);
	}
}

function validateConfig(config: ConnectionConfig): void {
	if (!config || !config.type) {
		throw new Error("Connection config must have a type");
	}

	switch (config.type) {
		case "postgresql": {
			if (!config.host) throw new Error("PostgreSQL host is required");
			if (!config.port) throw new Error("PostgreSQL port is required");
			if (!config.database)
				throw new Error("PostgreSQL database is required");
			if (!config.user) throw new Error("PostgreSQL user is required");
			if (config.password === undefined || config.password === null)
				throw new Error("PostgreSQL password is required");
			break;
		}
		case "sqlite": {
			if (!config.path) throw new Error("SQLite path is required");
			break;
		}
		default:
			throw new Error(
				`Unsupported connection type: ${(config as any).type}`,
			);
	}
}
