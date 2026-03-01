/**
 * Tests for MysqlDriver — validates the DatabaseDriver interface
 * implementation for MySQL/MariaDB using Bun.SQL.
 *
 * Requires docker-compose MariaDB container:
 *   docker compose up -d
 *
 * Run: bun test tests/mysql-driver.test.ts
 */
import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { MysqlDriver } from "../src/bun/db/mysql-driver";
import type { MysqlConnectionConfig } from "../src/shared/types/connection";
import { MYSQL_URL, seedMysql } from "./helpers";

const config: MysqlConnectionConfig = {
	type: "mysql",
	host: "localhost",
	port: 3388,
	database: "dotaz_test",
	user: "dotaz",
	password: "dotaz",
};

let driver: MysqlDriver;

beforeAll(async () => {
	await seedMysql();
});

beforeEach(async () => {
	driver = new MysqlDriver();
	await driver.connect(config);
});

afterEach(async () => {
	if (driver.isConnected()) {
		await driver.disconnect();
	}
});

describe("MysqlDriver lifecycle", () => {
	test("connect sets isConnected to true", () => {
		expect(driver.isConnected()).toBe(true);
	});

	test("disconnect sets isConnected to false", async () => {
		await driver.disconnect();
		expect(driver.isConnected()).toBe(false);
	});

	test("rejects non-mysql config", async () => {
		const d = new MysqlDriver();
		await expect(
			d.connect({
				type: "sqlite",
				path: ":memory:",
			}),
		).rejects.toThrow("MysqlDriver requires a mysql connection config");
	});

	test("throws when executing without connection", async () => {
		const d = new MysqlDriver();
		await expect(d.execute("SELECT 1")).rejects.toThrow("Not connected");
	});

	test("disconnect is idempotent", async () => {
		await driver.disconnect();
		await driver.disconnect(); // should not throw
		expect(driver.isConnected()).toBe(false);
	});
});

describe("MysqlDriver metadata", () => {
	test("getDriverType returns mysql", () => {
		expect(driver.getDriverType()).toBe("mysql");
	});

	test("quoteIdentifier wraps in backticks", () => {
		expect(driver.quoteIdentifier("users")).toBe("`users`");
	});

	test("quoteIdentifier escapes internal backticks", () => {
		expect(driver.quoteIdentifier("my`table")).toBe("`my``table`");
	});

	test("qualifyTable returns schema.table", () => {
		expect(driver.qualifyTable("dotaz_test", "users")).toBe("`dotaz_test`.`users`");
	});

	test("emptyInsertSql returns () VALUES ()", () => {
		expect(driver.emptyInsertSql("`users`")).toBe("INSERT INTO `users` () VALUES ()");
	});
});

