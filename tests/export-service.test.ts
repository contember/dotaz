import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { exportToFile, exportPreview } from "../src/bun/services/export-service";
import type { ExportParams } from "../src/bun/services/export-service";
import type { DatabaseDriver } from "../src/bun/db/driver";
import type { QueryResult } from "../src/shared/types/query";
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function makeResult(rows: Record<string, unknown>[]): QueryResult {
	const columns = rows.length > 0
		? Object.keys(rows[0]).map((name) => ({ name, dataType: "unknown" }))
		: [];
	return { columns, rows, rowCount: rows.length, durationMs: 0 };
}

function mockDriver(
	rows: Record<string, unknown>[],
	type: "postgresql" | "sqlite" = "postgresql",
): DatabaseDriver {
	return {
		execute: mock(async () => makeResult(rows)),
		quoteIdentifier: (name: string) => `"${name.replace(/"/g, '""')}"`,
		getDriverType: () => type,
	} as unknown as DatabaseDriver;
}

/**
 * Mock driver that returns rows in batches, simulating paginated reads.
 * First call returns `allRows`, second call returns empty (end of data).
 */
function mockDriverBatched(
	allRows: Record<string, unknown>[],
	type: "postgresql" | "sqlite" = "postgresql",
): DatabaseDriver {
	let callCount = 0;
	return {
		execute: mock(async () => {
			callCount++;
			if (callCount === 1) return makeResult(allRows);
			return makeResult([]);
		}),
		quoteIdentifier: (name: string) => `"${name.replace(/"/g, '""')}"`,
		getDriverType: () => type,
	} as unknown as DatabaseDriver;
}

const sampleRows = [
	{ id: 1, name: "Alice", age: 30 },
	{ id: 2, name: "Bob", age: 25 },
	{ id: 3, name: "Charlie", age: null },
];

const baseParams: ExportParams = {
	schema: "public",
	table: "users",
	format: "csv",
};

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "dotaz-export-"));
});

afterEach(() => {
	// Clean up temp files
	try {
		const files = new Bun.Glob("*").scanSync(tmpDir);
		for (const f of files) {
			unlinkSync(join(tmpDir, f));
		}
		rmdirSync(tmpDir);
	} catch { /* ignore cleanup errors */ }
});

// ── CSV Export ─────────────────────────────────────────────

describe("CSV export", () => {
	test("generates valid CSV with headers (comma delimiter)", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.csv");

		const result = await exportToFile(driver, { ...baseParams, format: "csv" }, filePath);

		expect(result.rowCount).toBe(3);
		expect(result.sizeBytes).toBeGreaterThan(0);

		const content = await Bun.file(filePath).text();
		const lines = content.trim().split("\n");
		expect(lines[0]).toBe("id,name,age");
		expect(lines[1]).toBe("1,Alice,30");
		expect(lines[2]).toBe("2,Bob,25");
		expect(lines[3]).toBe("3,Charlie,");
	});

	test("semicolon delimiter", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, { ...baseParams, format: "csv", delimiter: ";" }, filePath);

		const content = await Bun.file(filePath).text();
		const lines = content.trim().split("\n");
		expect(lines[0]).toBe("id;name;age");
		expect(lines[1]).toBe("1;Alice;30");
	});

	test("tab delimiter", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, { ...baseParams, format: "csv", delimiter: "\t" }, filePath);

		const content = await Bun.file(filePath).text();
		const lines = content.trim().split("\n");
		expect(lines[0]).toBe("id\tname\tage");
		expect(lines[1]).toBe("1\tAlice\t30");
	});

	test("without headers", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, { ...baseParams, format: "csv", includeHeaders: false }, filePath);

		const content = await Bun.file(filePath).text();
		const lines = content.trim().split("\n");
		expect(lines[0]).toBe("1,Alice,30");
		expect(lines).toHaveLength(3);
	});

	test("escapes fields containing delimiter", async () => {
		const rows = [{ id: 1, name: "Smith, John", age: 30 }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, { ...baseParams, format: "csv" }, filePath);

		const content = await Bun.file(filePath).text();
		const lines = content.trim().split("\n");
		expect(lines[1]).toBe('1,"Smith, John",30');
	});

	test("escapes fields containing double quotes", async () => {
		const rows = [{ id: 1, name: 'He said "hello"', age: 30 }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, { ...baseParams, format: "csv" }, filePath);

		const content = await Bun.file(filePath).text();
		const lines = content.trim().split("\n");
		expect(lines[1]).toBe('1,"He said ""hello""",30');
	});

	test("escapes fields containing newlines", async () => {
		const rows = [{ id: 1, name: "Line1\nLine2", age: 30 }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, { ...baseParams, format: "csv" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain('"Line1\nLine2"');
	});

	test("null values exported as empty string", async () => {
		const rows = [{ id: 1, name: null }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, { ...baseParams, format: "csv" }, filePath);

		const content = await Bun.file(filePath).text();
		const lines = content.trim().split("\n");
		expect(lines[1]).toBe("1,");
	});
});

