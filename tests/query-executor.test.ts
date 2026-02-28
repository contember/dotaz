import { describe, test, expect } from "bun:test";
import {
	buildWhereClause,
	buildOrderByClause,
	buildSelectQuery,
	buildCountQuery,
} from "../src/bun/services/query-executor";
import type { DatabaseDriver } from "../src/bun/db/driver";
import type { ColumnFilter, SortColumn } from "../src/shared/types/grid";

// Minimal mock driver for quoteIdentifier and getDriverType
function mockDriver(type: "postgresql" | "sqlite" = "postgresql"): DatabaseDriver {
	return {
		quoteIdentifier(name: string) {
			return `"${name.replace(/"/g, '""')}"`;
		},
		getDriverType() {
			return type;
		},
	} as DatabaseDriver;
}

// ── buildWhereClause ────────────────────────────────────

describe("buildWhereClause", () => {
	const driver = mockDriver();

	test("returns empty for no filters", () => {
		expect(buildWhereClause(undefined, driver)).toEqual({ sql: "", params: [] });
		expect(buildWhereClause([], driver)).toEqual({ sql: "", params: [] });
	});

	test("eq operator", () => {
		const filters: ColumnFilter[] = [{ column: "name", operator: "eq", value: "Alice" }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "name" = $1');
		expect(result.params).toEqual(["Alice"]);
	});

	test("neq operator", () => {
		const filters: ColumnFilter[] = [{ column: "name", operator: "neq", value: "Bob" }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "name" != $1');
		expect(result.params).toEqual(["Bob"]);
	});

	test("gt operator", () => {
		const filters: ColumnFilter[] = [{ column: "age", operator: "gt", value: 25 }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "age" > $1');
		expect(result.params).toEqual([25]);
	});

	test("gte operator", () => {
		const filters: ColumnFilter[] = [{ column: "age", operator: "gte", value: 25 }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "age" >= $1');
		expect(result.params).toEqual([25]);
	});

	test("lt operator", () => {
		const filters: ColumnFilter[] = [{ column: "age", operator: "lt", value: 30 }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "age" < $1');
		expect(result.params).toEqual([30]);
	});

	test("lte operator", () => {
		const filters: ColumnFilter[] = [{ column: "age", operator: "lte", value: 30 }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "age" <= $1');
		expect(result.params).toEqual([30]);
	});

	test("like operator", () => {
		const filters: ColumnFilter[] = [{ column: "name", operator: "like", value: "%Ali%" }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "name" LIKE $1');
		expect(result.params).toEqual(["%Ali%"]);
	});

	test("notLike operator", () => {
		const filters: ColumnFilter[] = [{ column: "name", operator: "notLike", value: "%test%" }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "name" NOT LIKE $1');
		expect(result.params).toEqual(["%test%"]);
	});

	test("isNull operator", () => {
		const filters: ColumnFilter[] = [{ column: "age", operator: "isNull", value: null }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "age" IS NULL');
		expect(result.params).toEqual([]);
	});

	test("isNotNull operator", () => {
		const filters: ColumnFilter[] = [{ column: "age", operator: "isNotNull", value: null }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "age" IS NOT NULL');
		expect(result.params).toEqual([]);
	});

	test("in operator with array", () => {
		const filters: ColumnFilter[] = [{ column: "id", operator: "in", value: [1, 2, 3] }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "id" IN ($1, $2, $3)');
		expect(result.params).toEqual([1, 2, 3]);
	});

	test("notIn operator", () => {
		const filters: ColumnFilter[] = [{ column: "id", operator: "notIn", value: [4, 5] }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "id" NOT IN ($1, $2)');
		expect(result.params).toEqual([4, 5]);
	});

	test("multiple filters combined with AND", () => {
		const filters: ColumnFilter[] = [
			{ column: "age", operator: "gte", value: 20 },
			{ column: "name", operator: "like", value: "%A%" },
			{ column: "email", operator: "isNotNull", value: null },
		];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "age" >= $1 AND "name" LIKE $2 AND "email" IS NOT NULL');
		expect(result.params).toEqual([20, "%A%"]);
	});

	test("paramOffset shifts parameter numbering", () => {
		const filters: ColumnFilter[] = [{ column: "name", operator: "eq", value: "Alice" }];
		const result = buildWhereClause(filters, driver, 3);
		expect(result.sql).toBe('WHERE "name" = $4');
		expect(result.params).toEqual(["Alice"]);
	});

	test("escapes identifiers with double quotes", () => {
		const filters: ColumnFilter[] = [{ column: 'col"name', operator: "eq", value: "x" }];
		const result = buildWhereClause(filters, driver);
		expect(result.sql).toBe('WHERE "col""name" = $1');
	});
});

// ── buildOrderByClause ──────────────────────────────────

describe("buildOrderByClause", () => {
	const driver = mockDriver();

	test("returns empty for no sort", () => {
		expect(buildOrderByClause(undefined, driver)).toBe("");
		expect(buildOrderByClause([], driver)).toBe("");
	});

	test("single column ascending", () => {
		const sort: SortColumn[] = [{ column: "name", direction: "asc" }];
		expect(buildOrderByClause(sort, driver)).toBe('ORDER BY "name" ASC');
	});

	test("single column descending", () => {
		const sort: SortColumn[] = [{ column: "age", direction: "desc" }];
		expect(buildOrderByClause(sort, driver)).toBe('ORDER BY "age" DESC');
	});

	test("multiple columns", () => {
		const sort: SortColumn[] = [
			{ column: "name", direction: "asc" },
			{ column: "age", direction: "desc" },
		];
		expect(buildOrderByClause(sort, driver)).toBe('ORDER BY "name" ASC, "age" DESC');
	});
});

// ── buildSelectQuery ────────────────────────────────────

describe("buildSelectQuery", () => {
	test("basic select with pagination (postgresql)", () => {
		const driver = mockDriver("postgresql");
		const result = buildSelectQuery("public", "users", 1, 50, undefined, undefined, driver);
		expect(result.sql).toBe('SELECT * FROM "public"."users" LIMIT $1 OFFSET $2');
		expect(result.params).toEqual([50, 0]);
	});

	test("page 2 offset calculation", () => {
		const driver = mockDriver("postgresql");
		const result = buildSelectQuery("public", "users", 2, 50, undefined, undefined, driver);
		expect(result.params).toEqual([50, 50]);
	});

	test("page 3 with pageSize 25", () => {
		const driver = mockDriver("postgresql");
		const result = buildSelectQuery("public", "users", 3, 25, undefined, undefined, driver);
		expect(result.params).toEqual([25, 50]);
	});

	test("with sort", () => {
		const driver = mockDriver("postgresql");
		const sort: SortColumn[] = [{ column: "name", direction: "asc" }];
		const result = buildSelectQuery("public", "users", 1, 50, sort, undefined, driver);
		expect(result.sql).toBe('SELECT * FROM "public"."users" ORDER BY "name" ASC LIMIT $1 OFFSET $2');
		expect(result.params).toEqual([50, 0]);
	});

	test("with filters", () => {
		const driver = mockDriver("postgresql");
		const filters: ColumnFilter[] = [{ column: "age", operator: "gt", value: 20 }];
		const result = buildSelectQuery("public", "users", 1, 50, undefined, filters, driver);
		expect(result.sql).toBe('SELECT * FROM "public"."users" WHERE "age" > $1 LIMIT $2 OFFSET $3');
		expect(result.params).toEqual([20, 50, 0]);
	});

	test("with sort and filters", () => {
		const driver = mockDriver("postgresql");
		const sort: SortColumn[] = [{ column: "name", direction: "desc" }];
		const filters: ColumnFilter[] = [
			{ column: "age", operator: "gte", value: 18 },
			{ column: "email", operator: "isNotNull", value: null },
		];
		const result = buildSelectQuery("public", "users", 1, 100, sort, filters, driver);
		expect(result.sql).toBe(
			'SELECT * FROM "public"."users" WHERE "age" >= $1 AND "email" IS NOT NULL ORDER BY "name" DESC LIMIT $2 OFFSET $3',
		);
		expect(result.params).toEqual([18, 100, 0]);
	});

	test("sqlite skips schema qualification for main", () => {
		const driver = mockDriver("sqlite");
		const result = buildSelectQuery("main", "users", 1, 50, undefined, undefined, driver);
		expect(result.sql).toBe('SELECT * FROM "users" LIMIT $1 OFFSET $2');
	});

	test("sqlite with non-main schema qualifies", () => {
		const driver = mockDriver("sqlite");
		const result = buildSelectQuery("attached", "users", 1, 50, undefined, undefined, driver);
		expect(result.sql).toBe('SELECT * FROM "attached"."users" LIMIT $1 OFFSET $2');
	});
});

// ── buildCountQuery ─────────────────────────────────────

describe("buildCountQuery", () => {
	test("basic count without filters", () => {
		const driver = mockDriver("postgresql");
		const result = buildCountQuery("public", "users", undefined, driver);
		expect(result.sql).toBe('SELECT COUNT(*) AS count FROM "public"."users"');
		expect(result.params).toEqual([]);
	});

	test("count with filters", () => {
		const driver = mockDriver("postgresql");
		const filters: ColumnFilter[] = [{ column: "age", operator: "gt", value: 25 }];
		const result = buildCountQuery("public", "users", filters, driver);
		expect(result.sql).toBe('SELECT COUNT(*) AS count FROM "public"."users" WHERE "age" > $1');
		expect(result.params).toEqual([25]);
	});

	test("sqlite count skips main schema", () => {
		const driver = mockDriver("sqlite");
		const result = buildCountQuery("main", "users", undefined, driver);
		expect(result.sql).toBe('SELECT COUNT(*) AS count FROM "users"');
	});
});
