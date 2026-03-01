import { describe, test, expect, mock } from "bun:test";
import { parseCsv, parseJson, parseImportPreview, importData } from "../src/backend-shared/services/import-service";
import type { DatabaseDriver } from "../src/backend-shared/db/driver";
import type { QueryResult } from "../src/shared/types/query";

function makeResult(rows: Record<string, unknown>[]): QueryResult {
	const columns = rows.length > 0
		? Object.keys(rows[0]).map((name) => ({ name, dataType: "unknown" }))
		: [];
	return { columns, rows, rowCount: rows.length, durationMs: 0 };
}

function mockDriver(type: "postgresql" | "sqlite" = "postgresql"): DatabaseDriver & {
	executeCalls: { sql: string; params?: unknown[] }[];
} {
	const executeCalls: { sql: string; params?: unknown[] }[] = [];
	const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;
	let inTx = false;

	return {
		executeCalls,
		execute: mock(async (sql: string, params?: unknown[]) => {
			executeCalls.push({ sql, params });
			return makeResult([]);
		}),
		quoteIdentifier,
		getDriverType: () => type,
		qualifyTable: (schema: string, table: string) => {
			if (type === "sqlite" && schema === "main") return quoteIdentifier(table);
			return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
		},
		emptyInsertSql: (qualifiedTable: string) => `INSERT INTO ${qualifiedTable} DEFAULT VALUES`,
		placeholder: (index: number) => `$${index}`,
		beginTransaction: mock(async () => { inTx = true; }),
		commit: mock(async () => { inTx = false; }),
		rollback: mock(async () => { inTx = false; }),
		inTransaction: () => inTx,
	} as unknown as DatabaseDriver & { executeCalls: { sql: string; params?: unknown[] }[] };
}

// ── CSV Parsing ────────────────────────────────────────────

describe("parseCsv", () => {
	test("parses simple CSV with header", () => {
		const csv = "name,age,email\nAlice,30,alice@test.com\nBob,25,bob@test.com\n";
		const rows = parseCsv(csv, ",", true);

		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ name: "Alice", age: 30, email: "alice@test.com" });
		expect(rows[1]).toEqual({ name: "Bob", age: 25, email: "bob@test.com" });
	});

	test("parses CSV without header — generates col1, col2, ...", () => {
		const csv = "Alice,30\nBob,25\n";
		const rows = parseCsv(csv, ",", false);

		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ col1: "Alice", col2: 30 });
		expect(rows[1]).toEqual({ col1: "Bob", col2: 25 });
	});

	test("handles semicolon delimiter", () => {
		const csv = "name;age\nAlice;30\n";
		const rows = parseCsv(csv, ";", true);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({ name: "Alice", age: 30 });
	});

	test("handles tab delimiter", () => {
		const csv = "name\tage\nAlice\t30\n";
		const rows = parseCsv(csv, "\t", true);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({ name: "Alice", age: 30 });
	});

	test("handles quoted fields with commas", () => {
		const csv = 'name,description\nAlice,"Hello, World"\n';
		const rows = parseCsv(csv, ",", true);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({ name: "Alice", description: "Hello, World" });
	});

	test("handles escaped quotes in quoted fields", () => {
		const csv = 'name,value\nAlice,"He said ""hello"""\n';
		const rows = parseCsv(csv, ",", true);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({ name: "Alice", value: 'He said "hello"' });
	});

	test("handles newlines in quoted fields", () => {
		const csv = 'name,bio\nAlice,"Line 1\nLine 2"\n';
		const rows = parseCsv(csv, ",", true);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({ name: "Alice", bio: "Line 1\nLine 2" });
	});

	test("handles empty fields as null", () => {
		const csv = "name,age\nAlice,\n,25\n";
		const rows = parseCsv(csv, ",", true);

		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ name: "Alice", age: null });
		expect(rows[1]).toEqual({ name: null, age: 25 });
	});

	test("coerces boolean values", () => {
		const csv = "name,active\nAlice,true\nBob,false\n";
		const rows = parseCsv(csv, ",", true);

		expect(rows[0]!.active).toBe(true);
		expect(rows[1]!.active).toBe(false);
	});

	test("coerces integer values", () => {
		const csv = "name,count\nAlice,42\nBob,-7\n";
		const rows = parseCsv(csv, ",", true);

		expect(rows[0]!.count).toBe(42);
		expect(rows[1]!.count).toBe(-7);
	});

	test("coerces float values", () => {
		const csv = "name,score\nAlice,3.14\nBob,-2.5\n";
		const rows = parseCsv(csv, ",", true);

		expect(rows[0]!.score).toBe(3.14);
		expect(rows[1]!.score).toBe(-2.5);
	});

	test("handles \\r\\n line endings", () => {
		const csv = "name,age\r\nAlice,30\r\nBob,25\r\n";
		const rows = parseCsv(csv, ",", true);

		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ name: "Alice", age: 30 });
	});

	test("handles empty input", () => {
		const rows = parseCsv("", ",", true);
		expect(rows).toHaveLength(0);
	});
});

