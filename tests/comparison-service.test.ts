import { describe, test, expect } from "bun:test";
import { compareData, autoMapColumns } from "../src/shared/comparison";

// ── Identical tables ─────────────────────────────────────────

describe("compareData", () => {
	test("identical tables — all rows matched", () => {
		const rows = [
			{ id: 1, name: "Alice", age: 30 },
			{ id: 2, name: "Bob", age: 25 },
		];

		const result = compareData(
			{ columns: ["id", "name", "age"], rows },
			{ columns: ["id", "name", "age"], rows },
			[{ leftColumn: "id", rightColumn: "id" }],
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

	test("changed rows — detects value differences", () => {
		const leftRows = [
			{ id: 1, name: "Alice", age: 30 },
			{ id: 2, name: "Bob", age: 25 },
		];
		const rightRows = [
			{ id: 1, name: "Alice", age: 31 },
			{ id: 2, name: "Bobby", age: 25 },
		];

		const result = compareData(
			{ columns: ["id", "name", "age"], rows: leftRows },
			{ columns: ["id", "name", "age"], rows: rightRows },
			[{ leftColumn: "id", rightColumn: "id" }],
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

	test("added/removed rows — rows present in only one side", () => {
		const leftRows = [
			{ id: 1, name: "Alice" },
			{ id: 2, name: "Bob" },
		];
		const rightRows = [
			{ id: 2, name: "Bob" },
			{ id: 3, name: "Charlie" },
		];

		const result = compareData(
			{ columns: ["id", "name"], rows: leftRows },
			{ columns: ["id", "name"], rows: rightRows },
			[{ leftColumn: "id", rightColumn: "id" }],
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

	test("auto column mapping — maps by name case-insensitively", () => {
		const leftRows = [{ id: 1, Name: "Alice", AGE: 30 }];
		const rightRows = [{ id: 1, name: "Alice", age: 31 }];

		const result = compareData(
			{ columns: ["id", "Name", "AGE"], rows: leftRows },
			{ columns: ["id", "name", "age"], rows: rightRows },
			[{ leftColumn: "id", rightColumn: "id" }],
		);

		expect(result.columnMappings).toContainEqual({ leftColumn: "id", rightColumn: "id" });
		expect(result.columnMappings).toContainEqual({ leftColumn: "Name", rightColumn: "name" });
		expect(result.columnMappings).toContainEqual({ leftColumn: "AGE", rightColumn: "age" });

		// AGE 30 vs age 31 should be detected as changed
		expect(result.stats.changed).toBe(1);
		expect(result.rows[0].changedColumns).toContain("AGE");
	});

	// ── Composite key ────────────────────────────────────────

	test("composite key — matches on multiple columns", () => {
		const leftRows = [
			{ schema: "public", table: "users", count: 10 },
			{ schema: "public", table: "posts", count: 5 },
		];
		const rightRows = [
			{ schema: "public", table: "users", count: 12 },
			{ schema: "public", table: "posts", count: 5 },
		];

		const result = compareData(
			{ columns: ["schema", "table", "count"], rows: leftRows },
			{ columns: ["schema", "table", "count"], rows: rightRows },
			[
				{ leftColumn: "schema", rightColumn: "schema" },
				{ leftColumn: "table", rightColumn: "table" },
			],
		);

		expect(result.stats.matched).toBe(1);
		expect(result.stats.changed).toBe(1);
		const changed = result.rows.find((r) => r.status === "changed");
		expect(changed?.changedColumns).toContain("count");
	});

	// ── Null handling ────────────────────────────────────────

	test("null values — treats null/undefined as equal", () => {
		const leftRows = [{ id: 1, val: null }];
		const rightRows = [{ id: 1, val: null }];

		const result = compareData(
			{ columns: ["id", "val"], rows: leftRows },
			{ columns: ["id", "val"], rows: rightRows },
			[{ leftColumn: "id", rightColumn: "id" }],
		);

		expect(result.stats.matched).toBe(1);
		expect(result.stats.changed).toBe(0);
	});

	test("null vs non-null — detected as changed", () => {
		const leftRows = [{ id: 1, val: null }];
		const rightRows = [{ id: 1, val: "something" }];

		const result = compareData(
			{ columns: ["id", "val"], rows: leftRows },
			{ columns: ["id", "val"], rows: rightRows },
			[{ leftColumn: "id", rightColumn: "id" }],
		);

		expect(result.stats.changed).toBe(1);
		expect(result.rows[0].changedColumns).toContain("val");
	});

	// ── Validation ───────────────────────────────────────────

	test("throws error when no key columns provided", () => {
		const rows = [{ id: 1, name: "Alice" }];

		expect(() =>
			compareData(
				{ columns: ["id", "name"], rows },
				{ columns: ["id", "name"], rows },
				[],
			),
		).toThrow("At least one key column is required");
	});

	test("throws error when key column not found in source", () => {
		const rows = [{ id: 1, name: "Alice" }];

		expect(() =>
			compareData(
				{ columns: ["id", "name"], rows },
				{ columns: ["id", "name"], rows },
				[{ leftColumn: "nonexistent", rightColumn: "id" }],
			),
		).toThrow('Key column "nonexistent" not found in left source');
	});

	// ── Empty tables ─────────────────────────────────────────

	test("empty tables — no rows to compare", () => {
		const result = compareData(
			{ columns: ["id", "name"], rows: [] },
			{ columns: ["id", "name"], rows: [] },
			[{ leftColumn: "id", rightColumn: "id" }],
		);

		expect(result.stats.total).toBe(0);
		expect(result.rows).toHaveLength(0);
	});

	// ── Sort order ───────────────────────────────────────────

	test("result rows sorted by status — removed, changed, added, matched", () => {
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

		const result = compareData(
			{ columns: ["id", "name"], rows: leftRows },
			{ columns: ["id", "name"], rows: rightRows },
			[{ leftColumn: "id", rightColumn: "id" }],
		);

		const statuses = result.rows.map((r) => r.status);
		expect(statuses).toEqual(["removed", "changed", "added", "matched"]);
	});

	// ── Explicit column mappings ─────────────────────────────

	test("explicit column mappings — uses provided mappings instead of auto", () => {
		const leftRows = [{ id: 1, first_name: "Alice", last_name: "Smith" }];
		const rightRows = [{ id: 1, name: "Alice", surname: "Jones" }];

		const result = compareData(
			{ columns: ["id", "first_name", "last_name"], rows: leftRows },
			{ columns: ["id", "name", "surname"], rows: rightRows },
			[{ leftColumn: "id", rightColumn: "id" }],
			[
				{ leftColumn: "id", rightColumn: "id" },
				{ leftColumn: "first_name", rightColumn: "name" },
				{ leftColumn: "last_name", rightColumn: "surname" },
			],
		);

		// first_name=Alice matches name=Alice, but last_name=Smith != surname=Jones
		expect(result.stats.changed).toBe(1);
		expect(result.rows[0].changedColumns).toContain("last_name");
		expect(result.rows[0].changedColumns).not.toContain("first_name");
	});
});

// ── autoMapColumns ──────────────────────────────────────────

describe("autoMapColumns", () => {
	test("maps columns by case-insensitive name match", () => {
		const mappings = autoMapColumns(["Id", "Name", "AGE"], ["id", "name", "age"]);
		expect(mappings).toEqual([
			{ leftColumn: "Id", rightColumn: "id" },
			{ leftColumn: "Name", rightColumn: "name" },
			{ leftColumn: "AGE", rightColumn: "age" },
		]);
	});

	test("skips unmatched columns", () => {
		const mappings = autoMapColumns(["id", "extra"], ["id", "other"]);
		expect(mappings).toEqual([{ leftColumn: "id", rightColumn: "id" }]);
	});
});