describe("MysqlDriver execute", () => {
	test("SELECT returns rows with columns", async () => {
		const result = await driver.execute(
			"SELECT id, name, email FROM users ORDER BY id",
		);
		expect(result.rowCount).toBe(3);
		expect(result.rows).toHaveLength(3);
		expect(result.columns).toHaveLength(3);
		expect(result.columns.map((c) => c.name)).toEqual([
			"id",
			"name",
			"email",
		]);
		expect(result.rows[0]).toMatchObject({
			id: 1,
			name: "Alice",
			email: "alice@example.com",
		});
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("SELECT with params", async () => {
		const result = await driver.execute(
			"SELECT * FROM users WHERE email = $1",
			["alice@example.com"],
		);
		expect(result.rowCount).toBe(1);
		expect(result.rows[0].name).toBe("Alice");
	});

	test("INSERT returns affectedRows", async () => {
		const result = await driver.execute(
			"INSERT INTO users (name, email, age) VALUES ($1, $2, $3)",
			["Dave", "dave@example.com", 40],
		);
		expect(result.affectedRows).toBe(1);
		// cleanup
		await driver.execute(
			"DELETE FROM users WHERE email = $1",
			["dave@example.com"],
		);
	});

	test("UPDATE returns affectedRows", async () => {
		await driver.beginTransaction();
		const result = await driver.execute(
			"UPDATE users SET age = 99 WHERE age IS NOT NULL",
		);
		expect(result.affectedRows).toBe(2);
		await driver.rollback();
	});

	test("DELETE returns affectedRows", async () => {
		await driver.beginTransaction();
		const result = await driver.execute(
			"DELETE FROM posts WHERE published = false",
		);
		expect(result.affectedRows).toBe(1);
		await driver.rollback();
	});

	test("empty SELECT returns empty columns and rows", async () => {
		const result = await driver.execute(
			"SELECT * FROM users WHERE 1 = 0",
		);
		expect(result.rowCount).toBe(0);
		expect(result.rows).toEqual([]);
		expect(result.columns).toEqual([]);
	});

	test("NULL values are preserved", async () => {
		const result = await driver.execute(
			"SELECT age FROM users WHERE name = 'Charlie'",
		);
		expect(result.rows[0].age).toBeNull();
	});

	test("throws on invalid SQL", async () => {
		await expect(
			driver.execute("SELECT * FROM nonexistent_table"),
		).rejects.toThrow();
	});

	test("JSON values are returned", async () => {
		const result = await driver.execute(
			"SELECT metadata FROM users WHERE name = 'Alice'",
		);
		// MySQL/MariaDB may return JSON as parsed object or string
		const meta = result.rows[0].metadata;
		const parsed = typeof meta === "string" ? JSON.parse(meta) : meta;
		expect(parsed).toEqual({ role: "admin" });
	});

	test("timestamp values are returned", async () => {
		const result = await driver.execute(
			"SELECT created_at FROM users WHERE name = 'Alice'",
		);
		expect(result.rows[0].created_at).toBeDefined();
	});
});

describe("MysqlDriver query cancellation", () => {
	test("cancel does not throw when no query is active", async () => {
		await expect(driver.cancel()).resolves.toBeUndefined();
	});
});

describe("MysqlDriver schema introspection", () => {
	test("getSchemas returns current database", async () => {
		const schemas = await driver.getSchemas();
		expect(schemas).toHaveLength(1);
		expect(schemas[0].name).toBe("dotaz_test");
	});

	test("getTables returns tables in database", async () => {
		const tables = await driver.getTables("dotaz_test");
		const names = tables.map((t) => t.name);
		expect(names).toContain("users");
		expect(names).toContain("posts");
		expect(tables.every((t) => t.schema === "dotaz_test")).toBe(true);
		expect(tables.every((t) => t.type === "table")).toBe(true);
	});

	test("getTables includes views", async () => {
		await driver.execute(
			"CREATE OR REPLACE VIEW active_users AS SELECT * FROM users WHERE age IS NOT NULL",
		);
		const tables = await driver.getTables("dotaz_test");
		const view = tables.find((t) => t.name === "active_users");
		expect(view).toBeDefined();
		expect(view!.type).toBe("view");
		await driver.execute("DROP VIEW active_users");
	});

	test("getColumns returns correct column info", async () => {
		const columns = await driver.getColumns("dotaz_test", "users");
		expect(columns.length).toBeGreaterThanOrEqual(5);

		const idCol = columns.find((c) => c.name === "id")!;
		expect(idCol.isPrimaryKey).toBe(true);
		expect(idCol.isAutoIncrement).toBe(true);
		expect(idCol.nullable).toBe(false);

		const nameCol = columns.find((c) => c.name === "name")!;
		expect(nameCol.isPrimaryKey).toBe(false);
		expect(nameCol.isAutoIncrement).toBe(false);
		expect(nameCol.nullable).toBe(false);

		const ageCol = columns.find((c) => c.name === "age")!;
		expect(ageCol.nullable).toBe(true);
	});

	test("getIndexes returns indexes", async () => {
		const indexes = await driver.getIndexes("dotaz_test", "posts");
		const byName = indexes.find((i) => i.name === "idx_posts_user_id");
		expect(byName).toBeDefined();
		expect(byName!.columns).toEqual(["user_id"]);
		expect(byName!.isUnique).toBe(false);
		expect(byName!.isPrimary).toBe(false);
	});

	test("getIndexes detects unique indexes", async () => {
		const indexes = await driver.getIndexes("dotaz_test", "users");
		const uniqueIdx = indexes.find(
			(i) => i.isUnique && !i.isPrimary,
		);
		expect(uniqueIdx).toBeDefined();
		expect(uniqueIdx!.columns).toContain("email");
	});

	test("getIndexes detects primary key index", async () => {
		const indexes = await driver.getIndexes("dotaz_test", "users");
		const pkIdx = indexes.find((i) => i.isPrimary);
		expect(pkIdx).toBeDefined();
		expect(pkIdx!.columns).toContain("id");
		expect(pkIdx!.isUnique).toBe(true);
	});

	test("getForeignKeys returns FK info", async () => {
		const fks = await driver.getForeignKeys("dotaz_test", "posts");
		expect(fks).toHaveLength(1);
		expect(fks[0].columns).toEqual(["user_id"]);
		expect(fks[0].referencedTable).toBe("users");
		expect(fks[0].referencedColumns).toEqual(["id"]);
		expect(fks[0].referencedSchema).toBe("dotaz_test");
	});

	test("getPrimaryKey returns PK columns", async () => {
		const pk = await driver.getPrimaryKey("dotaz_test", "users");
		expect(pk).toEqual(["id"]);
	});

	test("getPrimaryKey handles composite PKs", async () => {
		await driver.execute("DROP TABLE IF EXISTS composite_pk");
		await driver.execute(`
			CREATE TABLE composite_pk (
				first_id INT, second_id INT,
				PRIMARY KEY (first_id, second_id)
			)
		`);
		const pk = await driver.getPrimaryKey("dotaz_test", "composite_pk");
		expect(pk).toEqual(["first_id", "second_id"]);
		await driver.execute("DROP TABLE composite_pk");
	});

	test("getPrimaryKey returns empty for table without PK", async () => {
		await driver.execute("DROP TABLE IF EXISTS no_pk");
		await driver.execute(
			"CREATE TABLE no_pk (a TEXT, b TEXT)",
		);
		const pk = await driver.getPrimaryKey("dotaz_test", "no_pk");
		expect(pk).toEqual([]);
		await driver.execute("DROP TABLE no_pk");
	});
});

describe("MysqlDriver transactions", () => {
	test("inTransaction is false by default", () => {
		expect(driver.inTransaction()).toBe(false);
	});

	test("beginTransaction sets inTransaction", async () => {
		await driver.beginTransaction();
		expect(driver.inTransaction()).toBe(true);
		await driver.rollback();
	});

	test("commit clears inTransaction", async () => {
		await driver.beginTransaction();
		await driver.commit();
		expect(driver.inTransaction()).toBe(false);
	});

	test("rollback clears inTransaction", async () => {
		await driver.beginTransaction();
		await driver.rollback();
		expect(driver.inTransaction()).toBe(false);
	});

	test("commit persists changes", async () => {
		await driver.beginTransaction();
		await driver.execute(
			"INSERT INTO users (name, email, age) VALUES ('TxUser', 'tx@example.com', 50)",
		);
		await driver.commit();

		const result = await driver.execute(
			"SELECT * FROM users WHERE email = 'tx@example.com'",
		);
		expect(result.rowCount).toBe(1);

		// cleanup
		await driver.execute(
			"DELETE FROM users WHERE email = 'tx@example.com'",
		);
	});

	test("rollback discards changes", async () => {
		await driver.beginTransaction();
		await driver.execute(
			"INSERT INTO users (name, email, age) VALUES ('TxUser2', 'tx2@example.com', 50)",
		);
		await driver.rollback();

		const result = await driver.execute(
			"SELECT * FROM users WHERE email = 'tx2@example.com'",
		);
		expect(result.rowCount).toBe(0);
	});
});