// ── JSON Parsing ───────────────────────────────────────────

describe("parseJson", () => {
	test("parses array of objects", () => {
		const json = JSON.stringify([
			{ name: "Alice", age: 30 },
			{ name: "Bob", age: 25 },
		]);
		const rows = parseJson(json);

		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ name: "Alice", age: 30 });
		expect(rows[1]).toEqual({ name: "Bob", age: 25 });
	});

	test("rejects non-array JSON", () => {
		expect(() => parseJson('{"name": "Alice"}')).toThrow("array of objects");
	});

	test("rejects array with non-object elements", () => {
		expect(() => parseJson('[1, 2, 3]')).toThrow("must be an object");
	});

	test("rejects nested arrays", () => {
		expect(() => parseJson('[[1, 2]]')).toThrow("must be an object");
	});

	test("handles empty array", () => {
		const rows = parseJson("[]");
		expect(rows).toHaveLength(0);
	});

	test("handles null values in objects", () => {
		const json = JSON.stringify([{ name: "Alice", age: null }]);
		const rows = parseJson(json);

		expect(rows[0]).toEqual({ name: "Alice", age: null });
	});
});

// ── Import Preview ─────────────────────────────────────────

describe("parseImportPreview", () => {
	test("returns file columns and preview rows", () => {
		const csv = "name,age,email\nAlice,30,a@b.com\nBob,25,b@c.com\nCharlie,35,c@d.com\n";
		const result = parseImportPreview({
			fileContent: csv,
			format: "csv",
			delimiter: ",",
			hasHeader: true,
		}, 2);

		expect(result.fileColumns).toEqual(["name", "age", "email"]);
		expect(result.rows).toHaveLength(2);
		expect(result.totalRows).toBe(3);
	});

	test("works with JSON format", () => {
		const json = JSON.stringify([
			{ id: 1, name: "Alice" },
			{ id: 2, name: "Bob" },
		]);
		const result = parseImportPreview({
			fileContent: json,
			format: "json",
		});

		expect(result.fileColumns).toEqual(["id", "name"]);
		expect(result.totalRows).toBe(2);
	});
});

// ── Import Data ────────────────────────────────────────────

