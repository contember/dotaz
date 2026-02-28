import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { AppDatabase } from "../src/bun/storage/app-db";
import { ConnectionManager } from "../src/bun/services/connection-manager";
import { createHandlers } from "../src/bun/rpc-handlers";
import type { SqliteConnectionConfig } from "../src/shared/types/connection";

// ── Helpers ──────────────────────────────────────────────────

const sqliteConfig: SqliteConnectionConfig = {
	type: "sqlite",
	path: ":memory:",
};

function setup() {
	AppDatabase.resetInstance();
	const appDb = AppDatabase.getInstance(":memory:");
	const cm = new ConnectionManager(appDb);
	const handlers = createHandlers(cm, undefined, appDb);
	return { appDb, cm, handlers };
}

// ── Tests ────────────────────────────────────────────────────

describe("RPC Handlers", () => {
	let cm: ConnectionManager;
	let handlers: ReturnType<typeof createHandlers>;

	beforeEach(() => {
		({ cm, handlers } = setup());
	});

	afterEach(async () => {
		await cm.disconnectAll();
		AppDatabase.resetInstance();
	});

	// ── connections.* ────────────────────────────────────

	describe("connections.*", () => {
		test("connections.list returns empty array initially", () => {
			const result = handlers["connections.list"]();
			expect(result).toEqual([]);
		});

		test("connections.create creates and returns connection", () => {
			const result = handlers["connections.create"]({
				name: "Test SQLite",
				config: sqliteConfig,
			});
			expect(result.id).toBeTruthy();
			expect(result.name).toBe("Test SQLite");
			expect(result.config).toEqual(sqliteConfig);
		});

		test("connections.list returns created connections", () => {
			handlers["connections.create"]({
				name: "Conn 1",
				config: sqliteConfig,
			});
			handlers["connections.create"]({
				name: "Conn 2",
				config: sqliteConfig,
			});
			const list = handlers["connections.list"]();
			expect(list).toHaveLength(2);
		});

		test("connections.update modifies connection", () => {
			const created = handlers["connections.create"]({
				name: "Original",
				config: sqliteConfig,
			});
			const updated = handlers["connections.update"]({
				id: created.id,
				name: "Updated",
				config: sqliteConfig,
			});
			expect(updated.name).toBe("Updated");
		});

		test("connections.delete removes connection", async () => {
			const created = handlers["connections.create"]({
				name: "ToDelete",
				config: sqliteConfig,
			});
			await handlers["connections.delete"]({ id: created.id });
			const list = handlers["connections.list"]();
			expect(list).toHaveLength(0);
		});

		test("connections.test returns success for valid SQLite", async () => {
			const result = await handlers["connections.test"]({
				config: sqliteConfig,
			});
			expect(result.success).toBe(true);
		});

		test("connections.test returns error for invalid path", async () => {
			const result = await handlers["connections.test"]({
				config: { type: "sqlite", path: "/nonexistent/dir/impossible.db" },
			});
			expect(result.success).toBe(false);
			expect(result.error).toBeTruthy();
		});

		test("connections.connect + disconnect lifecycle", async () => {
			const conn = handlers["connections.create"]({
				name: "SQLite",
				config: sqliteConfig,
			});

			await handlers["connections.connect"]({ connectionId: conn.id });
			const listAfterConnect = handlers["connections.list"]();
			expect(listAfterConnect[0].state).toBe("connected");

			await handlers["connections.disconnect"]({ connectionId: conn.id });
			const listAfterDisconnect = handlers["connections.list"]();
			expect(listAfterDisconnect[0].state).toBe("disconnected");
		});

		test("connections.connect throws for unknown id", async () => {
			await expect(
				handlers["connections.connect"]({ connectionId: "nonexistent" }),
			).rejects.toThrow("Connection not found");
		});
	});

	// ── schema.* ─────────────────────────────────────────

	describe("schema.*", () => {
		let connectionId: string;

		beforeEach(async () => {
			const conn = handlers["connections.create"]({
				name: "SQLite Schema Test",
				config: sqliteConfig,
			});
			connectionId = conn.id;
			await handlers["connections.connect"]({ connectionId });

			// Create test table via the driver
			const driver = cm.getDriver(connectionId);
			await driver.execute(
				"CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT NOT NULL, value REAL)",
			);
			await driver.execute(
				"CREATE INDEX idx_test_name ON test_table(name)",
			);
		});

		test("schema.getSchemas returns schemas", async () => {
			const schemas = await handlers["schema.getSchemas"]({ connectionId });
			expect(schemas).toBeInstanceOf(Array);
			expect(schemas.length).toBeGreaterThan(0);
		});

		test("schema.getTables returns tables", async () => {
			const schemas = await handlers["schema.getSchemas"]({ connectionId });
			const tables = await handlers["schema.getTables"]({
				connectionId,
				schema: schemas[0].name,
			});
			expect(tables).toBeInstanceOf(Array);
			const testTable = tables.find((t) => t.name === "test_table");
			expect(testTable).toBeTruthy();
			expect(testTable!.type).toBe("table");
		});

		test("schema.getColumns returns columns for table", async () => {
			const schemas = await handlers["schema.getSchemas"]({ connectionId });
			const columns = await handlers["schema.getColumns"]({
				connectionId,
				schema: schemas[0].name,
				table: "test_table",
			});
			expect(columns).toHaveLength(3);
			const idCol = columns.find((c) => c.name === "id");
			expect(idCol).toBeTruthy();
			expect(idCol!.isPrimaryKey).toBe(true);
		});

		test("schema.getIndexes returns indexes for table", async () => {
			const schemas = await handlers["schema.getSchemas"]({ connectionId });
			const indexes = await handlers["schema.getIndexes"]({
				connectionId,
				schema: schemas[0].name,
				table: "test_table",
			});
			expect(indexes).toBeInstanceOf(Array);
			const nameIdx = indexes.find((i) => i.name === "idx_test_name");
			expect(nameIdx).toBeTruthy();
			expect(nameIdx!.columns).toContain("name");
		});

		test("schema.getForeignKeys returns empty for table without FKs", async () => {
			const schemas = await handlers["schema.getSchemas"]({ connectionId });
			const fks = await handlers["schema.getForeignKeys"]({
				connectionId,
				schema: schemas[0].name,
				table: "test_table",
			});
			expect(fks).toEqual([]);
		});

		test("schema.* throws for non-connected connection", async () => {
			await expect(
				handlers["schema.getSchemas"]({ connectionId: "nonexistent" }),
			).rejects.toThrow("No active connection");
		});
	});

	// ── data.* ───────────────────────────────────────────

	describe("data.*", () => {
		let connectionId: string;

		beforeEach(async () => {
			const conn = handlers["connections.create"]({
				name: "SQLite Data Test",
				config: sqliteConfig,
			});
			connectionId = conn.id;
			await handlers["connections.connect"]({ connectionId });

			const driver = cm.getDriver(connectionId);
			await driver.execute(
				"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)",
			);
			await driver.execute("INSERT INTO users (name, age) VALUES ('Alice', 30)");
			await driver.execute("INSERT INTO users (name, age) VALUES ('Bob', 25)");
			await driver.execute("INSERT INTO users (name, age) VALUES ('Charlie', NULL)");
		});

		test("data.getTableData returns paginated data", async () => {
			const result = await handlers["data.getTableData"]({
				connectionId,
				schema: "main",
				table: "users",
				page: 1,
				pageSize: 2,
			});
			expect(result.rows).toHaveLength(2);
			expect(result.totalRows).toBe(3);
			expect(result.page).toBe(1);
			expect(result.pageSize).toBe(2);
			expect(result.columns.length).toBeGreaterThan(0);
		});

		test("data.getTableData page 2", async () => {
			const result = await handlers["data.getTableData"]({
				connectionId,
				schema: "main",
				table: "users",
				page: 2,
				pageSize: 2,
			});
			expect(result.rows).toHaveLength(1);
			expect(result.totalRows).toBe(3);
		});

		test("data.getTableData with sort", async () => {
			const result = await handlers["data.getTableData"]({
				connectionId,
				schema: "main",
				table: "users",
				page: 1,
				pageSize: 10,
				sort: [{ column: "name", direction: "desc" }],
			});
			expect(result.rows[0].name).toBe("Charlie");
			expect(result.rows[2].name).toBe("Alice");
		});

		test("data.getTableData with filter", async () => {
			const result = await handlers["data.getTableData"]({
				connectionId,
				schema: "main",
				table: "users",
				page: 1,
				pageSize: 10,
				filters: [{ column: "age", operator: "gt", value: 26 }],
			});
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].name).toBe("Alice");
			expect(result.totalRows).toBe(1);
		});

		test("data.getTableData with isNull filter", async () => {
			const result = await handlers["data.getTableData"]({
				connectionId,
				schema: "main",
				table: "users",
				page: 1,
				pageSize: 10,
				filters: [{ column: "age", operator: "isNull", value: null }],
			});
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].name).toBe("Charlie");
		});

		test("data.getTableData columns include metadata", async () => {
			const result = await handlers["data.getTableData"]({
				connectionId,
				schema: "main",
				table: "users",
				page: 1,
				pageSize: 10,
			});
			const idCol = result.columns.find((c) => c.name === "id");
			expect(idCol).toBeTruthy();
			expect(idCol!.isPrimaryKey).toBe(true);
		});

		test("data.getRowCount returns total count", async () => {
			const result = await handlers["data.getRowCount"]({
				connectionId,
				schema: "main",
				table: "users",
			});
			expect(result.count).toBe(3);
		});

		test("data.getRowCount with filters", async () => {
			const result = await handlers["data.getRowCount"]({
				connectionId,
				schema: "main",
				table: "users",
				filters: [{ column: "age", operator: "isNotNull", value: null }],
			});
			expect(result.count).toBe(2);
		});
	});

	// ── query.* ─────────────────────────────────────────

	describe("query.*", () => {
		let connectionId: string;

		beforeEach(async () => {
			const conn = handlers["connections.create"]({
				name: "SQLite Query Test",
				config: sqliteConfig,
			});
			connectionId = conn.id;
			await handlers["connections.connect"]({ connectionId });

			const driver = cm.getDriver(connectionId);
			await driver.execute(
				"CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL)",
			);
			await driver.execute("INSERT INTO items (name, price) VALUES ('Widget', 9.99)");
			await driver.execute("INSERT INTO items (name, price) VALUES ('Gadget', 19.99)");
		});

		test("query.execute runs SQL and returns results", async () => {
			const results = await handlers["query.execute"]({
				connectionId,
				sql: "SELECT * FROM items",
				queryId: "q-1",
			});
			expect(results).toHaveLength(1);
			expect(results[0].rows).toHaveLength(2);
			expect(results[0].error).toBeUndefined();
			expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
		});

		test("query.execute multi-statement returns array", async () => {
			const results = await handlers["query.execute"]({
				connectionId,
				sql: "SELECT * FROM items WHERE id = 1; SELECT COUNT(*) AS cnt FROM items",
				queryId: "q-2",
			});
			expect(results).toHaveLength(2);
			expect(results[0].rows).toHaveLength(1);
			expect(results[0].rows[0].name).toBe("Widget");
			expect(results[1].rows[0].cnt).toBe(2);
		});

		test("query.execute returns error for invalid SQL", async () => {
			const results = await handlers["query.execute"]({
				connectionId,
				sql: "SELECT * FROM nonexistent_table",
				queryId: "q-3",
			});
			expect(results).toHaveLength(1);
			expect(results[0].error).toBeTruthy();
		});

		test("query.cancel does not throw for unknown queryId", async () => {
			await handlers["query.cancel"]({ queryId: "nonexistent" });
		});

		test("query.format formats SQL", () => {
			const result = handlers["query.format"]({
				sql: "select * from users where id = 1",
			});
			expect(result.sql).toContain("SELECT");
			expect(result.sql).toContain("FROM");
			expect(result.sql).toContain("WHERE");
			expect(result.sql).toContain("\n");
		});
	});

	// ── views.* ─────────────────────────────────────────

	describe("views.*", () => {
		let connectionId: string;

		beforeEach(() => {
			const conn = handlers["connections.create"]({
				name: "SQLite Views Test",
				config: sqliteConfig,
			});
			connectionId = conn.id;
		});

		test("views.list returns empty array initially", () => {
			const result = handlers["views.list"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
			});
			expect(result).toEqual([]);
		});

		test("views.save creates and returns a saved view", () => {
			const view = handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
				name: "Active Users",
				config: {
					columns: ["id", "name"],
					sort: [{ column: "name", direction: "asc" }],
				},
			});
			expect(view.id).toBeTruthy();
			expect(view.name).toBe("Active Users");
			expect(view.connectionId).toBe(connectionId);
			expect(view.schemaName).toBe("main");
			expect(view.tableName).toBe("users");
			expect(view.config.columns).toEqual(["id", "name"]);
			expect(view.config.sort).toEqual([{ column: "name", direction: "asc" }]);
			expect(view.createdAt).toBeTruthy();
			expect(view.updatedAt).toBeTruthy();
		});

		test("views.list returns views for a specific table", () => {
			handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
				name: "View A",
				config: {},
			});
			handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "posts",
				name: "View B",
				config: {},
			});

			const userViews = handlers["views.list"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
			});
			expect(userViews).toHaveLength(1);
			expect(userViews[0].name).toBe("View A");

			const postViews = handlers["views.list"]({
				connectionId,
				schemaName: "main",
				tableName: "posts",
			});
			expect(postViews).toHaveLength(1);
			expect(postViews[0].name).toBe("View B");
		});

		test("views.update modifies name and config", () => {
			const view = handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
				name: "Original",
				config: {},
			});

			const updated = handlers["views.update"]({
				id: view.id,
				name: "Renamed",
				config: { columns: ["email"], columnWidths: { email: 200 } },
			});
			expect(updated.name).toBe("Renamed");
			expect(updated.config.columns).toEqual(["email"]);
			expect(updated.config.columnWidths).toEqual({ email: 200 });
		});

		test("views.delete removes a view", () => {
			const view = handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
				name: "ToDelete",
				config: {},
			});
			handlers["views.delete"]({ id: view.id });

			const views = handlers["views.list"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
			});
			expect(views).toHaveLength(0);
		});

		test("views.save validates name uniqueness within table", () => {
			handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
				name: "My View",
				config: {},
			});

			expect(() =>
				handlers["views.save"]({
					connectionId,
					schemaName: "main",
					tableName: "users",
					name: "My View",
					config: {},
				}),
			).toThrow('A view named "My View" already exists for this table');
		});

		test("views.save allows same name on different tables", () => {
			handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
				name: "Default",
				config: {},
			});

			// Should not throw for different table
			const view = handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "posts",
				name: "Default",
				config: {},
			});
			expect(view.name).toBe("Default");
		});

		test("views.update validates name uniqueness excluding self", () => {
			const view1 = handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
				name: "View 1",
				config: {},
			});
			handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
				name: "View 2",
				config: {},
			});

			// Renaming to the other view's name should fail
			expect(() =>
				handlers["views.update"]({
					id: view1.id,
					name: "View 2",
					config: {},
				}),
			).toThrow('A view named "View 2" already exists for this table');

			// Keeping own name should succeed
			const updated = handlers["views.update"]({
				id: view1.id,
				name: "View 1",
				config: { columns: ["id"] },
			});
			expect(updated.config.columns).toEqual(["id"]);
		});

		test("views.save validates required fields", () => {
			expect(() =>
				handlers["views.save"]({
					connectionId,
					schemaName: "main",
					tableName: "users",
					name: "",
					config: {},
				}),
			).toThrow("View name is required");

			expect(() =>
				handlers["views.save"]({
					connectionId,
					schemaName: "main",
					tableName: "users",
					name: "   ",
					config: {},
				}),
			).toThrow("View name is required");
		});

		test("views.update validates required fields", () => {
			expect(() =>
				handlers["views.update"]({
					id: "some-id",
					name: "",
					config: {},
				}),
			).toThrow("View name is required");
		});

		test("views.save trims whitespace from name", () => {
			const view = handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
				name: "  Trimmed  ",
				config: {},
			});
			expect(view.name).toBe("Trimmed");
		});

		test("views.save serializes and deserializes config JSON", () => {
			const config = {
				columns: ["id", "name", "email"],
				sort: [{ column: "name", direction: "asc" as const }],
				filters: [{ column: "active", operator: "eq", value: true }],
				columnWidths: { id: 60, name: 200, email: 300 },
			};
			const view = handlers["views.save"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
				name: "Full Config",
				config,
			});

			// Retrieve via list to verify deserialization
			const views = handlers["views.list"]({
				connectionId,
				schemaName: "main",
				tableName: "users",
			});
			expect(views[0].config).toEqual(config);
		});
	});

	// ── history.* ────────────────────────────────────────

	describe("history.*", () => {
		let connectionId: string;
		let appDb: AppDatabase;

		beforeEach(async () => {
			({ cm, handlers } = setup());
			appDb = AppDatabase.getInstance(":memory:");
			// Re-create handlers with appDb
			handlers = createHandlers(cm, undefined, appDb);
			const conn = handlers["connections.create"]({
				name: "SQLite History Test",
				config: sqliteConfig,
			});
			connectionId = conn.id;
			await handlers["connections.connect"]({ connectionId });
		});

		test("history.list returns empty array initially", () => {
			const result = handlers["history.list"]({});
			expect(result).toEqual([]);
		});

		test("query.execute automatically logs to history", async () => {
			await handlers["query.execute"]({
				connectionId,
				sql: "SELECT 1 AS val",
				queryId: "h-1",
			});

			const history = handlers["history.list"]({});
			expect(history).toHaveLength(1);
			expect(history[0].sql).toBe("SELECT 1 AS val");
			expect(history[0].status).toBe("success");
			expect(history[0].connectionId).toBe(connectionId);
			expect(history[0].durationMs).toBeGreaterThanOrEqual(0);
			expect(history[0].rowCount).toBe(1);
		});

		test("failed queries are logged with error status", async () => {
			await handlers["query.execute"]({
				connectionId,
				sql: "SELECT * FROM nonexistent_table",
				queryId: "h-2",
			});

			const history = handlers["history.list"]({});
			expect(history).toHaveLength(1);
			expect(history[0].status).toBe("error");
			expect(history[0].errorMessage).toBeTruthy();
		});

		test("history.list filters by connectionId", async () => {
			const conn2 = handlers["connections.create"]({
				name: "SQLite Other",
				config: sqliteConfig,
			});
			await handlers["connections.connect"]({ connectionId: conn2.id });

			await handlers["query.execute"]({ connectionId, sql: "SELECT 1", queryId: "h-3" });
			await handlers["query.execute"]({ connectionId: conn2.id, sql: "SELECT 2", queryId: "h-4" });

			const filtered = handlers["history.list"]({ connectionId });
			expect(filtered).toHaveLength(1);
			expect(filtered[0].sql).toBe("SELECT 1");
		});

		test("history.list supports search", async () => {
			await handlers["query.execute"]({ connectionId, sql: "SELECT * FROM sqlite_master", queryId: "h-5" });
			await handlers["query.execute"]({ connectionId, sql: "SELECT 1", queryId: "h-6" });

			const results = handlers["history.list"]({ search: "sqlite_master" });
			expect(results).toHaveLength(1);
			expect(results[0].sql).toBe("SELECT * FROM sqlite_master");
		});

		test("history.list supports pagination", async () => {
			for (let i = 0; i < 5; i++) {
				await handlers["query.execute"]({ connectionId, sql: `SELECT ${i}`, queryId: `h-p-${i}` });
			}

			const page1 = handlers["history.list"]({ limit: 2, offset: 0 });
			expect(page1).toHaveLength(2);

			const page3 = handlers["history.list"]({ limit: 2, offset: 4 });
			expect(page3).toHaveLength(1);
		});

		test("history.clear removes all history", async () => {
			await handlers["query.execute"]({ connectionId, sql: "SELECT 1", queryId: "h-c-1" });
			await handlers["query.execute"]({ connectionId, sql: "SELECT 2", queryId: "h-c-2" });

			handlers["history.clear"]({});
			expect(handlers["history.list"]({})).toHaveLength(0);
		});

		test("history.clear with connectionId removes only that connection's history", async () => {
			const conn2 = handlers["connections.create"]({
				name: "SQLite Other2",
				config: sqliteConfig,
			});
			await handlers["connections.connect"]({ connectionId: conn2.id });

			await handlers["query.execute"]({ connectionId, sql: "SELECT 1", queryId: "h-cc-1" });
			await handlers["query.execute"]({ connectionId: conn2.id, sql: "SELECT 2", queryId: "h-cc-2" });

			handlers["history.clear"]({ connectionId });
			const remaining = handlers["history.list"]({});
			expect(remaining).toHaveLength(1);
			expect(remaining[0].connectionId).toBe(conn2.id);
		});

		test("multi-statement query is logged as single entry", async () => {
			const driver = cm.getDriver(connectionId);
			await driver.execute("CREATE TABLE test_log (id INTEGER PRIMARY KEY, val TEXT)");

			await handlers["query.execute"]({
				connectionId,
				sql: "INSERT INTO test_log (val) VALUES ('a'); SELECT * FROM test_log",
				queryId: "h-m-1",
			});

			const history = handlers["history.list"]({});
			expect(history).toHaveLength(1);
			expect(history[0].sql).toContain("INSERT INTO test_log");
			expect(history[0].sql).toContain("SELECT * FROM test_log");
			expect(history[0].status).toBe("success");
		});
	});

	// ── Stub handlers ────────────────────────────────────

	describe("stub handlers", () => {
		const stubs = [
			"data.getColumnStats",
			"tx.begin",
			"tx.commit",
			"tx.rollback",
			"tx.status",
			"settings.get",
			"settings.set",
		] as const;

		for (const method of stubs) {
			test(`${method} throws "Not implemented yet"`, () => {
				expect(() =>
					(handlers as any)[method]({}),
				).toThrow(`Not implemented yet: ${method}`);
			});
		}
	});
});
