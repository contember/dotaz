import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { exportToFile, exportPreview } from "../src/backend-shared/services/export-service";
import type { ExportParams } from "../src/backend-shared/services/export-service";
import type { DatabaseDriver } from "../src/backend-shared/db/driver";
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
	const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;
	return {
		execute: mock(async () => makeResult(rows)),
		quoteIdentifier,
		getDriverType: () => type,
		qualifyTable: (schema: string, table: string) => {
			if (type === "sqlite" && schema === "main") return quoteIdentifier(table);
			return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
		},
		emptyInsertSql: (qualifiedTable: string) => `INSERT INTO ${qualifiedTable} DEFAULT VALUES`,
		placeholder: (index: number) => `$${index}`,
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
	const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;
	return {
		execute: mock(async () => {
			callCount++;
			if (callCount === 1) return makeResult(allRows);
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

// ── CSV Encoding ──────────────────────────────────────────

describe("CSV encoding", () => {
	test("default encoding is UTF-8", async () => {
		const rows = [{ id: 1, name: "Ñoño" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, { ...baseParams, format: "csv" }, filePath);

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
		// UTF-8 encoding of Ñ is 0xC3 0x91
		const content = new TextDecoder("utf-8").decode(bytes);
		expect(content).toContain("Ñoño");
	});

	test("UTF-8 with BOM", async () => {
		const rows = [{ id: 1, name: "Alice" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, {
			...baseParams, format: "csv", encoding: "utf-8", utf8Bom: true,
		}, filePath);

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
		// BOM bytes: 0xEF 0xBB 0xBF
		expect(bytes[0]).toBe(0xEF);
		expect(bytes[1]).toBe(0xBB);
		expect(bytes[2]).toBe(0xBF);
	});

	test("UTF-8 without BOM by default", async () => {
		const rows = [{ id: 1, name: "Alice" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, {
			...baseParams, format: "csv", encoding: "utf-8",
		}, filePath);

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
		// No BOM — first byte should be 'i' (from "id" header)
		expect(bytes[0]).toBe(0x69); // 'i'
	});

	test("ISO-8859-1 encoding for Latin characters", async () => {
		const rows = [{ id: 1, name: "café" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, {
			...baseParams, format: "csv", encoding: "iso-8859-1",
		}, filePath);

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
		const content = new TextDecoder("iso-8859-1").decode(bytes);
		expect(content).toContain("café");
		// Verify é is encoded as single byte 0xE9 in ISO-8859-1
		const dataLine = content.split("\n")[1];
		expect(dataLine).toBe("1,café");
	});

	test("Windows-1252 encoding with special characters", async () => {
		// € is U+20AC, which maps to 0x80 in Windows-1252
		const rows = [{ id: 1, price: "€100" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, {
			...baseParams, format: "csv", encoding: "windows-1252",
		}, filePath);

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
		const content = new TextDecoder("windows-1252").decode(bytes);
		expect(content).toContain("€100");
	});

	test("ISO-8859-1 replaces unmappable characters with ?", async () => {
		// € (U+20AC) cannot be represented in ISO-8859-1
		const rows = [{ id: 1, price: "€50" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, {
			...baseParams, format: "csv", encoding: "iso-8859-1",
		}, filePath);

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
		const content = new TextDecoder("iso-8859-1").decode(bytes);
		expect(content).toContain("?50");
	});

	test("BOM is not included for non-UTF-8 encodings", async () => {
		const rows = [{ id: 1, name: "test" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.csv");

		await exportToFile(driver, {
			...baseParams, format: "csv", encoding: "iso-8859-1", utf8Bom: true,
		}, filePath);

		const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
		// Should NOT start with BOM
		expect(bytes[0]).not.toBe(0xEF);
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

// ── Markdown Export ────────────────────────────────────────

describe("Markdown export", () => {
	test("generates valid Markdown table with header and separator", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.md");

		const result = await exportToFile(driver, { ...baseParams, format: "markdown" }, filePath);

		expect(result.rowCount).toBe(3);
		const content = await Bun.file(filePath).text();
		const lines = content.trim().split("\n");
		expect(lines[0]).toBe("| id | name | age |");
		expect(lines[1]).toBe("| --- | --- | --- |");
		expect(lines[2]).toBe("| 1 | Alice | 30 |");
		expect(lines[3]).toBe("| 2 | Bob | 25 |");
		expect(lines[4]).toBe("| 3 | Charlie | NULL |");
	});

	test("escapes pipe characters in values", async () => {
		const rows = [{ id: 1, name: "foo|bar" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.md");

		await exportToFile(driver, { ...baseParams, format: "markdown" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain("foo\\|bar");
	});

	test("replaces newlines with spaces in values", async () => {
		const rows = [{ id: 1, name: "Line1\nLine2" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.md");

		await exportToFile(driver, { ...baseParams, format: "markdown" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain("Line1 Line2");
	});

	test("handles empty dataset", async () => {
		const driver = mockDriverBatched([]);
		const filePath = join(tmpDir, "test.md");

		const result = await exportToFile(driver, { ...baseParams, format: "markdown" }, filePath);
		expect(result.rowCount).toBe(0);
	});

	test("preview returns Markdown", async () => {
		const driver = mockDriver(sampleRows);
		const content = await exportPreview(driver, { ...baseParams, format: "markdown", limit: 10 });

		expect(content).toContain("| id | name | age |");
		expect(content).toContain("| --- | --- | --- |");
		expect(content).toContain("| 1 | Alice | 30 |");
	});
});

// ── SQL UPDATE Export ──────────────────────────────────────

describe("SQL UPDATE export", () => {
	test("generates UPDATE statements with first column as PK", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.sql");

		const result = await exportToFile(driver, { ...baseParams, format: "sql_update" }, filePath);

		expect(result.rowCount).toBe(3);
		const content = await Bun.file(filePath).text();
		expect(content).toContain('UPDATE "public"."users" SET "name" = \'Alice\', "age" = 30 WHERE "id" = 1;');
		expect(content).toContain('UPDATE "public"."users" SET "name" = \'Bob\', "age" = 25 WHERE "id" = 2;');
		expect(content).toContain('UPDATE "public"."users" SET "name" = \'Charlie\', "age" = NULL WHERE "id" = 3;');
	});

	test("escapes single quotes in values", async () => {
		const rows = [{ id: 1, name: "O'Brien" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.sql");

		await exportToFile(driver, { ...baseParams, format: "sql_update" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain("'O''Brien'");
	});

	test("SQLite main schema omits schema qualification", async () => {
		const driver = mockDriverBatched(sampleRows, "sqlite");
		const filePath = join(tmpDir, "test.sql");

		await exportToFile(driver, { ...baseParams, format: "sql_update", schema: "main" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain('UPDATE "users" SET');
		expect(content).not.toContain('"main"');
	});

	test("preview returns SQL UPDATE", async () => {
		const driver = mockDriver(sampleRows);
		const content = await exportPreview(driver, { ...baseParams, format: "sql_update", limit: 10 });

		expect(content).toContain("UPDATE");
		expect(content).toContain("SET");
		expect(content).toContain("WHERE");
	});
});

// ── HTML Export ────────────────────────────────────────────

describe("HTML export", () => {
	test("generates valid HTML table", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.html");

		const result = await exportToFile(driver, { ...baseParams, format: "html" }, filePath);

		expect(result.rowCount).toBe(3);
		const content = await Bun.file(filePath).text();
		expect(content).toContain("<table>");
		expect(content).toContain("</table>");
		expect(content).toContain("<thead>");
		expect(content).toContain("<th>id</th>");
		expect(content).toContain("<th>name</th>");
		expect(content).toContain("<th>age</th>");
		expect(content).toContain("<tbody>");
		expect(content).toContain("<td>Alice</td>");
		expect(content).toContain("<td>30</td>");
		expect(content).toContain("<td></td>"); // null renders as empty
	});

	test("escapes HTML special characters", async () => {
		const rows = [{ id: 1, name: '<script>alert("xss")</script>' }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.html");

		await exportToFile(driver, { ...baseParams, format: "html" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).not.toContain("<script>");
		expect(content).toContain("&lt;script&gt;");
		expect(content).toContain("&quot;xss&quot;");
	});

	test("handles empty dataset", async () => {
		const driver = mockDriverBatched([]);
		const filePath = join(tmpDir, "test.html");

		await exportToFile(driver, { ...baseParams, format: "html" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain("<table>");
		expect(content).toContain("</table>");
	});

	test("preview returns HTML", async () => {
		const driver = mockDriver(sampleRows);
		const content = await exportPreview(driver, { ...baseParams, format: "html", limit: 10 });

		expect(content).toContain("<table>");
		expect(content).toContain("<th>id</th>");
		expect(content).toContain("<td>Alice</td>");
	});
});

// ── XML Export ─────────────────────────────────────────────

describe("XML export", () => {
	test("generates valid XML", async () => {
		const driver = mockDriverBatched(sampleRows);
		const filePath = join(tmpDir, "test.xml");

		const result = await exportToFile(driver, { ...baseParams, format: "xml" }, filePath);

		expect(result.rowCount).toBe(3);
		const content = await Bun.file(filePath).text();
		expect(content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(content).toContain("<rows>");
		expect(content).toContain("</rows>");
		expect(content).toContain("<row>");
		expect(content).toContain("<id>1</id>");
		expect(content).toContain("<name>Alice</name>");
		expect(content).toContain("<age>30</age>");
		expect(content).toContain('xsi:nil="true"'); // null values
	});

	test("escapes XML special characters", async () => {
		const rows = [{ id: 1, name: "Tom & Jerry <3>" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.xml");

		await exportToFile(driver, { ...baseParams, format: "xml" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain("Tom &amp; Jerry &lt;3&gt;");
	});

	test("sanitizes column names for XML tags", async () => {
		const rows = [{ "123bad": "val", "good_name": "ok" }];
		const driver = mockDriverBatched(rows);
		const filePath = join(tmpDir, "test.xml");

		await exportToFile(driver, { ...baseParams, format: "xml" }, filePath);

		const content = await Bun.file(filePath).text();
		// Column starting with digit should get underscore prefix
		expect(content).toContain("<_123bad>");
		expect(content).toContain("<good_name>");
	});

	test("handles empty dataset", async () => {
		const driver = mockDriverBatched([]);
		const filePath = join(tmpDir, "test.xml");

		await exportToFile(driver, { ...baseParams, format: "xml" }, filePath);

		const content = await Bun.file(filePath).text();
		expect(content).toContain("<rows>");
		expect(content).toContain("</rows>");
	});

	test("preview returns XML", async () => {
		const driver = mockDriver(sampleRows);
		const content = await exportPreview(driver, { ...baseParams, format: "xml", limit: 10 });

		expect(content).toContain('<?xml version="1.0"');
		expect(content).toContain("<id>1</id>");
	});
});
