import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { AppDatabase } from "../src/bun/storage/app-db";
import { ConnectionManager } from "../src/bun/services/connection-manager";
import { createHandlers } from "../src/bun/rpc-handlers";
import {
	generateInsert,
	generateUpdate,
	generateDelete,
	generateChangeSql,
	generateChangePreview,
	generateChangesPreview,
} from "../src/bun/services/query-executor";
import type { DataChange } from "../src/shared/types/rpc";
import type { DatabaseDriver } from "../src/bun/db/driver";
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

// ── SQL Generation Unit Tests ────────────────────────────────

describe("SQL Generation", () => {
	let cm: ConnectionManager;
	let driver: DatabaseDriver;
	let connectionId: string;

	beforeEach(async () => {
		const { cm: mgr, handlers } = setup();
		cm = mgr;
		const conn = handlers["connections.create"]({
			name: "SQLite Test",
			config: sqliteConfig,
		});
		connectionId = conn.id;
		await handlers["connections.connect"]({ connectionId });
		driver = cm.getDriver(connectionId);
	});

	afterEach(async () => {
		await cm.disconnectAll();
		AppDatabase.resetInstance();
	});

	describe("generateInsert", () => {
		test("generates INSERT with correct columns and params", () => {
			const change: DataChange = {
				type: "insert",
				schema: "main",
				table: "users",
				values: { name: "Alice", age: 30 },
			};
			const result = generateInsert(change, driver);
			expect(result.sql).toBe('INSERT INTO "users" ("name", "age") VALUES ($1, $2)');
			expect(result.params).toEqual(["Alice", 30]);
		});

		test("handles NULL values in INSERT", () => {
			const change: DataChange = {
				type: "insert",
				schema: "main",
				table: "users",
				values: { name: "Bob", age: null },
			};
			const result = generateInsert(change, driver);
			expect(result.sql).toBe('INSERT INTO "users" ("name", "age") VALUES ($1, $2)');
			expect(result.params).toEqual(["Bob", null]);
		});

		test("generates DEFAULT VALUES if no values provided", () => {
			const change: DataChange = {
				type: "insert",
				schema: "main",
				table: "users",
			};
			const result = generateInsert(change, driver);
			expect(result.sql).toBe('INSERT INTO "users" DEFAULT VALUES');
			expect(result.params).toEqual([]);
		});

		test("generates DEFAULT VALUES if values is empty", () => {
			const change: DataChange = {
				type: "insert",
				schema: "main",
				table: "users",
				values: {},
			};
			const result = generateInsert(change, driver);
			expect(result.sql).toBe('INSERT INTO "users" DEFAULT VALUES');
			expect(result.params).toEqual([]);
		});
	});

	describe("generateUpdate", () => {
		test("generates UPDATE with SET and WHERE clauses", () => {
			const change: DataChange = {
				type: "update",
				schema: "main",
				table: "users",
				primaryKeys: { id: 1 },
				values: { name: "Alice Updated", age: 31 },
			};
			const result = generateUpdate(change, driver);
			expect(result.sql).toBe(
				'UPDATE "users" SET "name" = $1, "age" = $2 WHERE "id" = $3',
			);
			expect(result.params).toEqual(["Alice Updated", 31, 1]);
		});

		test("updates only modified columns", () => {
			const change: DataChange = {
				type: "update",
				schema: "main",
				table: "users",
				primaryKeys: { id: 1 },
				values: { age: 35 },
			};
			const result = generateUpdate(change, driver);
			expect(result.sql).toBe('UPDATE "users" SET "age" = $1 WHERE "id" = $2');
			expect(result.params).toEqual([35, 1]);
		});

		test("handles composite primary key", () => {
			const change: DataChange = {
				type: "update",
				schema: "main",
				table: "user_roles",
				primaryKeys: { user_id: 1, role_id: 2 },
				values: { active: true },
			};
			const result = generateUpdate(change, driver);
			expect(result.sql).toBe(
				'UPDATE "user_roles" SET "active" = $1 WHERE "user_id" = $2 AND "role_id" = $3',
			);
			expect(result.params).toEqual([true, 1, 2]);
		});

		test("handles SET NULL", () => {
			const change: DataChange = {
				type: "update",
				schema: "main",
				table: "users",
				primaryKeys: { id: 1 },
				values: { age: null },
			};
			const result = generateUpdate(change, driver);
			expect(result.sql).toBe('UPDATE "users" SET "age" = $1 WHERE "id" = $2');
			expect(result.params).toEqual([null, 1]);
		});

		test("throws if no primaryKeys", () => {
			const change: DataChange = {
				type: "update",
				schema: "main",
				table: "users",
				values: { name: "x" },
			};
			expect(() => generateUpdate(change, driver)).toThrow("UPDATE change requires primaryKeys");
		});

		test("throws if no values", () => {
			const change: DataChange = {
				type: "update",
				schema: "main",
				table: "users",
				primaryKeys: { id: 1 },
			};
			expect(() => generateUpdate(change, driver)).toThrow("UPDATE change requires values");
		});
	});

	describe("generateDelete", () => {
		test("generates DELETE with PK WHERE clause", () => {
			const change: DataChange = {
				type: "delete",
				schema: "main",
				table: "users",
				primaryKeys: { id: 1 },
			};
			const result = generateDelete(change, driver);
			expect(result.sql).toBe('DELETE FROM "users" WHERE "id" = $1');
			expect(result.params).toEqual([1]);
		});

		test("handles composite primary key", () => {
			const change: DataChange = {
				type: "delete",
				schema: "main",
				table: "user_roles",
				primaryKeys: { user_id: 1, role_id: 2 },
			};
			const result = generateDelete(change, driver);
			expect(result.sql).toBe(
				'DELETE FROM "user_roles" WHERE "user_id" = $1 AND "role_id" = $2',
			);
			expect(result.params).toEqual([1, 2]);
		});

		test("throws if no primaryKeys", () => {
			const change: DataChange = {
				type: "delete",
				schema: "main",
				table: "users",
			};
			expect(() => generateDelete(change, driver)).toThrow("DELETE change requires primaryKeys");
		});
	});

	describe("generateChangeSql", () => {
		test("dispatches to insert", () => {
			const change: DataChange = {
				type: "insert",
				schema: "main",
				table: "users",
				values: { name: "Test" },
			};
			const result = generateChangeSql(change, driver);
			expect(result.sql).toContain("INSERT INTO");
		});

		test("dispatches to update", () => {
			const change: DataChange = {
				type: "update",
				schema: "main",
				table: "users",
				primaryKeys: { id: 1 },
				values: { name: "Test" },
			};
			const result = generateChangeSql(change, driver);
			expect(result.sql).toContain("UPDATE");
		});

		test("dispatches to delete", () => {
			const change: DataChange = {
				type: "delete",
				schema: "main",
				table: "users",
				primaryKeys: { id: 1 },
			};
			const result = generateChangeSql(change, driver);
			expect(result.sql).toContain("DELETE FROM");
		});
	});

	describe("generateChangePreview", () => {
		test("INSERT preview has inlined values", () => {
			const change: DataChange = {
				type: "insert",
				schema: "main",
				table: "users",
				values: { name: "Alice", age: 30 },
			};
			const result = generateChangePreview(change, driver);
			expect(result).toBe(`INSERT INTO "users" ("name", "age") VALUES ('Alice', 30);`);
		});

		test("INSERT preview handles NULL", () => {
			const change: DataChange = {
				type: "insert",
				schema: "main",
				table: "users",
				values: { name: "Bob", age: null },
			};
			const result = generateChangePreview(change, driver);
			expect(result).toContain("NULL");
		});

		test("UPDATE preview shows SET and WHERE", () => {
			const change: DataChange = {
				type: "update",
				schema: "main",
				table: "users",
				primaryKeys: { id: 1 },
				values: { name: "Updated" },
			};
			const result = generateChangePreview(change, driver);
			expect(result).toBe(`UPDATE "users" SET "name" = 'Updated' WHERE "id" = 1;`);
		});

		test("DELETE preview shows WHERE", () => {
			const change: DataChange = {
				type: "delete",
				schema: "main",
				table: "users",
				primaryKeys: { id: 5 },
			};
			const result = generateChangePreview(change, driver);
			expect(result).toBe(`DELETE FROM "users" WHERE "id" = 5;`);
		});

		test("preview escapes single quotes in strings", () => {
			const change: DataChange = {
				type: "insert",
				schema: "main",
				table: "users",
				values: { name: "O'Brien" },
			};
			const result = generateChangePreview(change, driver);
			expect(result).toContain("'O''Brien'");
		});
	});

	describe("generateChangesPreview", () => {
		test("combines multiple changes with newlines", () => {
			const changes: DataChange[] = [
				{ type: "insert", schema: "main", table: "users", values: { name: "New" } },
				{ type: "update", schema: "main", table: "users", primaryKeys: { id: 1 }, values: { name: "Upd" } },
				{ type: "delete", schema: "main", table: "users", primaryKeys: { id: 2 } },
			];
			const result = generateChangesPreview(changes, driver);
			const lines = result.split("\n");
			expect(lines).toHaveLength(3);
			expect(lines[0]).toContain("INSERT INTO");
			expect(lines[1]).toContain("UPDATE");
			expect(lines[2]).toContain("DELETE FROM");
		});
	});
});

