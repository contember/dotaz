import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { AppDatabase } from "../src/bun/storage/app-db";
import { getSchemaVersion } from "../src/bun/storage/migrations";
import type { PostgresConnectionConfig, SqliteConnectionConfig } from "../src/shared/types/connection";

describe("AppDatabase", () => {
	let appDb: AppDatabase;

	beforeEach(() => {
		AppDatabase.resetInstance();
		appDb = AppDatabase.getInstance(":memory:");
	});

	afterEach(() => {
		AppDatabase.resetInstance();
	});

	// ── Singleton ────────────────────────────────────────────

	test("getInstance returns same instance on multiple calls", () => {
		const a = AppDatabase.getInstance();
		const b = AppDatabase.getInstance();
		expect(a).toBe(b);
	});

	// ── Migrations ───────────────────────────────────────────

	test("migrations run automatically on initialization", () => {
		const version = getSchemaVersion(appDb.db);
		expect(version).toBe(1);
	});

	test("schema_version table tracks current version", () => {
		const row = appDb.db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(row.version).toBe(1);
	});

	test("all tables are created by migration 001", () => {
		const tables = appDb.db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all() as { name: string }[];
		const names = tables.map((t) => t.name);
		expect(names).toContain("connections");
		expect(names).toContain("query_history");
		expect(names).toContain("saved_views");
		expect(names).toContain("settings");
		expect(names).toContain("schema_version");
	});

	// ── Connections CRUD ─────────────────────────────────────

	describe("connections", () => {
		const pgConfig: PostgresConnectionConfig = {
			type: "postgresql",
			host: "localhost",
			port: 5432,
			database: "mydb",
			user: "admin",
			password: "secret",
		};

		const sqliteConfig: SqliteConnectionConfig = {
			type: "sqlite",
			path: "/tmp/test.db",
		};

		test("create and list connections", () => {
			appDb.createConnection({ name: "PG Dev", config: pgConfig });
			appDb.createConnection({ name: "SQLite Local", config: sqliteConfig });

			const list = appDb.listConnections();
			expect(list).toHaveLength(2);
			// Ordered by name
			expect(list[0].name).toBe("PG Dev");
			expect(list[1].name).toBe("SQLite Local");
		});

		test("create returns connection with id and timestamps", () => {
			const conn = appDb.createConnection({ name: "Test", config: pgConfig });
			expect(conn.id).toBeTruthy();
			expect(conn.name).toBe("Test");
			expect(conn.config).toEqual(pgConfig);
			expect(conn.state).toBe("disconnected");
			expect(conn.createdAt).toBeTruthy();
			expect(conn.updatedAt).toBeTruthy();
		});

		test("getById returns the correct connection", () => {
			const created = appDb.createConnection({ name: "Lookup", config: pgConfig });
			const found = appDb.getConnectionById(created.id);
			expect(found).not.toBeNull();
			expect(found!.id).toBe(created.id);
			expect(found!.name).toBe("Lookup");
			expect(found!.config).toEqual(pgConfig);
		});

		test("getById returns null for non-existent id", () => {
			const found = appDb.getConnectionById("nonexistent");
			expect(found).toBeNull();
		});

		test("update modifies name and config", () => {
			const created = appDb.createConnection({ name: "Original", config: pgConfig });
			const updated = appDb.updateConnection({
				id: created.id,
				name: "Updated",
				config: sqliteConfig,
			});
			expect(updated.name).toBe("Updated");
			expect(updated.config).toEqual(sqliteConfig);
			expect(updated.updatedAt).toBeTruthy();
		});

		test("update throws for non-existent id", () => {
			expect(() =>
				appDb.updateConnection({ id: "nonexistent", name: "X", config: pgConfig }),
			).toThrow("Connection not found");
		});

		test("delete removes the connection", () => {
			const created = appDb.createConnection({ name: "ToDelete", config: pgConfig });
			appDb.deleteConnection(created.id);
			expect(appDb.getConnectionById(created.id)).toBeNull();
			expect(appDb.listConnections()).toHaveLength(0);
		});

		test("config is persisted as JSON and parsed back correctly", () => {
			const conn = appDb.createConnection({ name: "PG SSL", config: { ...pgConfig, ssl: true } });
			const found = appDb.getConnectionById(conn.id)!;
			expect(found.config).toEqual({ ...pgConfig, ssl: true });
		});
	});

	// ── Settings CRUD ────────────────────────────────────────

	describe("settings", () => {
		test("get returns null for non-existent key", () => {
			expect(appDb.getSetting("theme")).toBeNull();
		});

		test("set and get a setting", () => {
			appDb.setSetting("theme", "dark");
			expect(appDb.getSetting("theme")).toBe("dark");
		});

		test("set overwrites existing setting", () => {
			appDb.setSetting("pageSize", "50");
			appDb.setSetting("pageSize", "100");
			expect(appDb.getSetting("pageSize")).toBe("100");
		});

		test("multiple settings are independent", () => {
			appDb.setSetting("a", "1");
			appDb.setSetting("b", "2");
			expect(appDb.getSetting("a")).toBe("1");
			expect(appDb.getSetting("b")).toBe("2");
		});
	});

	// ── Saved Views CRUD ─────────────────────────────────────

	describe("saved views", () => {
		let connectionId: string;

		beforeEach(() => {
			const conn = appDb.createConnection({
				name: "Test",
				config: { type: "sqlite", path: ":memory:" },
			});
			connectionId = conn.id;
		});

		test("create and list saved views", () => {
			appDb.createSavedView({
				connectionId,
				schemaName: "public",
				tableName: "users",
				name: "Active Users",
				config: { columns: ["id", "name"], sort: [{ column: "name", direction: "asc" }] },
			});

			const views = appDb.listSavedViews(connectionId, "public", "users");
			expect(views).toHaveLength(1);
			expect(views[0].name).toBe("Active Users");
			expect(views[0].config.columns).toEqual(["id", "name"]);
		});

		test("list filters by connection, schema, and table", () => {
			appDb.createSavedView({
				connectionId,
				schemaName: "public",
				tableName: "users",
				name: "View 1",
				config: {},
			});
			appDb.createSavedView({
				connectionId,
				schemaName: "public",
				tableName: "posts",
				name: "View 2",
				config: {},
			});

			expect(appDb.listSavedViews(connectionId, "public", "users")).toHaveLength(1);
			expect(appDb.listSavedViews(connectionId, "public", "posts")).toHaveLength(1);
			expect(appDb.listSavedViews(connectionId, "other", "users")).toHaveLength(0);
		});

		test("update modifies name and config", () => {
			const view = appDb.createSavedView({
				connectionId,
				schemaName: "public",
				tableName: "users",
				name: "Original",
				config: {},
			});

			const updated = appDb.updateSavedView({
				id: view.id,
				name: "Renamed",
				config: { columns: ["email"] },
			});
			expect(updated.name).toBe("Renamed");
			expect(updated.config.columns).toEqual(["email"]);
		});

		test("update throws for non-existent id", () => {
			expect(() =>
				appDb.updateSavedView({ id: "nonexistent", name: "X", config: {} }),
			).toThrow("Saved view not found");
		});

		test("delete removes the saved view", () => {
			const view = appDb.createSavedView({
				connectionId,
				schemaName: "public",
				tableName: "users",
				name: "ToDelete",
				config: {},
			});
			appDb.deleteSavedView(view.id);
			expect(appDb.listSavedViews(connectionId, "public", "users")).toHaveLength(0);
		});

		test("cascade delete removes views when connection is deleted", () => {
			appDb.createSavedView({
				connectionId,
				schemaName: "public",
				tableName: "users",
				name: "View",
				config: {},
			});
			appDb.deleteConnection(connectionId);
			expect(appDb.listSavedViews(connectionId, "public", "users")).toHaveLength(0);
		});
	});

	// ── History ───────────────────────────────────────────────

	describe("history", () => {
		let connectionId: string;

		beforeEach(() => {
			const conn = appDb.createConnection({
				name: "Test",
				config: { type: "sqlite", path: ":memory:" },
			});
			connectionId = conn.id;
		});

		test("add and list history entries", () => {
			appDb.addHistory({
				connectionId,
				sql: "SELECT 1",
				status: "success",
				durationMs: 10,
				rowCount: 1,
			});
			appDb.addHistory({
				connectionId,
				sql: "SELECT invalid",
				status: "error",
				errorMessage: "syntax error",
			});

			const entries = appDb.listHistory({});
			expect(entries).toHaveLength(2);
			const statuses = entries.map((e) => e.status);
			expect(statuses).toContain("success");
			expect(statuses).toContain("error");
		});

		test("add returns the created entry", () => {
			const entry = appDb.addHistory({
				connectionId,
				sql: "SELECT 1",
				status: "success",
				durationMs: 5,
				rowCount: 1,
			});
			expect(entry.id).toBeTruthy();
			expect(entry.connectionId).toBe(connectionId);
			expect(entry.sql).toBe("SELECT 1");
			expect(entry.status).toBe("success");
			expect(entry.durationMs).toBe(5);
			expect(entry.rowCount).toBe(1);
			expect(entry.executedAt).toBeTruthy();
		});

		test("list filters by connectionId", () => {
			const conn2 = appDb.createConnection({
				name: "Other",
				config: { type: "sqlite", path: "/tmp/other.db" },
			});
			appDb.addHistory({ connectionId, sql: "SELECT 1", status: "success" });
			appDb.addHistory({ connectionId: conn2.id, sql: "SELECT 2", status: "success" });

			const filtered = appDb.listHistory({ connectionId });
			expect(filtered).toHaveLength(1);
			expect(filtered[0].sql).toBe("SELECT 1");
		});

		test("list supports limit and offset", () => {
			for (let i = 0; i < 5; i++) {
				appDb.addHistory({ connectionId, sql: `SELECT ${i}`, status: "success" });
			}

			const page1 = appDb.listHistory({ limit: 2, offset: 0 });
			expect(page1).toHaveLength(2);

			const page2 = appDb.listHistory({ limit: 2, offset: 2 });
			expect(page2).toHaveLength(2);

			const page3 = appDb.listHistory({ limit: 2, offset: 4 });
			expect(page3).toHaveLength(1);
		});

		test("clear removes all history", () => {
			appDb.addHistory({ connectionId, sql: "SELECT 1", status: "success" });
			appDb.addHistory({ connectionId, sql: "SELECT 2", status: "success" });
			appDb.clearHistory();
			expect(appDb.listHistory({})).toHaveLength(0);
		});

		test("clear with connectionId removes only that connection's history", () => {
			const conn2 = appDb.createConnection({
				name: "Other",
				config: { type: "sqlite", path: "/tmp/other.db" },
			});
			appDb.addHistory({ connectionId, sql: "SELECT 1", status: "success" });
			appDb.addHistory({ connectionId: conn2.id, sql: "SELECT 2", status: "success" });

			appDb.clearHistory(connectionId);
			const remaining = appDb.listHistory({});
			expect(remaining).toHaveLength(1);
			expect(remaining[0].connectionId).toBe(conn2.id);
		});

		test("cascade delete removes history when connection is deleted", () => {
			appDb.addHistory({ connectionId, sql: "SELECT 1", status: "success" });
			appDb.deleteConnection(connectionId);
			expect(appDb.listHistory({ connectionId })).toHaveLength(0);
		});

		test("optional fields can be undefined", () => {
			const entry = appDb.addHistory({
				connectionId,
				sql: "SELECT 1",
				status: "success",
			});
			expect(entry.durationMs).toBeUndefined();
			expect(entry.rowCount).toBeUndefined();
			expect(entry.errorMessage).toBeUndefined();
		});
	});
});
