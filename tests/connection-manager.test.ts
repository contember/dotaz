import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { AppDatabase } from "../src/bun/storage/app-db";
import { ConnectionManager } from "../src/bun/services/connection-manager";
import type { StatusChangeEvent } from "../src/bun/services/connection-manager";
import type {
	ConnectionConfig,
	PostgresConnectionConfig,
	SqliteConnectionConfig,
} from "../src/shared/types/connection";
import { tmpSqlitePath } from "./helpers";

// ── Helpers ──────────────────────────────────────────────────

const sqliteConfig: SqliteConnectionConfig = {
	type: "sqlite",
	path: ":memory:",
};

const pgConfig: PostgresConnectionConfig = {
	type: "postgresql",
	host: "localhost",
	port: 5432,
	database: "mydb",
	user: "admin",
	password: "secret",
};

function createManager(): { appDb: AppDatabase; manager: ConnectionManager } {
	AppDatabase.resetInstance();
	const appDb = AppDatabase.getInstance(":memory:");
	const manager = new ConnectionManager(appDb);
	return { appDb, manager };
}

// ── Tests ────────────────────────────────────────────────────

describe("ConnectionManager", () => {
	let appDb: AppDatabase;
	let manager: ConnectionManager;

	beforeEach(() => {
		({ appDb, manager } = createManager());
	});

	afterEach(async () => {
		await manager.disconnectAll();
		AppDatabase.resetInstance();
	});

	// ── CRUD delegation ─────────────────────────────────────

	describe("CRUD", () => {
		test("createConnection persists and returns ConnectionInfo", () => {
			const conn = manager.createConnection({
				name: "SQLite Test",
				config: sqliteConfig,
			});
			expect(conn.id).toBeTruthy();
			expect(conn.name).toBe("SQLite Test");
			expect(conn.config).toEqual(sqliteConfig);
			expect(conn.state).toBe("disconnected");
		});

		test("listConnections returns all connections with live state", async () => {
			const conn = manager.createConnection({
				name: "SQLite Test",
				config: sqliteConfig,
			});
			manager.createConnection({ name: "PG Test", config: pgConfig });

			// Before connect, all disconnected
			let list = manager.listConnections();
			expect(list).toHaveLength(2);
			expect(list.every((c) => c.state === "disconnected")).toBe(true);

			// After connect, one is connected
			await manager.connect(conn.id);
			list = manager.listConnections();
			const sqliteConn = list.find((c) => c.id === conn.id)!;
			expect(sqliteConn.state).toBe("connected");
		});

		test("updateConnection persists changes and preserves state", async () => {
			const conn = manager.createConnection({
				name: "Original",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);

			const updated = manager.updateConnection({
				id: conn.id,
				name: "Updated",
				config: sqliteConfig,
			});
			expect(updated.name).toBe("Updated");
			expect(updated.state).toBe("connected");
		});

		test("deleteConnection disconnects and removes", async () => {
			const conn = manager.createConnection({
				name: "ToDelete",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);

			await manager.deleteConnection(conn.id);
			expect(manager.listConnections()).toHaveLength(0);
			expect(() => manager.getDriver(conn.id)).toThrow(
				"No active connection",
			);
		});

		test("createConnection validates config", () => {
			expect(() =>
				manager.createConnection({
					name: "Bad",
					config: { type: "sqlite", path: "" } as SqliteConnectionConfig,
				}),
			).toThrow("SQLite path is required");
		});

		test("updateConnection validates config", () => {
			const conn = manager.createConnection({
				name: "Test",
				config: sqliteConfig,
			});
			expect(() =>
				manager.updateConnection({
					id: conn.id,
					name: "Updated",
					config: {
						type: "postgresql",
						host: "",
						port: 5432,
						database: "db",
						user: "user",
						password: "pass",
					},
				}),
			).toThrow("PostgreSQL host is required");
		});
	});

	// ── Connection lifecycle ────────────────────────────────

	describe("connect", () => {
		test("connect creates a SQLite driver and makes it available", async () => {
			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);

			const driver = manager.getDriver(conn.id);
			expect(driver.isConnected()).toBe(true);
			expect(driver.getDriverType()).toBe("sqlite");
		});

		test("connect throws for unknown connection id", async () => {
			await expect(manager.connect("nonexistent")).rejects.toThrow(
				"Connection not found",
			);
		});

		test("connect sets state to error on failure", async () => {
			const conn = manager.createConnection({
				name: "Bad SQLite",
				config: { type: "sqlite", path: "/nonexistent/dir/impossible.db" },
			});

			try {
				await manager.connect(conn.id);
			} catch {
				// Expected
			}

			expect(manager.getConnectionState(conn.id)).toBe("error");
		});

		test("connect replaces existing active connection", async () => {
			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);
			const firstDriver = manager.getDriver(conn.id);

			await manager.connect(conn.id);
			const secondDriver = manager.getDriver(conn.id);

			expect(firstDriver).not.toBe(secondDriver);
			expect(secondDriver.isConnected()).toBe(true);
		});
	});

	describe("disconnect", () => {
		test("disconnect cleans up driver and sets state", async () => {
			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);
			await manager.disconnect(conn.id);

			expect(manager.getConnectionState(conn.id)).toBe("disconnected");
			expect(() => manager.getDriver(conn.id)).toThrow(
				"No active connection",
			);
		});

		test("disconnect on non-active connection is a no-op", async () => {
			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			// Should not throw
			await manager.disconnect(conn.id);
			expect(manager.getConnectionState(conn.id)).toBe("disconnected");
		});
	});

	describe("reconnect", () => {
		test("reconnect disconnects then connects", async () => {
			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);
			const firstDriver = manager.getDriver(conn.id);

			await manager.reconnect(conn.id);
			const secondDriver = manager.getDriver(conn.id);

			expect(firstDriver).not.toBe(secondDriver);
			expect(secondDriver.isConnected()).toBe(true);
			expect(manager.getConnectionState(conn.id)).toBe("connected");
		});

		test("reconnect works even if not currently connected", async () => {
			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			await manager.reconnect(conn.id);
			expect(manager.getConnectionState(conn.id)).toBe("connected");
		});
	});

	// ── Multiple connections ────────────────────────────────

	describe("multiple connections", () => {
		test("can manage multiple simultaneous SQLite connections", async () => {
			const conn1 = manager.createConnection({
				name: "DB1",
				config: sqliteConfig,
			});
			const conn2 = manager.createConnection({
				name: "DB2",
				config: sqliteConfig,
			});

			await manager.connect(conn1.id);
			await manager.connect(conn2.id);

			expect(manager.getDriver(conn1.id).isConnected()).toBe(true);
			expect(manager.getDriver(conn2.id).isConnected()).toBe(true);

			// Disconnect one, the other remains
			await manager.disconnect(conn1.id);
			expect(() => manager.getDriver(conn1.id)).toThrow();
			expect(manager.getDriver(conn2.id).isConnected()).toBe(true);
		});

		test("connections are isolated", async () => {
			const conn1 = manager.createConnection({
				name: "DB1",
				config: sqliteConfig,
			});
			const conn2 = manager.createConnection({
				name: "DB2",
				config: sqliteConfig,
			});

			await manager.connect(conn1.id);
			await manager.connect(conn2.id);

			const driver1 = manager.getDriver(conn1.id);
			const driver2 = manager.getDriver(conn2.id);

			// Create table in driver1
			await driver1.execute(
				"CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)",
			);
			await driver1.execute("INSERT INTO test (val) VALUES ('hello')");

			// driver2 should not see it
			await expect(driver2.execute("SELECT * FROM test")).rejects.toThrow();
		});
	});

	// ── getDriver ───────────────────────────────────────────

	describe("getDriver", () => {
		test("returns active driver", async () => {
			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);

			const driver = manager.getDriver(conn.id);
			expect(driver).toBeTruthy();
			expect(driver.isConnected()).toBe(true);
		});

		test("throws for non-active connection", () => {
			expect(() => manager.getDriver("nonexistent")).toThrow(
				"No active connection",
			);
		});
	});

	// ── testConnection ──────────────────────────────────────

	describe("testConnection", () => {
		test("returns success for valid SQLite config", async () => {
			const result = await manager.testConnection(sqliteConfig);
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
		});

		test("returns error for invalid SQLite path", async () => {
			const result = await manager.testConnection({
				type: "sqlite",
				path: "/nonexistent/dir/impossible.db",
			});
			expect(result.success).toBe(false);
			expect(result.error).toBeTruthy();
		});

		test("validates config before testing", async () => {
			await expect(
				manager.testConnection({
					type: "sqlite",
					path: "",
				} as SqliteConnectionConfig),
			).rejects.toThrow("SQLite path is required");
		});
	});

	// ── Status change events ────────────────────────────────

	describe("status events", () => {
		test("emits connecting and connected on successful connect", async () => {
			const events: StatusChangeEvent[] = [];
			manager.onStatusChanged((e) => events.push(e));

			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({
				connectionId: conn.id,
				state: "connecting",
			});
			expect(events[1]).toEqual({
				connectionId: conn.id,
				state: "connected",
			});
		});

		test("emits error on failed connect", async () => {
			const events: StatusChangeEvent[] = [];
			manager.onStatusChanged((e) => events.push(e));

			const conn = manager.createConnection({
				name: "Bad",
				config: {
					type: "sqlite",
					path: "/nonexistent/dir/impossible.db",
				},
			});

			try {
				await manager.connect(conn.id);
			} catch {
				// Expected
			}

			expect(events).toHaveLength(2);
			expect(events[0].state).toBe("connecting");
			expect(events[1].state).toBe("error");
			expect(events[1].error).toBeTruthy();
		});

		test("emits disconnected on disconnect", async () => {
			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);

			const events: StatusChangeEvent[] = [];
			manager.onStatusChanged((e) => events.push(e));
			await manager.disconnect(conn.id);

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				connectionId: conn.id,
				state: "disconnected",
			});
		});

		test("unsubscribe stops receiving events", async () => {
			const events: StatusChangeEvent[] = [];
			const unsub = manager.onStatusChanged((e) => events.push(e));

			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);
			expect(events.length).toBeGreaterThan(0);

			const countBefore = events.length;
			unsub();
			await manager.disconnect(conn.id);
			expect(events.length).toBe(countBefore);
		});
	});

	// ── Config validation ───────────────────────────────────

	describe("validation", () => {
		test("rejects empty PostgreSQL host", () => {
			expect(() =>
				manager.createConnection({
					name: "Bad PG",
					config: { ...pgConfig, host: "" },
				}),
			).toThrow("PostgreSQL host is required");
		});

		test("rejects missing PostgreSQL port", () => {
			expect(() =>
				manager.createConnection({
					name: "Bad PG",
					config: { ...pgConfig, port: 0 },
				}),
			).toThrow("PostgreSQL port is required");
		});

		test("rejects empty PostgreSQL database", () => {
			expect(() =>
				manager.createConnection({
					name: "Bad PG",
					config: { ...pgConfig, database: "" },
				}),
			).toThrow("PostgreSQL database is required");
		});

		test("rejects empty PostgreSQL user", () => {
			expect(() =>
				manager.createConnection({
					name: "Bad PG",
					config: { ...pgConfig, user: "" },
				}),
			).toThrow("PostgreSQL user is required");
		});

		test("allows empty string PostgreSQL password", () => {
			const conn = manager.createConnection({
				name: "PG with empty password",
				config: { ...pgConfig, password: "" },
			});
			expect(conn.id).toBeTruthy();
		});

		test("rejects empty SQLite path", () => {
			expect(() =>
				manager.createConnection({
					name: "Bad SQLite",
					config: { type: "sqlite", path: "" } as SqliteConnectionConfig,
				}),
			).toThrow("SQLite path is required");
		});

		test("rejects unsupported connection type", () => {
			expect(() =>
				manager.createConnection({
					name: "Bad",
					config: { type: "mysql" } as any,
				}),
			).toThrow("Unsupported connection type");
		});
	});

	// ── disconnectAll ───────────────────────────────────────

	describe("disconnectAll", () => {
		test("disconnects all active connections", async () => {
			const conn1 = manager.createConnection({
				name: "DB1",
				config: sqliteConfig,
			});
			const conn2 = manager.createConnection({
				name: "DB2",
				config: sqliteConfig,
			});

			await manager.connect(conn1.id);
			await manager.connect(conn2.id);

			await manager.disconnectAll();

			expect(manager.getConnectionState(conn1.id)).toBe("disconnected");
			expect(manager.getConnectionState(conn2.id)).toBe("disconnected");
			expect(() => manager.getDriver(conn1.id)).toThrow();
			expect(() => manager.getDriver(conn2.id)).toThrow();
		});
	});

	// ── Driver type selection ───────────────────────────────

	describe("driver type selection", () => {
		test("creates SqliteDriver for sqlite config", async () => {
			const conn = manager.createConnection({
				name: "SQLite",
				config: sqliteConfig,
			});
			await manager.connect(conn.id);
			expect(manager.getDriver(conn.id).getDriverType()).toBe("sqlite");
		});

		// PostgresDriver connection test requires docker; tested via pg-driver.test.ts
		// Here we just verify the manager would create the right driver type
		test("createConnection accepts postgresql config", () => {
			const conn = manager.createConnection({
				name: "PG",
				config: pgConfig,
			});
			expect(conn.config.type).toBe("postgresql");
		});
	});
});