describe("importData", () => {
	test("inserts CSV data with column mappings", async () => {
		const driver = mockDriver();
		const csv = "name,age\nAlice,30\nBob,25\n";

		const result = await importData(driver, {
			schema: "public",
			table: "users",
			fileContent: csv,
			format: "csv",
			delimiter: ",",
			hasHeader: true,
			mappings: [
				{ fileColumn: "name", tableColumn: "name" },
				{ fileColumn: "age", tableColumn: "age" },
			],
		});

		expect(result.rowCount).toBe(2);
		expect(driver.beginTransaction).toHaveBeenCalled();
		expect(driver.commit).toHaveBeenCalled();
		// Check that an INSERT was executed with the right params
		expect(driver.executeCalls).toHaveLength(1);
		expect(driver.executeCalls[0].sql).toContain("INSERT INTO");
		expect(driver.executeCalls[0].sql).toContain('"name"');
		expect(driver.executeCalls[0].sql).toContain('"age"');
		expect(driver.executeCalls[0].params).toEqual(["Alice", 30, "Bob", 25]);
	});

	test("skips columns with null tableColumn", async () => {
		const driver = mockDriver();
		const csv = "name,skip_me,age\nAlice,xxx,30\n";

		const result = await importData(driver, {
			schema: "public",
			table: "users",
			fileContent: csv,
			format: "csv",
			delimiter: ",",
			hasHeader: true,
			mappings: [
				{ fileColumn: "name", tableColumn: "name" },
				{ fileColumn: "skip_me", tableColumn: null },
				{ fileColumn: "age", tableColumn: "age" },
			],
		});

		expect(result.rowCount).toBe(1);
		const insertSql = driver.executeCalls[0].sql;
		expect(insertSql).not.toContain("skip_me");
		expect(driver.executeCalls[0].params).toEqual(["Alice", 30]);
	});

	test("throws when no columns are mapped", async () => {
		const driver = mockDriver();

		await expect(importData(driver, {
			schema: "public",
			table: "users",
			fileContent: "a,b\n1,2\n",
			format: "csv",
			delimiter: ",",
			hasHeader: true,
			mappings: [
				{ fileColumn: "a", tableColumn: null },
				{ fileColumn: "b", tableColumn: null },
			],
		})).rejects.toThrow("No columns mapped");
	});

	test("handles JSON import", async () => {
		const driver = mockDriver();
		const json = JSON.stringify([
			{ name: "Alice", email: "alice@test.com" },
			{ name: "Bob", email: "bob@test.com" },
		]);

		const result = await importData(driver, {
			schema: "public",
			table: "users",
			fileContent: json,
			format: "json",
			mappings: [
				{ fileColumn: "name", tableColumn: "name" },
				{ fileColumn: "email", tableColumn: "email" },
			],
		});

		expect(result.rowCount).toBe(2);
		expect(driver.executeCalls[0].params).toEqual(["Alice", "alice@test.com", "Bob", "bob@test.com"]);
	});

	test("batches INSERT statements", async () => {
		const driver = mockDriver();
		const rows = Array.from({ length: 5 }, (_, i) => `Row${i},${i}`).join("\n");
		const csv = `name,val\n${rows}\n`;

		await importData(driver, {
			schema: "public",
			table: "t",
			fileContent: csv,
			format: "csv",
			delimiter: ",",
			hasHeader: true,
			mappings: [
				{ fileColumn: "name", tableColumn: "name" },
				{ fileColumn: "val", tableColumn: "val" },
			],
			batchSize: 2,
		});

		// 5 rows with batchSize 2 → 3 INSERT statements (2, 2, 1)
		expect(driver.executeCalls).toHaveLength(3);
	});

	test("rolls back on error", async () => {
		const driver = mockDriver();
		// Make execute throw on the first call
		(driver.execute as any).mockImplementation(async () => {
			throw new Error("constraint violation");
		});

		await expect(importData(driver, {
			schema: "public",
			table: "users",
			fileContent: "name\nAlice\n",
			format: "csv",
			delimiter: ",",
			hasHeader: true,
			mappings: [{ fileColumn: "name", tableColumn: "name" }],
		})).rejects.toThrow("constraint violation");

		expect(driver.beginTransaction).toHaveBeenCalled();
		expect(driver.rollback).toHaveBeenCalled();
		expect(driver.commit).not.toHaveBeenCalled();
	});

	test("does not manage transaction if already in one", async () => {
		const driver = mockDriver();
		// Simulate already in a transaction
		await driver.beginTransaction();

		const csv = "name\nAlice\n";
		await importData(driver, {
			schema: "public",
			table: "users",
			fileContent: csv,
			format: "csv",
			delimiter: ",",
			hasHeader: true,
			mappings: [{ fileColumn: "name", tableColumn: "name" }],
		});

		// beginTransaction was called once (by us above), not again by importData
		expect(driver.beginTransaction).toHaveBeenCalledTimes(1);
		// commit should not be called by importData since we're in an existing tx
		expect(driver.commit).not.toHaveBeenCalled();
	});

	test("uses correct placeholder syntax for SQLite", async () => {
		const driver = mockDriver("sqlite");
		const csv = "name\nAlice\n";

		await importData(driver, {
			schema: "main",
			table: "users",
			fileContent: csv,
			format: "csv",
			delimiter: ",",
			hasHeader: true,
			mappings: [{ fileColumn: "name", tableColumn: "name" }],
		});

		const insertSql = driver.executeCalls[0].sql;
		// SQLite uses $1 placeholders (same as PG in our implementation)
		expect(insertSql).toContain("$1");
	});
});
