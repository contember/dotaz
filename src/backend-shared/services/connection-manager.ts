import type { DatabaseDriver } from "../db/driver";
import { PostgresDriver } from "../drivers/postgres-driver";
import { SqliteDriver } from "../drivers/sqlite-driver";
import { MysqlDriver } from "../drivers/mysql-driver";
import type { AppDatabase } from "../storage/app-db";
import type {
	ConnectionConfig,
	ConnectionInfo,
	ConnectionState,
	PostgresConnectionConfig,
} from "../../shared/types/connection";
import {
	getDefaultDatabase,
	isServerConfig,
	CONNECTION_TYPE_META,
} from "../../shared/types/connection";
import type { DatabaseInfo } from "../../shared/types/database";
import type { DatabaseErrorCode } from "../../shared/types/errors";
import { DatabaseError } from "../../shared/types/errors";
import { createSshTunnel, type SshTunnel } from "./ssh-tunnel";

export interface StatusChangeEvent {
	connectionId: string;
	state: ConnectionState;
	error?: string;
	errorCode?: DatabaseErrorCode;
}

export type StatusChangeListener = (event: StatusChangeEvent) => void;

// ── Health check / reconnect defaults ────────────────────────
const DEFAULTS = {
	healthCheckIntervalMs: 30_000,
	reconnectBaseDelayMs: 1_000,
	reconnectMaxDelayMs: 30_000,
	reconnectMaxAttempts: 5,
	maxActiveDatabases: 10,
};

export interface ConnectionManagerOptions {
	healthCheckIntervalMs?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
	reconnectMaxAttempts?: number;
	maxActiveDatabases?: number;
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

	// SSH tunnels keyed by connectionId
	private tunnels = new Map<string, SshTunnel>();
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
		// Close any existing tunnel
		await this.closeTunnel(connectionId);

		this.setConnectionState(connectionId, "connecting");