// ── RPC Handler Integration Tests ────────────────────────────

describe("data.applyChanges / data.generateSql handlers", () => {
	let cm: ConnectionManager;
	let handlers: ReturnType<typeof createHandlers>;
	let connectionId: string;

	beforeEach(async () => {
		({ cm, handlers } = setup());

		const conn = handlers["connections.create"]({
			name: "SQLite Edit Test",
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

	afterEach(async () => {
		await cm.disconnectAll();
		AppDatabase.resetInstance();
	});

	test("applyChanges INSERT adds a new row", async () => {
		const result = await handlers["data.applyChanges"]({
			connectionId,
			changes: [
				{ type: "insert", schema: "main", table: "users", values: { name: "Dave", age: 40 } },
			],
		});
		expect(result.appliedCount).toBe(1);

		// Verify row exists
		const data = await handlers["data.getTableData"]({
			connectionId, schema: "main", table: "users", page: 1, pageSize: 100,
		});
		expect(data.totalRows).toBe(4);
		const dave = data.rows.find((r) => r.name === "Dave");
		expect(dave).toBeTruthy();
		expect(dave!.age).toBe(40);
	});

	test("applyChanges UPDATE modifies existing row", async () => {
		const result = await handlers["data.applyChanges"]({
			connectionId,
			changes: [
				{ type: "update", schema: "main", table: "users", primaryKeys: { id: 1 }, values: { name: "Alice Updated", age: 31 } },
			],
		});
		expect(result.appliedCount).toBe(1);

		const data = await handlers["data.getTableData"]({
			connectionId, schema: "main", table: "users", page: 1, pageSize: 100,
		});
		const alice = data.rows.find((r) => r.id === 1);
		expect(alice!.name).toBe("Alice Updated");
		expect(alice!.age).toBe(31);
	});

	test("applyChanges UPDATE only changes specified columns", async () => {
		await handlers["data.applyChanges"]({
			connectionId,
			changes: [
				{ type: "update", schema: "main", table: "users", primaryKeys: { id: 1 }, values: { age: 99 } },
			],
		});

		const data = await handlers["data.getTableData"]({
			connectionId, schema: "main", table: "users", page: 1, pageSize: 100,
		});
		const alice = data.rows.find((r) => r.id === 1);
		expect(alice!.name).toBe("Alice"); // unchanged
		expect(alice!.age).toBe(99);
	});

	test("applyChanges DELETE removes a row", async () => {
		const result = await handlers["data.applyChanges"]({
			connectionId,
			changes: [
				{ type: "delete", schema: "main", table: "users", primaryKeys: { id: 2 } },
			],
		});
		expect(result.appliedCount).toBe(1);

		const data = await handlers["data.getTableData"]({
			connectionId, schema: "main", table: "users", page: 1, pageSize: 100,
		});
		expect(data.totalRows).toBe(2);
		expect(data.rows.find((r) => r.id === 2)).toBeUndefined();
	});

	test("applyChanges SET NULL works correctly", async () => {
		await handlers["data.applyChanges"]({
			connectionId,
			changes: [
				{ type: "update", schema: "main", table: "users", primaryKeys: { id: 1 }, values: { age: null } },
			],
		});

		const data = await handlers["data.getTableData"]({
			connectionId, schema: "main", table: "users", page: 1, pageSize: 100,
		});
		const alice = data.rows.find((r) => r.id === 1);
		expect(alice!.age).toBeNull();
	});

	test("applyChanges runs multiple changes in one transaction", async () => {
		const result = await handlers["data.applyChanges"]({
			connectionId,
			changes: [
				{ type: "insert", schema: "main", table: "users", values: { name: "Dave", age: 40 } },
				{ type: "update", schema: "main", table: "users", primaryKeys: { id: 1 }, values: { name: "Alice v2" } },
				{ type: "delete", schema: "main", table: "users", primaryKeys: { id: 2 } },
			],
		});
		expect(result.appliedCount).toBe(3);

		const data = await handlers["data.getTableData"]({
			connectionId, schema: "main", table: "users", page: 1, pageSize: 100,
		});
		expect(data.totalRows).toBe(3); // 3 original + 1 insert - 1 delete
		expect(data.rows.find((r) => r.name === "Dave")).toBeTruthy();
		expect(data.rows.find((r) => r.name === "Alice v2")).toBeTruthy();
		expect(data.rows.find((r) => r.id === 2)).toBeUndefined();
	});

	test("applyChanges rolls back on error", async () => {
		await expect(
			handlers["data.applyChanges"]({
				connectionId,
				changes: [
					{ type: "insert", schema: "main", table: "users", values: { name: "Dave", age: 40 } },
					// This should fail: NOT NULL constraint on 'name'
					{ type: "insert", schema: "main", table: "users", values: { name: null as any, age: 50 } },
				],
			}),
		).rejects.toThrow();

		// Verify rollback: Dave should NOT exist
		const data = await handlers["data.getTableData"]({
			connectionId, schema: "main", table: "users", page: 1, pageSize: 100,
		});
		expect(data.totalRows).toBe(3); // original 3, no changes
		expect(data.rows.find((r) => r.name === "Dave")).toBeUndefined();
	});

	test("generateSql returns readable preview", () => {
		const result = handlers["data.generateSql"]({
			connectionId,
			changes: [
				{ type: "insert", schema: "main", table: "users", values: { name: "Dave", age: 40 } },
				{ type: "update", schema: "main", table: "users", primaryKeys: { id: 1 }, values: { name: "Updated" } },
				{ type: "delete", schema: "main", table: "users", primaryKeys: { id: 2 } },
			],
		});

		expect(result.sql).toContain("INSERT INTO");
		expect(result.sql).toContain("'Dave'");
		expect(result.sql).toContain("UPDATE");
		expect(result.sql).toContain("'Updated'");
		expect(result.sql).toContain("DELETE FROM");
		// Each statement on its own line
		expect(result.sql.split("\n")).toHaveLength(3);
	});

	test("generateSql handles NULL in preview", () => {
		const result = handlers["data.generateSql"]({
			connectionId,
			changes: [
				{ type: "update", schema: "main", table: "users", primaryKeys: { id: 1 }, values: { age: null } },
			],
		});
		expect(result.sql).toContain("NULL");
	});
});