// ── JSON Export ────────────────────────────────────────────

describe("JSON export", () => {
	test("generates valid JSON array", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.json");

		const result = await exportToFile(driver, { ...baseParams, format: "json" }, filePath);

		expect(result.rowCount).toBe(3);
		const content = await Bun.file(filePath).text();
		const parsed = JSON.parse(content);
		expect(parsed).toBeArray();
		expect(parsed).toHaveLength(3);
		expect(parsed[0]).toEqual({ id: 1, name: "Alice", age: 30 });
		expect(parsed[2]).toEqual({ id: 3, name: "Charlie", age: null });
	});

	test("generates valid JSON for empty result", async () => {
		const driver = mockDriverBatched([]);
		const filePath = join(tmpDir, "test.json");

		await exportToFile(driver, { ...baseParams, format: "json" }, filePath);

		const content = await Bun.file(filePath).text();
		const parsed = JSON.parse(content);
		expect(parsed).toEqual([]);
	});

	test("pretty prints with indentation", async () => {
		const rows = [{ id: 1 }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.json");

		await exportToFile(driver, { ...baseParams, format: "json" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain("[\n");
		expect(content).toContain("  ");
	});
});

// ── SQL INSERT Export ──────────────────────────────────────

describe("SQL INSERT export", () => {
	test("generates valid INSERT statements", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.sql");

		const result = await exportToFile(driver, { ...baseParams, format: "sql" }, filePath);

		expect(result.rowCount).toBe(3);
		const content = await Bun.file(filePath).text();
		expect(content).toContain('INSERT INTO "public"."users"');
		expect(content).toContain("'Alice'");
		expect(content).toContain("'Bob'");
		expect(content).toContain("NULL");
	});

	test("batches INSERT statements according to batchSize", async () => {
		const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `User${i + 1}` }));
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.sql");

		await exportToFile(driver, { ...baseParams, format: "sql", batchSize: 2 }, filePath);

		const content = await Bun.file(filePath).text();
		const insertCount = (content.match(/INSERT INTO/g) || []).length;
		expect(insertCount).toBe(3); // 2 + 2 + 1
	});

	test("escapes single quotes in values", async () => {
		const rows = [{ id: 1, name: "O'Brien" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.sql");

		await exportToFile(driver, { ...baseParams, format: "sql" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain("'O''Brien'");
	});

	test("handles boolean values", async () => {
		const rows = [{ id: 1, active: true }, { id: 2, active: false }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.sql");

		await exportToFile(driver, { ...baseParams, format: "sql" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain("TRUE");
		expect(content).toContain("FALSE");
	});

	test("SQLite main schema omits schema qualification", async () => {
		const driver = mockDriverBatched(sampleRows, "sqlite");
		const filePath = join(tmpDir, "test.sql");

		await exportToFile(driver, { ...baseParams, format: "sql", schema: "main" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain('INSERT INTO "users"');
		expect(content).not.toContain('"main"');
	});
});

// ── Preview ────────────────────────────────────────────────

describe("exportPreview", () => {
	test("returns CSV preview", async () => {
		const driver = mockDriver(sampleRows);
		const content = await exportPreview(driver, { ...baseParams, format: "csv", limit: 10 });

		const lines = content.trim().split("\n");
		expect(lines[0]).toBe("id,name,age");
		expect(lines).toHaveLength(4); // header + 3 rows
	});

	test("returns JSON preview", async () => {
		const driver = mockDriver(sampleRows);
		const content = await exportPreview(driver, { ...baseParams, format: "json", limit: 10 });

		const parsed = JSON.parse(content);
		expect(parsed).toHaveLength(3);
	});

	test("returns SQL preview", async () => {
		const driver = mockDriver(sampleRows);
		const content = await exportPreview(driver, { ...baseParams, format: "sql", limit: 10 });

		expect(content).toContain("INSERT INTO");
	});

	test("respects limit parameter", async () => {
		const driver = mockDriver(sampleRows);
		await exportPreview(driver, { ...baseParams, format: "csv", limit: 5 });

		// Verify the query was called with the limit
		expect(driver.execute).toHaveBeenCalledTimes(1);
		const callArgs = (driver.execute as any).mock.calls[0];
		const sql = callArgs[0] as string;
		expect(sql).toContain("LIMIT");
	});
});

// ── Filters and Sort ───────────────────────────────────────

describe("filters and sort", () => {
	test("passes filters to query", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, {
			...baseParams,
			format: "csv",
			filters: [{ column: "age", operator: "gt", value: 20 }],
		}, filePath);

		const callArgs = (driver.execute as any).mock.calls[0];
		const sql = callArgs[0] as string;
		expect(sql).toContain("WHERE");
		expect(sql).toContain('"age" > $1');
	});

	test("passes sort to query", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, {
			...baseParams,
			format: "csv",
			sort: [{ column: "name", direction: "asc" }],
		}, filePath);

		const callArgs = (driver.execute as any).mock.calls[0];
		const sql = callArgs[0] as string;
		expect(sql).toContain('ORDER BY "name" ASC');
	});

	test("passes both filters and sort", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, {
			...baseParams,
			format: "csv",
			filters: [{ column: "age", operator: "gte", value: 18 }],
			sort: [{ column: "id", direction: "desc" }],
		}, filePath);

		const callArgs = (driver.execute as any).mock.calls[0];
		const sql = callArgs[0] as string;
		expect(sql).toContain("WHERE");
		expect(sql).toContain("ORDER BY");
	});
});

// ── Column Selection ───────────────────────────────────────

describe("column selection", () => {
	test("exports only selected columns in query", async () => {
		const rows = [{ id: 1, name: "Alice" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, {
			...baseParams,
			format: "csv",
			columns: ["id", "name"],
		}, filePath);

		const callArgs = (driver.execute as any).mock.calls[0];
		const sql = callArgs[0] as string;
		expect(sql).toContain('"id", "name"');
		expect(sql).not.toContain("*");
	});

	test("uses SELECT * when no columns specified", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, { ...baseParams, format: "csv" }, filePath);

		const callArgs = (driver.execute as any).mock.calls[0];
		const sql = callArgs[0] as string;
		expect(sql).toContain("SELECT *");
	});
});

// ── Row Limit ──────────────────────────────────────────────

describe("row limit", () => {
	test("respects limit option in export", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.csv");

		const result = await exportToFile(driver, {
			...baseParams,
			format: "csv",
			limit: 2,
		}, filePath);

		// The query fetches batchLimit = min(1000, 2) = 2
		const callArgs = (driver.execute as any).mock.calls[0];
		const params = callArgs[1] as unknown[];
		// limit param is the second to last
		expect(params).toContain(2);
	});
});

// ── Empty dataset ──────────────────────────────────────────

describe("empty dataset", () => {
	test("CSV export produces only header for empty data", async () => {
		const driver = mockDriverBatched([]);
		const filePath = join(tmpDir, "test.csv");

		const result = await exportToFile(driver, { ...baseParams, format: "csv" }, filePath);

		expect(result.rowCount).toBe(0);
	});

	test("JSON export produces empty array for empty data", async () => {
		const driver = mockDriverBatched([]);
		const filePath = join(tmpDir, "test.json");

		await exportToFile(driver, { ...baseParams, format: "json" }, filePath);

		const content = await Bun.file(filePath).text();
		const parsed = JSON.parse(content);
		expect(parsed).toEqual([]);
	});
});