		try {
			let config = configOverride
				? { ...connInfo.config, ...configOverride }
				: connInfo.config;
			validateConfig(config);

			// Cache the effective password for later database activations
			if (isServerConfig(config)) {
				this.passwords.set(connectionId, config.password);
			}

			// Create SSH tunnel if configured (PostgreSQL only)
			config = await this.setupSshTunnel(connectionId, config);

			const defaultDb = getDefaultDatabase(config);
			const driver = createDriver(config);
			await driver.connect(config);

			const driverMap = new Map<string, DatabaseDriver>();
			driverMap.set(defaultDb, driver);
			this.drivers.set(connectionId, driverMap);

			// Connect active databases in parallel (multi-database types only)
			if (CONNECTION_TYPE_META[config.type].supportsMultiDatabase && 'activeDatabases' in config && config.activeDatabases) {
				const activations = config.activeDatabases
					.filter((db) => db !== config.database)
					.map((db) => this.connectDatabase(connectionId, config as PostgresConnectionConfig, db));
				await Promise.allSettled(activations);
			}

			this.setConnectionState(connectionId, "connected");
			this.startHealthCheck(connectionId);
		} catch (err) {
			// Clean up tunnel on connection failure
			await this.closeTunnel(connectionId);
			const message =
				err instanceof Error ? err.message : "Unknown connection error";
			const errorCode = err instanceof DatabaseError ? err.code : undefined;
			this.setConnectionState(connectionId, "error", message, errorCode);
			throw err;
		}
	}

	async disconnect(connectionId: string): Promise<void> {
		this.cancelAutoReconnect(connectionId);
		this.stopHealthCheck(connectionId);
		await this.gracefulDisconnect(connectionId);
		await this.closeTunnel(connectionId);
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
		if (!connInfo || !CONNECTION_TYPE_META[connInfo.config.type].supportsMultiDatabase) {
			throw new Error("listDatabases is only supported for connections with multi-database support");
		}

		const defaultDb = getDefaultDatabase(connInfo.config);
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
		if (!connInfo || !CONNECTION_TYPE_META[connInfo.config.type].supportsMultiDatabase) {
			throw new Error("activateDatabase is only supported for connections with multi-database support");
		}

		// Currently only PostgreSQL supports multi-database
		const pgConfig = connInfo.config as PostgresConnectionConfig;

		const driverMap = this.drivers.get(connectionId);
		if (!driverMap) {
			throw new Error(`No active connection for id: ${connectionId}`);
		}

		// Already active
		if (driverMap.has(database)) return;

		// Enforce pool limit
		const totalActive = this.getActiveDatabaseCount();
		if (totalActive >= this.opts.maxActiveDatabases) {
			throw new Error(
				`Cannot activate database "${database}": maximum number of active databases (${this.opts.maxActiveDatabases}) reached. Deactivate an unused database first.`,
			);
		}

		const password = this.passwords.get(connectionId) ?? pgConfig.password;
		const config: PostgresConnectionConfig = {
			...pgConfig,
			database,
			password,
		};

		await this.connectDatabase(connectionId, config, database);

		// Persist to config
		const activeDatabases = [...new Set([
			...(pgConfig.activeDatabases ?? []),
			database,
		])];
		this.appDb.updateConnection({
			id: connectionId,
			name: connInfo.name,
			config: { ...pgConfig, activeDatabases },
		});
	}

	async deactivateDatabase(connectionId: string, database: string): Promise<void> {
		const connInfo = this.appDb.getConnectionById(connectionId);
		if (!connInfo || !CONNECTION_TYPE_META[connInfo.config.type].supportsMultiDatabase) {
			throw new Error("deactivateDatabase is only supported for connections with multi-database support");
		}

		// Currently only PostgreSQL supports multi-database
		const pgConfig = connInfo.config as PostgresConnectionConfig;

		if (database === getDefaultDatabase(pgConfig)) {
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
		const activeDatabases = (pgConfig.activeDatabases ?? [])
			.filter((db: string) => db !== database);
		this.appDb.updateConnection({
			id: connectionId,
			name: connInfo.name,
			config: {
				...pgConfig,
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
		readOnly?: boolean;
		color?: string;
	}, allowMissingPassword = false): ConnectionInfo {
		validateConfig(params.config, allowMissingPassword);
		return this.appDb.createConnection(params);
	}

	updateConnection(params: {
		id: string;
		name: string;
		config: ConnectionConfig;
		readOnly?: boolean;
		color?: string;
	}): ConnectionInfo {
		validateConfig(params.config);
		const updated = this.appDb.updateConnection(params);
		return {
			...updated,
			state: this.getConnectionState(params.id),
			error: this.states.get(params.id)?.error,
		};
	}

	setConnectionReadOnly(id: string, readOnly: boolean): ConnectionInfo {
		const updated = this.appDb.setConnectionReadOnly(id, readOnly);
		return {
			...updated,
			state: this.getConnectionState(id),
			error: this.states.get(id)?.error,
		};
	}

	async deleteConnection(id: string): Promise<void> {
		this.cancelAutoReconnect(id);
		this.stopHealthCheck(id);
		// Disconnect if active before deleting
		if (this.drivers.has(id)) {
			await this.disconnectAllDrivers(id);
		}
		await this.closeTunnel(id);
		this.passwords.delete(id);
		this.states.delete(id);
		this.appDb.deleteConnection(id);
	}

	async testConnection(
		config: ConnectionConfig,
	): Promise<{ success: boolean; error?: string }> {
		validateConfig(config);
		let tunnel: SshTunnel | null = null;
		let effectiveConfig = config;
		try {
			// Set up SSH tunnel if configured
			if (config.type === "postgresql" && config.sshTunnel?.enabled) {
				tunnel = await createSshTunnel(config.sshTunnel, config.host, config.port);
				effectiveConfig = { ...config, host: "127.0.0.1", port: tunnel.localPort };
			}

			const driver = createDriver(effectiveConfig);
			await driver.connect(effectiveConfig);
			await driver.disconnect();
			return { success: true };
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Unknown connection error";
			return { success: false, error: message };
		} finally {
			if (tunnel) {
				await tunnel.close();
			}
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
		// Disconnect all active drivers (also closes tunnels)
		const ids = [...new Set([...this.drivers.keys(), ...this.tunnels.keys()])];
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
			// Close existing tunnel before reconnecting
			await this.closeTunnel(connectionId);

			// Use cached password if available
			const cachedPw = this.passwords.get(connectionId);
			let config: ConnectionConfig = cachedPw
				? { ...connInfo.config, password: cachedPw } as ConnectionConfig
				: connInfo.config;

			// Set up SSH tunnel if configured
			config = await this.setupSshTunnel(connectionId, config);

			const defaultDb = getDefaultDatabase(config);
			const driver = createDriver(config);
			await driver.connect(config);

			if (rs.cancelled) {
				await driver.disconnect();
				await this.closeTunnel(connectionId);
				return;
			}

			const driverMap = new Map<string, DatabaseDriver>();
			driverMap.set(defaultDb, driver);
			this.drivers.set(connectionId, driverMap);

			// Reconnect active databases
			if (CONNECTION_TYPE_META[config.type].supportsMultiDatabase && 'activeDatabases' in config && (config as PostgresConnectionConfig).activeDatabases) {
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
			await this.closeTunnel(connectionId);
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

		// Use the tunnel-rewritten host/port if a tunnel is active
		const tunnel = this.tunnels.get(connectionId);
		const tunnelOverride = tunnel
			? { host: "127.0.0.1", port: tunnel.localPort }
			: {};

		const config: PostgresConnectionConfig = { ...baseConfig, ...tunnelOverride, database };
		const driver = createDriver(config);
		await driver.connect(config);
		driverMap.set(database, driver);
	}

	/**
	 * If the connection config has an SSH tunnel configured,
	 * create the tunnel and return a modified config pointing at localhost.
	 */
	private async setupSshTunnel(connectionId: string, config: ConnectionConfig): Promise<ConnectionConfig> {
		if (config.type !== "postgresql" || !config.sshTunnel?.enabled) {
			return config;
		}

		const tunnel = await createSshTunnel(config.sshTunnel, config.host, config.port);
		this.tunnels.set(connectionId, tunnel);

		return { ...config, host: "127.0.0.1", port: tunnel.localPort };
	}

	private async closeTunnel(connectionId: string): Promise<void> {
		const tunnel = this.tunnels.get(connectionId);
		if (tunnel) {
			await tunnel.close();
			this.tunnels.delete(connectionId);
		}
	}

	private getActiveDatabaseCount(): number {
		let count = 0;
		for (const driverMap of this.drivers.values()) {
			count += driverMap.size;
		}
		return count;
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
		errorCode?: DatabaseErrorCode,
	): void {
		this.states.set(connectionId, { state, error });
		for (const listener of this.listeners) {
			listener({ connectionId, state, error, errorCode });
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
		case "mysql":
			return new MysqlDriver();
		default:
			throw new Error(
				`Unsupported connection type: ${(config as any).type}`,
			);
	}
}

function validateConfig(config: ConnectionConfig, allowMissingPassword = false): void {
	if (!config || !config.type) {
		throw new Error("Connection config must have a type");
	}

	const meta = CONNECTION_TYPE_META[config.type];
	if (!meta) {
		throw new Error(`Unsupported connection type: ${(config as any).type}`);
	}

	if (meta.hasHost && isServerConfig(config)) {
		const label = meta.label;
		if (!config.host) throw new Error(`${label} host is required`);
		if (!config.port) throw new Error(`${label} port is required`);
		if (!config.database) throw new Error(`${label} database is required`);
		if (!config.user) throw new Error(`${label} user is required`);
		if (!allowMissingPassword && (config.password === undefined || config.password === null))
			throw new Error(`${label} password is required`);
	} else if (config.type === "sqlite") {
		if (!config.path) throw new Error("SQLite path is required");
	}
}
