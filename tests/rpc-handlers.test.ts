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
	const handlers = createHandlers(cm);
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

	// ── Stub handlers ────────────────────────────────────

	describe("stub handlers", () => {
		const stubs = [
			"data.getColumnStats",
			"data.applyChanges",
			"data.generateSql",
			"query.execute",
			"query.cancel",
			"query.format",
			"tx.begin",
			"tx.commit",
			"tx.rollback",
			"tx.status",
			"export.exportData",
			"export.preview",
			"history.list",
			"history.clear",
			"views.list",
			"views.save",
			"views.update",
			"views.delete",
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
