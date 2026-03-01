import type { DatabaseDriver } from "../db/driver";
import { PostgresDriver } from "../db/postgres-driver";
import { SqliteDriver } from "../db/sqlite-driver";
import type { AppDatabase } from "../storage/app-db";
import type {
	ConnectionConfig,
	ConnectionInfo,
	ConnectionState,
	PostgresConnectionConfig,
} from "../../shared/types/connection";
import type { DatabaseInfo } from "../../shared/types/database";

export interface StatusChangeEvent {
	connectionId: string;
	state: ConnectionState;
	error?: string;
}

export type StatusChangeListener = (event: StatusChangeEvent) => void;

// ── Health check / reconnect defaults ────────────────────────
const DEFAULTS = {
	healthCheckIntervalMs: 30_000,
	reconnectBaseDelayMs: 1_000,
	reconnectMaxDelayMs: 30_000,
	reconnectMaxAttempts: 5,
};

export interface ConnectionManagerOptions {
	healthCheckIntervalMs?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
	reconnectMaxAttempts?: number;
}

interface ReconnectState {
	attempt: number;
	timer: ReturnType<typeof setTimeout> | null;
	cancelled: boolean;
}

export class ConnectionManager {
	// Nested map: connectionId → databaseName → driver
	private drivers = new Map<string, Map<string, DatabaseDriver>>();
	// Cached passwords for multi-database activation (connectionId → password)
	private passwords = new Map<string, string>();
	private states = new Map<
		string,
		{ state: ConnectionState; error?: string }
	>();
	private listeners: StatusChangeListener[] = [];
	private appDb: AppDatabase;
	private opts: Required<ConnectionManagerOptions>;

	// Health check timers keyed by connectionId
	private healthTimers = new Map<string, ReturnType<typeof setInterval>>();
	// Active auto-reconnect state keyed by connectionId
	private reconnectStates = new Map<string, ReconnectState>();

	constructor(appDb: AppDatabase, opts?: ConnectionManagerOptions) {
		this.appDb = appDb;
		this.opts = { ...DEFAULTS, ...opts };
	}

	// ── Connection lifecycle ────────────────────────────────

	async connect(connectionId: string, configOverride?: { password?: string }): Promise<void> {
		const connInfo = this.appDb.getConnectionById(connectionId);
		if (!connInfo) {
			throw new Error(`Connection not found: ${connectionId}`);
		}

		// Cancel any pending auto-reconnect
		this.cancelAutoReconnect(connectionId);

		// Disconnect existing drivers if already active
		if (this.drivers.has(connectionId)) {
			await this.disconnectAllDrivers(connectionId);
		}

		this.setConnectionState(connectionId, "connecting");

		try {
			const config = configOverride
				? { ...connInfo.config, ...configOverride }
				: connInfo.config;
			validateConfig(config);

			// Cache the effective password for later database activations
			if (config.type === "postgresql") {
				this.passwords.set(connectionId, config.password);
			}

			const defaultDb = getDefaultDatabase(config);
			const driver = createDriver(config);
			await driver.connect(config);

			const driverMap = new Map<string, DatabaseDriver>();
			driverMap.set(defaultDb, driver);
			this.drivers.set(connectionId, driverMap);

			// Connect active databases in parallel (PostgreSQL only)
			if (config.type === "postgresql" && config.activeDatabases) {
				const activations = config.activeDatabases
					.filter((db) => db !== config.database)
					.map((db) => this.connectDatabase(connectionId, config, db));
				await Promise.allSettled(activations);
			}

			this.setConnectionState(connectionId, "connected");
			this.startHealthCheck(connectionId);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Unknown connection error";
			this.setConnectionState(connectionId, "error", message);
			throw err;
		}
	}

	async disconnect(connectionId: string): Promise<void> {
		this.cancelAutoReconnect(connectionId);
		this.stopHealthCheck(connectionId);
		await this.gracefulDisconnect(connectionId);
		this.passwords.delete(connectionId);
		this.setConnectionState(connectionId, "disconnected");
	}

	async reconnect(connectionId: string): Promise<void> {
		this.cancelAutoReconnect(connectionId);
		this.stopHealthCheck(connectionId);
		if (this.drivers.has(connectionId)) {
			await this.gracefulDisconnect(connectionId);
		}
		await this.connect(connectionId);
	}

	// ── Active connection access ────────────────────────────

	getDriver(connectionId: string, database?: string): DatabaseDriver {
		const driverMap = this.drivers.get(connectionId);
		if (!driverMap) {
			throw new Error(
				`No active connection for id: ${connectionId}`,
			);
		}

		const dbName = database ?? this.getDefaultDatabaseName(connectionId);
		const driver = driverMap.get(dbName);
		if (!driver) {
			throw new Error(
				`No active driver for database "${dbName}" on connection ${connectionId}`,
			);
		}
		return driver;
	}

	getConnectionState(connectionId: string): ConnectionState {
		return this.states.get(connectionId)?.state ?? "disconnected";
	}

	// ── Multi-database management ────────────────────────────

