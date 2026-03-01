/**
 * Tests for SqliteDriver — validates the DatabaseDriver interface
 * implementation for SQLite using Bun.SQL.
 *
 * Run: bun test tests/sqlite-driver.test.ts
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SqliteDriver } from "../src/backend-shared/drivers/sqlite-driver";
import { DatabaseDataType } from "../src/shared/types/database";

let driver: SqliteDriver;

async function seedTestData(d: SqliteDriver) {
	await d.execute(`
		CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			email TEXT UNIQUE NOT NULL,
			age INTEGER,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);
	await d.execute(`
		CREATE TABLE posts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id),
			title TEXT NOT NULL,
			body TEXT,
			published INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);
	await d.execute(
		`CREATE INDEX idx_posts_user_id ON posts(user_id)`,
	);
	await d.execute(`
		INSERT INTO users (name, email, age) VALUES
		('Alice', 'alice@example.com', 30),
		('Bob', 'bob@example.com', 25),
		('Charlie', 'charlie@example.com', NULL)
	`);
	await d.execute(`
		INSERT INTO posts (user_id, title, body, published) VALUES
		(1, 'Hello World', 'First post content', 1),
		(1, 'Draft Post', NULL, 0),
		(2, 'Bobs Post', 'Some content here', 1)
	`);
}

beforeEach(async () => {
	driver = new SqliteDriver();
	await driver.connect({ type: "sqlite", path: ":memory:" });
	await seedTestData(driver);
});

afterEach(async () => {
	if (driver.isConnected()) {
		await driver.disconnect();
	}
});

describe("SqliteDriver lifecycle", () => {
	test("connect sets isConnected to true", () => {
		expect(driver.isConnected()).toBe(true);
	});

	test("disconnect sets isConnected to false", async () => {
		await driver.disconnect();
		expect(driver.isConnected()).toBe(false);
	});

	test("rejects non-sqlite config", async () => {
		const d = new SqliteDriver();
		await expect(
			d.connect({
				type: "postgresql",
				host: "localhost",
				port: 5432,
				database: "test",
				user: "test",
				password: "test",
			}),
		).rejects.toThrow("SqliteDriver requires a sqlite connection config");
	});

	test("throws when executing without connection", async () => {
		const d = new SqliteDriver();
		await expect(d.execute("SELECT 1")).rejects.toThrow("Not connected");
	});

	test("disconnect is idempotent", async () => {
		await driver.disconnect();
		await driver.disconnect(); // should not throw
		expect(driver.isConnected()).toBe(false);
	});
});

describe("SqliteDriver metadata", () => {
	test("getDriverType returns sqlite", () => {
		expect(driver.getDriverType()).toBe("sqlite");
	});

	test("quoteIdentifier wraps in double quotes", () => {
		expect(driver.quoteIdentifier("users")).toBe('"users"');
	});

	test("quoteIdentifier escapes internal double quotes", () => {
		expect(driver.quoteIdentifier('my"table')).toBe('"my""table"');
	});
});

describe("SqliteDriver execute", () => {
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
		expect(result.rows[0]).toEqual({
			id: 1,
			name: "Alice",
			email: "alice@example.com",
		});
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("SELECT with params", async () => {
		const result = await driver.execute(
			"SELECT * FROM users WHERE email = ?",
			["alice@example.com"],
		);
		expect(result.rowCount).toBe(1);
		expect(result.rows[0].name).toBe("Alice");
	});

	test("INSERT returns affectedRows", async () => {
		const result = await driver.execute(
			"INSERT INTO users (name, email, age) VALUES (?, ?, ?)",
			["Dave", "dave@example.com", 40],
		);
		expect(result.rowCount).toBe(0);
		expect(result.affectedRows).toBe(1);
	});

	test("UPDATE returns affectedRows", async () => {
		const result = await driver.execute(
			"UPDATE users SET age = 99 WHERE age IS NOT NULL",
		);
		expect(result.affectedRows).toBe(2);
	});

	test("DELETE returns affectedRows", async () => {
		const result = await driver.execute(
			"DELETE FROM posts WHERE published = 0",
		);
		expect(result.affectedRows).toBe(1);
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
});

describe("SqliteDriver loadSchema", () => {
	test("returns schemas with main", async () => {
		const data = await driver.loadSchema();
		expect(data.schemas).toEqual([{ name: "main" }]);
	});

	test("returns all tables", async () => {
		const data = await driver.loadSchema();
		const names = data.tables["main"].map((t) => t.name);
		expect(names).toContain("users");
		expect(names).toContain("posts");
		expect(data.tables["main"].every((t) => t.schema === "main")).toBe(true);
		expect(data.tables["main"].every((t) => t.type === "table")).toBe(true);
	});

	test("excludes sqlite internal tables", async () => {
		const data = await driver.loadSchema();
		const names = data.tables["main"].map((t) => t.name);
		expect(names.some((n) => n.startsWith("sqlite_"))).toBe(false);
	});

	test("includes views", async () => {
		await driver.execute(
			"CREATE VIEW active_users AS SELECT * FROM users WHERE age IS NOT NULL",
		);
		const data = await driver.loadSchema();
		const view = data.tables["main"].find((t) => t.name === "active_users");
		expect(view).toBeDefined();
		expect(view!.type).toBe("view");
	});

	test("returns correct column info", async () => {
		const data = await driver.loadSchema();
		const columns = data.columns["main.users"];
		expect(columns).toHaveLength(5);

		const idCol = columns.find((c) => c.name === "id")!;
		expect(idCol.dataType).toBe(DatabaseDataType.Integer);
		expect(idCol.isPrimaryKey).toBe(true);
		expect(idCol.isAutoIncrement).toBe(true);
		expect(idCol.nullable).toBe(false);

		const nameCol = columns.find((c) => c.name === "name")!;
		expect(nameCol.dataType).toBe(DatabaseDataType.Text);
		expect(nameCol.isPrimaryKey).toBe(false);
		expect(nameCol.isAutoIncrement).toBe(false);
		expect(nameCol.nullable).toBe(false);

		const ageCol = columns.find((c) => c.name === "age")!;
		expect(ageCol.dataType).toBe(DatabaseDataType.Integer);
		expect(ageCol.nullable).toBe(true);

		const createdCol = columns.find((c) => c.name === "created_at")!;
		expect(createdCol.defaultValue).toBe("datetime('now')");
	});

	test("detects composite PK as non-autoincrement", async () => {
		await driver.execute(`
			CREATE TABLE composite_pk (
				a INTEGER NOT NULL,
				b INTEGER NOT NULL,
				value TEXT,
				PRIMARY KEY (a, b)
			)
		`);
		const data = await driver.loadSchema();
		const columns = data.columns["main.composite_pk"];
		const colA = columns.find((c) => c.name === "a")!;
		expect(colA.isPrimaryKey).toBe(true);
		expect(colA.isAutoIncrement).toBe(false);
		const colB = columns.find((c) => c.name === "b")!;
		expect(colB.isPrimaryKey).toBe(true);
		expect(colB.isAutoIncrement).toBe(false);
	});

	test("returns indexes", async () => {
		const data = await driver.loadSchema();
		const indexes = data.indexes["main.posts"];
		const byName = indexes.find((i) => i.name === "idx_posts_user_id");
		expect(byName).toBeDefined();
		expect(byName!.columns).toEqual(["user_id"]);
		expect(byName!.isUnique).toBe(false);
		expect(byName!.isPrimary).toBe(false);
	});

	test("detects unique indexes", async () => {
		const data = await driver.loadSchema();
		const indexes = data.indexes["main.users"];
		const uniqueIdx = indexes.find((i) => i.isUnique);
		expect(uniqueIdx).toBeDefined();
		expect(uniqueIdx!.columns).toContain("email");
	});

	test("returns FK info", async () => {
		const data = await driver.loadSchema();
		const fks = data.foreignKeys["main.posts"];
		expect(fks).toHaveLength(1);
		expect(fks[0].columns).toEqual(["user_id"]);
		expect(fks[0].referencedTable).toBe("users");
		expect(fks[0].referencedColumns).toEqual(["id"]);
		expect(fks[0].referencedSchema).toBe("main");
		expect(fks[0].onUpdate).toBe("NO ACTION");
		expect(fks[0].onDelete).toBe("NO ACTION");
	});

	test("groups multi-column FKs", async () => {
		await driver.execute(`
			CREATE TABLE ref_target (a INTEGER, b INTEGER, PRIMARY KEY (a, b))
		`);
		await driver.execute(`
			CREATE TABLE ref_source (
				x INTEGER,
				y INTEGER,
				FOREIGN KEY (x, y) REFERENCES ref_target(a, b)
			)
		`);
		const data = await driver.loadSchema();
		const fks = data.foreignKeys["main.ref_source"];
		expect(fks).toHaveLength(1);
		expect(fks[0].columns).toEqual(["x", "y"]);
		expect(fks[0].referencedColumns).toEqual(["a", "b"]);
	});

	test("returns referencing foreign keys", async () => {
		const data = await driver.loadSchema();
		const refs = data.referencingForeignKeys["main.users"];
		expect(refs).toHaveLength(1);
		expect(refs[0].referencingTable).toBe("posts");
		expect(refs[0].referencingColumns).toEqual(["user_id"]);
		expect(refs[0].referencedColumns).toEqual(["id"]);
		expect(refs[0].referencingSchema).toBe("main");
	});

	test("returns empty referencing FKs for unreferenced table", async () => {
		const data = await driver.loadSchema();
		expect(data.referencingForeignKeys["main.posts"]).toEqual([]);
	});

	test("handles composite referencing FKs", async () => {
		await driver.execute(`
			CREATE TABLE ref_target2 (a INTEGER, b INTEGER, PRIMARY KEY (a, b))
		`);
		await driver.execute(`
			CREATE TABLE ref_source2 (
				x INTEGER,
				y INTEGER,
				FOREIGN KEY (x, y) REFERENCES ref_target2(a, b)
			)
		`);
		const data = await driver.loadSchema();
		const refs = data.referencingForeignKeys["main.ref_target2"];
		expect(refs).toHaveLength(1);
		expect(refs[0].referencingTable).toBe("ref_source2");
		expect(refs[0].referencingColumns).toEqual(["x", "y"]);
		expect(refs[0].referencedColumns).toEqual(["a", "b"]);
	});

	test("handles multiple child tables", async () => {
		await driver.execute(`
			CREATE TABLE comments (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL REFERENCES users(id),
				body TEXT NOT NULL
			)
		`);
		const data = await driver.loadSchema();
		const refs = data.referencingForeignKeys["main.users"];
		expect(refs.length).toBe(2);
		const tableNames = refs.map((r) => r.referencingTable).sort();
		expect(tableNames).toEqual(["comments", "posts"]);
	});
});

describe("SqliteDriver transactions", () => {
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

describe("SqliteDriver isolation", () => {
	test("two separate drivers have independent data", async () => {
		const driver2 = new SqliteDriver();
		await driver2.connect({ type: "sqlite", path: ":memory:" });
		await seedTestData(driver2);

		// Modify data in driver1
		await driver.execute("DELETE FROM users WHERE name = 'Charlie'");

		// driver2 should still have Charlie
		const result = await driver2.execute(
			"SELECT * FROM users WHERE name = 'Charlie'",
		);
		expect(result.rowCount).toBe(1);

		await driver2.disconnect();
	});
});
