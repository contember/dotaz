import { describe, test, expect, mock } from "bun:test";
import { compareData } from "../src/backend-shared/services/comparison-service";
import type { DatabaseDriver } from "../src/backend-shared/db/driver";
import type { QueryResult } from "../src/shared/types/query";
import type { ComparisonRequest } from "../src/shared/types/comparison";

function makeResult(rows: Record<string, unknown>[], columnNames?: string[]): QueryResult {
	const names = columnNames ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
	const columns = names.map((name) => ({ name, dataType: "unknown" as any }));
	return { columns, rows, rowCount: rows.length, durationMs: 0 };
}

function mockDriver(resultRows: Record<string, unknown>[], columnNames?: string[]): DatabaseDriver {
	const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;
	return {
		execute: mock(async () => makeResult(resultRows, columnNames)),
		quoteIdentifier,
		getDriverType: () => "postgresql",
		qualifyTable: (schema: string, table: string) =>
			`${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
		emptyInsertSql: (qt: string) => `INSERT INTO ${qt} DEFAULT VALUES`,
		placeholder: (i: number) => `$${i}`,
		beginTransaction: mock(async () => {}),
		commit: mock(async () => {}),
		rollback: mock(async () => {}),
		inTransaction: () => false,
	} as unknown as DatabaseDriver;
}

// ── Identical tables ─────────────────────────────────────────

describe("compareData", () => {
	test("identical tables — all rows matched", async () => {
		const rows = [
			{ id: 1, name: "Alice", age: 30 },
			{ id: 2, name: "Bob", age: 25 },
		];

		const result = await compareData(
			mockDriver(rows),
			mockDriver(rows),
			{
				left: { connectionId: "a", type: "table", schema: "public", table: "users" },
				right: { connectionId: "b", type: "table", schema: "public", table: "users" },
				keyColumns: [{ leftColumn: "id", rightColumn: "id" }],
			},
		);

		expect(result.stats.matched).toBe(2);
		expect(result.stats.added).toBe(0);
		expect(result.stats.removed).toBe(0);
		expect(result.stats.changed).toBe(0);
		expect(result.stats.total).toBe(2);
		expect(result.rows).toHaveLength(2);
		expect(result.rows.every((r) => r.status === "matched")).toBe(true);
	});

	// ── Different values ─────────────────────────────────────

	test("changed rows — detects value differences", async () => {
		const leftRows = [
			{ id: 1, name: "Alice", age: 30 },
			{ id: 2, name: "Bob", age: 25 },
		];
		const rightRows = [
			{ id: 1, name: "Alice", age: 31 },
			{ id: 2, name: "Bobby", age: 25 },
		];

		const result = await compareData(
			mockDriver(leftRows),
			mockDriver(rightRows),
			{
				left: { connectionId: "a", type: "table", schema: "public", table: "users" },
				right: { connectionId: "b", type: "table", schema: "public", table: "users" },
				keyColumns: [{ leftColumn: "id", rightColumn: "id" }],
			},
		);

		expect(result.stats.changed).toBe(2);
		expect(result.stats.matched).toBe(0);

		const row1 = result.rows.find((r) => r.leftValues?.id === 1);
		expect(row1?.status).toBe("changed");
		expect(row1?.changedColumns).toContain("age");

		const row2 = result.rows.find((r) => r.leftValues?.id === 2);
		expect(row2?.status).toBe("changed");
		expect(row2?.changedColumns).toContain("name");
	});

	// ── Added and removed rows ───────────────────────────────

	test("added/removed rows — rows present in only one side", async () => {
		const leftRows = [
			{ id: 1, name: "Alice" },
			{ id: 2, name: "Bob" },
		];
		const rightRows = [
			{ id: 2, name: "Bob" },
			{ id: 3, name: "Charlie" },
		];

		const result = await compareData(
			mockDriver(leftRows),
			mockDriver(rightRows),
			{
				left: { connectionId: "a", type: "table", schema: "public", table: "users" },
				right: { connectionId: "b", type: "table", schema: "public", table: "users" },
				keyColumns: [{ leftColumn: "id", rightColumn: "id" }],
			},
		);

		expect(result.stats.matched).toBe(1);
		expect(result.stats.removed).toBe(1);
		expect(result.stats.added).toBe(1);
		expect(result.stats.total).toBe(3);

		const removed = result.rows.find((r) => r.status === "removed");
		expect(removed?.leftValues?.id).toBe(1);
		expect(removed?.rightValues).toBeNull();

		const added = result.rows.find((r) => r.status === "added");
		expect(added?.rightValues?.id).toBe(3);
		expect(added?.leftValues).toBeNull();
	});

	// ── Auto column mapping ──────────────────────────────────

	test("auto column mapping — maps by name case-insensitively", async () => {
		const leftRows = [{ id: 1, Name: "Alice", AGE: 30 }];
		const rightRows = [{ id: 1, name: "Alice", age: 31 }];

		const result = await compareData(
			mockDriver(leftRows, ["id", "Name", "AGE"]),
			mockDriver(rightRows, ["id", "name", "age"]),
			{
				left: { connectionId: "a", type: "table", schema: "public", table: "t1" },
				right: { connectionId: "b", type: "table", schema: "public", table: "t2" },
				keyColumns: [{ leftColumn: "id", rightColumn: "id" }],
			},
		);

		expect(result.columnMappings).toContainEqual({ leftColumn: "id", rightColumn: "id" });
		expect(result.columnMappings).toContainEqual({ leftColumn: "Name", rightColumn: "name" });
		expect(result.columnMappings).toContainEqual({ leftColumn: "AGE", rightColumn: "age" });

		// AGE 30 vs age 31 should be detected as changed
		expect(result.stats.changed).toBe(1);
		expect(result.rows[0].changedColumns).toContain("AGE");
	});

	// ── Composite key ────────────────────────────────────────

	test("composite key — matches on multiple columns", async () => {
		const leftRows = [
			{ schema: "public", table: "users", count: 10 },
			{ schema: "public", table: "posts", count: 5 },
		];
		const rightRows = [
			{ schema: "public", table: "users", count: 12 },
			{ schema: "public", table: "posts", count: 5 },
		];

		const result = await compareData(
			mockDriver(leftRows),
			mockDriver(rightRows),
			{
				left: { connectionId: "a", type: "table", schema: "main", table: "stats" },
				right: { connectionId: "b", type: "table", schema: "main", table: "stats" },
				keyColumns: [
					{ leftColumn: "schema", rightColumn: "schema" },
					{ leftColumn: "table", rightColumn: "table" },
				],
			},
		);

		expect(result.stats.matched).toBe(1);
		expect(result.stats.changed).toBe(1);
		const changed = result.rows.find((r) => r.status === "changed");
		expect(changed?.changedColumns).toContain("count");
	});

	// ── Null handling ────────────────────────────────────────

	test("null values — treats null/undefined as equal", async () => {
		const leftRows = [{ id: 1, val: null }];
		const rightRows = [{ id: 1, val: null }];

		const result = await compareData(
			mockDriver(leftRows),
			mockDriver(rightRows),
			{
				left: { connectionId: "a", type: "table", schema: "public", table: "t" },
				right: { connectionId: "b", type: "table", schema: "public", table: "t" },
				keyColumns: [{ leftColumn: "id", rightColumn: "id" }],
			},
		);

		expect(result.stats.matched).toBe(1);
		expect(result.stats.changed).toBe(0);
	});

	test("null vs non-null — detected as changed", async () => {
		const leftRows = [{ id: 1, val: null }];
		const rightRows = [{ id: 1, val: "something" }];

		const result = await compareData(
			mockDriver(leftRows),
			mockDriver(rightRows),
			{
				left: { connectionId: "a", type: "table", schema: "public", table: "t" },
				right: { connectionId: "b", type: "table", schema: "public", table: "t" },
				keyColumns: [{ leftColumn: "id", rightColumn: "id" }],
			},
		);

		expect(result.stats.changed).toBe(1);
		expect(result.rows[0].changedColumns).toContain("val");
	});

	// ── Validation ───────────────────────────────────────────

	test("throws error when no key columns provided", async () => {
		const rows = [{ id: 1, name: "Alice" }];

		await expect(
			compareData(
				mockDriver(rows),
				mockDriver(rows),
				{
					left: { connectionId: "a", type: "table", schema: "public", table: "t" },
					right: { connectionId: "b", type: "table", schema: "public", table: "t" },
					keyColumns: [],
				},
			),
		).rejects.toThrow("At least one key column is required");
	});

	test("throws error when key column not found in source", async () => {
		const rows = [{ id: 1, name: "Alice" }];

		await expect(
			compareData(
				mockDriver(rows),
				mockDriver(rows),
				{
					left: { connectionId: "a", type: "table", schema: "public", table: "t" },
					right: { connectionId: "b", type: "table", schema: "public", table: "t" },
					keyColumns: [{ leftColumn: "nonexistent", rightColumn: "id" }],
				},
			),
		).rejects.toThrow('Key column "nonexistent" not found in left source');
	});

	// ── Empty tables ─────────────────────────────────────────

	test("empty tables — no rows to compare", async () => {
		const result = await compareData(
			mockDriver([], ["id", "name"]),
			mockDriver([], ["id", "name"]),
			{
				left: { connectionId: "a", type: "table", schema: "public", table: "t" },
				right: { connectionId: "b", type: "table", schema: "public", table: "t" },
				keyColumns: [{ leftColumn: "id", rightColumn: "id" }],
			},
		);

		expect(result.stats.total).toBe(0);
		expect(result.rows).toHaveLength(0);
	});

	// ── Query source ─────────────────────────────────────────

	test("query source — uses SQL directly", async () => {
		const rows = [{ id: 1, name: "Alice" }];
		const driver = mockDriver(rows);

		await compareData(
			driver,
			driver,
			{
				left: { connectionId: "a", type: "query", sql: "SELECT * FROM users" },
				right: { connectionId: "b", type: "query", sql: "SELECT * FROM users" },
				keyColumns: [{ leftColumn: "id", rightColumn: "id" }],
			},
		);

		// Both calls use the SQL query directly
		expect((driver.execute as any).mock.calls.length).toBe(2);
	});

	// ── Sort order ───────────────────────────────────────────

	test("result rows sorted by status — removed, changed, added, matched", async () => {
		const leftRows = [
			{ id: 1, name: "Alice" },
			{ id: 2, name: "Bob" },
			{ id: 3, name: "Charlie" },
		];
		const rightRows = [
			{ id: 2, name: "Bobby" },
			{ id: 3, name: "Charlie" },
			{ id: 4, name: "Diana" },
		];

		const result = await compareData(
			mockDriver(leftRows),
			mockDriver(rightRows),
			{
				left: { connectionId: "a", type: "table", schema: "public", table: "t" },
				right: { connectionId: "b", type: "table", schema: "public", table: "t" },
				keyColumns: [{ leftColumn: "id", rightColumn: "id" }],
			},
		);

		const statuses = result.rows.map((r) => r.status);
		expect(statuses).toEqual(["removed", "changed", "added", "matched"]);
	});

	// ── Explicit column mappings ─────────────────────────────

	test("explicit column mappings — uses provided mappings instead of auto", async () => {
		const leftRows = [{ id: 1, first_name: "Alice", last_name: "Smith" }];
		const rightRows = [{ id: 1, name: "Alice", surname: "Jones" }];

		const result = await compareData(
			mockDriver(leftRows, ["id", "first_name", "last_name"]),
			mockDriver(rightRows, ["id", "name", "surname"]),
			{
				left: { connectionId: "a", type: "table", schema: "public", table: "t1" },
				right: { connectionId: "b", type: "table", schema: "public", table: "t2" },
				keyColumns: [{ leftColumn: "id", rightColumn: "id" }],
				columnMappings: [
					{ leftColumn: "id", rightColumn: "id" },
					{ leftColumn: "first_name", rightColumn: "name" },
					{ leftColumn: "last_name", rightColumn: "surname" },
				],
			},
		);

		// first_name=Alice matches name=Alice, but last_name=Smith != surname=Jones
		expect(result.stats.changed).toBe(1);
		expect(result.rows[0].changedColumns).toContain("last_name");
		expect(result.rows[0].changedColumns).not.toContain("first_name");
	});
});