	async listDatabases(connectionId: string): Promise<DatabaseInfo[]> {
		const connInfo = this.appDb.getConnectionById(connectionId);
		if (!connInfo || connInfo.config.type !== "postgresql") {
			throw new Error("listDatabases is only supported for PostgreSQL connections");
		}

		const defaultDb = connInfo.config.database;
		const driver = this.getDriver(connectionId, defaultDb);
		const result = await driver.execute(
			"SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname",
		);

		const driverMap = this.drivers.get(connectionId);
		const activeDbs = driverMap ? [...driverMap.keys()] : [defaultDb];

		return result.rows.map((row) => ({
			name: row.datname as string,
			isDefault: row.datname === defaultDb,
			isActive: activeDbs.includes(row.datname as string),
		}));
	}

	async activateDatabase(connectionId: string, database: string): Promise<void> {
		const connInfo = this.appDb.getConnectionById(connectionId);
		if (!connInfo || connInfo.config.type !== "postgresql") {
			throw new Error("activateDatabase is only supported for PostgreSQL connections");
		}

		const driverMap = this.drivers.get(connectionId);
		if (!driverMap) {
			throw new Error(`No active connection for id: ${connectionId}`);
		}

		// Already active
		if (driverMap.has(database)) return;

		const password = this.passwords.get(connectionId) ?? connInfo.config.password;
		const config: PostgresConnectionConfig = {
			...connInfo.config,
			database,
			password,
		};

		await this.connectDatabase(connectionId, config, database);

		// Persist to config
		const activeDatabases = [...new Set([
			...(connInfo.config.activeDatabases ?? []),
			database,
		])];
		this.appDb.updateConnection({
			id: connectionId,
			name: connInfo.name,
			config: { ...connInfo.config, activeDatabases },
		});
	}

	async deactivateDatabase(connectionId: string, database: string): Promise<void> {
		const connInfo = this.appDb.getConnectionById(connectionId);
		if (!connInfo || connInfo.config.type !== "postgresql") {
			throw new Error("deactivateDatabase is only supported for PostgreSQL connections");
		}

		if (database === connInfo.config.database) {
			throw new Error("Cannot deactivate the default database");
		}

		const driverMap = this.drivers.get(connectionId);
		if (driverMap) {
			const driver = driverMap.get(database);
			if (driver) {
				try {
					await driver.disconnect();
				} finally {
					driverMap.delete(database);
				}
			}
		}

		// Persist to config
		const activeDatabases = (connInfo.config.activeDatabases ?? [])
			.filter((db) => db !== database);
		this.appDb.updateConnection({
			id: connectionId,
			name: connInfo.name,
			config: {
				...connInfo.config,
				activeDatabases: activeDatabases.length > 0 ? activeDatabases : undefined,
			},
		});
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
	}, allowMissingPassword = false): ConnectionInfo {
		validateConfig(params.config, allowMissingPassword);
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
		this.cancelAutoReconnect(id);
		this.stopHealthCheck(id);
		// Disconnect if active before deleting
		if (this.drivers.has(id)) {
			await this.disconnectAllDrivers(id);
		}
		this.passwords.delete(id);
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
		// Cancel all pending auto-reconnects (may not have a driver entry)
		for (const id of [...this.reconnectStates.keys()]) {
			this.cancelAutoReconnect(id);
		}
		// Stop all health checks
		for (const id of [...this.healthTimers.keys()]) {
			this.stopHealthCheck(id);
		}
		// Disconnect all active drivers
		const ids = [...this.drivers.keys()];
		for (const id of ids) {
			await this.disconnect(id);
		}
	}

	// ── Health check ────────────────────────────────────────

	private startHealthCheck(connectionId: string): void {
		this.stopHealthCheck(connectionId);
		const timer = setInterval(() => {
			this.performHealthCheck(connectionId);
		}, this.opts.healthCheckIntervalMs);
		this.healthTimers.set(connectionId, timer);
	}

	private stopHealthCheck(connectionId: string): void {
		const timer = this.healthTimers.get(connectionId);
		if (timer) {
			clearInterval(timer);
			this.healthTimers.delete(connectionId);
		}
	}

	private async performHealthCheck(connectionId: string): Promise<void> {
		const driverMap = this.drivers.get(connectionId);
		if (!driverMap) return;

		// Health-check the default driver
		const defaultDb = this.getDefaultDatabaseName(connectionId);
		const driver = driverMap.get(defaultDb);
		if (!driver) return;

		try {
			await driver.execute("SELECT 1");
		} catch {
			// Connection lost — stop health checks and begin auto-reconnect
			this.stopHealthCheck(connectionId);
			await this.disconnectAllDrivers(connectionId);
			this.setConnectionState(connectionId, "disconnected", "Connection lost");
			this.startAutoReconnect(connectionId);
		}
	}

	// ── Auto-reconnect with exponential backoff ─────────────

	private startAutoReconnect(connectionId: string): void {
		this.cancelAutoReconnect(connectionId);
		const rs: ReconnectState = { attempt: 0, timer: null, cancelled: false };
		this.reconnectStates.set(connectionId, rs);
		this.scheduleReconnectAttempt(connectionId, rs);
	}

	private cancelAutoReconnect(connectionId: string): void {
		const rs = this.reconnectStates.get(connectionId);
		if (rs) {
			rs.cancelled = true;
			if (rs.timer) clearTimeout(rs.timer);
			this.reconnectStates.delete(connectionId);
		}
	}

	private scheduleReconnectAttempt(connectionId: string, rs: ReconnectState): void {
		if (rs.cancelled) return;
		if (rs.attempt >= this.opts.reconnectMaxAttempts) {
			this.reconnectStates.delete(connectionId);
			this.setConnectionState(
				connectionId,
				"error",
				`Reconnect failed after ${this.opts.reconnectMaxAttempts} attempts`,
			);
			return;
		}

		const delay = Math.min(
			this.opts.reconnectBaseDelayMs * Math.pow(2, rs.attempt),
			this.opts.reconnectMaxDelayMs,
		);

		rs.timer = setTimeout(() => {
			if (rs.cancelled) return;
			this.attemptReconnect(connectionId, rs);
		}, delay);
	}

	private async attemptReconnect(connectionId: string, rs: ReconnectState): Promise<void> {
		if (rs.cancelled) return;

		const connInfo = this.appDb.getConnectionById(connectionId);
		if (!connInfo) {
			this.cancelAutoReconnect(connectionId);
			return;
		}

		rs.attempt++;
		this.setConnectionState(connectionId, "reconnecting");

		try {
			// Use cached password if available
			const cachedPassword = this.passwords.get(connectionId);
			const config = cachedPassword
				? { ...connInfo.config, password: cachedPassword } as ConnectionConfig
				: connInfo.config;

			const defaultDb = getDefaultDatabase(config);
			const driver = createDriver(config);
			await driver.connect(config);

			if (rs.cancelled) {
				await driver.disconnect();
				return;
			}

			const driverMap = new Map<string, DatabaseDriver>();
			driverMap.set(defaultDb, driver);
			this.drivers.set(connectionId, driverMap);

			// Reconnect active databases
			if (config.type === "postgresql" && (config as PostgresConnectionConfig).activeDatabases) {
				const activations = (config as PostgresConnectionConfig).activeDatabases!
					.filter((db) => db !== (config as PostgresConnectionConfig).database)
					.map((db) => this.connectDatabase(connectionId, config as PostgresConnectionConfig, db));
				await Promise.allSettled(activations);
			}

			this.reconnectStates.delete(connectionId);
			this.setConnectionState(connectionId, "connected");
			this.startHealthCheck(connectionId);
		} catch {
			if (rs.cancelled) return;
			this.scheduleReconnectAttempt(connectionId, rs);
		}
	}

	// ── Graceful disconnect ─────────────────────────────────

	private async gracefulDisconnect(connectionId: string): Promise<void> {
		const driverMap = this.drivers.get(connectionId);
		if (!driverMap) return;

		for (const [dbName, driver] of driverMap) {
			try {
				if (driver.inTransaction()) {
					try {
						await driver.rollback();
					} catch {
						// Best-effort rollback
					}
				}
				try {
					await driver.cancel();
				} catch {
					// Best-effort cancel
				}
			} finally {
				try {
					await driver.disconnect();
				} finally {
					driverMap.delete(dbName);
				}
			}
		}
		this.drivers.delete(connectionId);
	}

	// ── Private helpers ─────────────────────────────────────

	private async disconnectAllDrivers(connectionId: string): Promise<void> {
		const driverMap = this.drivers.get(connectionId);
		if (!driverMap) return;

		for (const [dbName, driver] of driverMap) {
			try {
				await driver.disconnect();
			} finally {
				driverMap.delete(dbName);
			}
		}
		this.drivers.delete(connectionId);
	}

	private async connectDatabase(
		connectionId: string,
		baseConfig: PostgresConnectionConfig,
		database: string,
	): Promise<void> {
		const driverMap = this.drivers.get(connectionId);
		if (!driverMap) {
			throw new Error(`No active connection for id: ${connectionId}`);
		}

		const config: PostgresConnectionConfig = { ...baseConfig, database };
		const driver = createDriver(config);
		await driver.connect(config);
		driverMap.set(database, driver);
	}

	private getDefaultDatabaseName(connectionId: string): string {
		const connInfo = this.appDb.getConnectionById(connectionId);
		if (!connInfo) {
			throw new Error(`Connection not found: ${connectionId}`);
		}
		return getDefaultDatabase(connInfo.config);
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

function getDefaultDatabase(config: ConnectionConfig): string {
	if (config.type === "postgresql") return config.database;
	if (config.type === "sqlite") return config.path;
	throw new Error(`Unsupported connection type: ${(config as any).type}`);
}

function validateConfig(config: ConnectionConfig, allowMissingPassword = false): void {
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
			if (!allowMissingPassword && (config.password === undefined || config.password === null))
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
