import { describe, test, expect, mock } from "bun:test";
import {
	buildWhereClause,
	buildOrderByClause,
	buildSelectQuery,
	buildCountQuery,
	splitStatements,
	QueryExecutor,
} from "../src/bun/services/query-executor";
import type { DatabaseDriver } from "../src/bun/db/driver";
import type { ColumnFilter, SortColumn } from "../src/shared/types/grid";
import type { QueryResult } from "../src/shared/types/query";
import type { ConnectionManager } from "../src/bun/services/connection-manager";

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

// ── splitStatements ────────────────────────────────────────

describe("splitStatements", () => {
	test("single statement without semicolon", () => {
		expect(splitStatements("SELECT 1")).toEqual(["SELECT 1"]);
	});

	test("single statement with trailing semicolon", () => {
		expect(splitStatements("SELECT 1;")).toEqual(["SELECT 1"]);
	});

	test("multiple statements", () => {
		expect(splitStatements("SELECT 1; SELECT 2; SELECT 3")).toEqual([
			"SELECT 1",
			"SELECT 2",
			"SELECT 3",
		]);
	});

	test("ignores semicolons inside single-quoted strings", () => {
		expect(splitStatements("SELECT 'a;b'; SELECT 2")).toEqual([
			"SELECT 'a;b'",
			"SELECT 2",
		]);
	});

	test("ignores semicolons inside double-quoted strings", () => {
		expect(splitStatements('SELECT "a;b"; SELECT 2')).toEqual([
			'SELECT "a;b"',
			"SELECT 2",
		]);
	});

	test("empty input returns empty array", () => {
		expect(splitStatements("")).toEqual([]);
	});

	test("whitespace-only input returns empty array", () => {
		expect(splitStatements("   ")).toEqual([]);
	});

	test("trims whitespace from statements", () => {
		expect(splitStatements("  SELECT 1 ;  SELECT 2  ")).toEqual([
			"SELECT 1",
			"SELECT 2",
		]);
	});

	test("skips empty statements between semicolons", () => {
		expect(splitStatements("SELECT 1;;; SELECT 2")).toEqual([
			"SELECT 1",
			"SELECT 2",
		]);
	});
});

// ── QueryExecutor ──────────────────────────────────────────

function makeSuccessResult(rows: Record<string, unknown>[] = [], durationMs = 0): QueryResult {
	const columns = rows.length > 0
		? Object.keys(rows[0]).map((name) => ({ name, dataType: "unknown" }))
		: [];
	return { columns, rows, rowCount: rows.length, durationMs };
}

function makeMockDriver(overrides?: Partial<DatabaseDriver>): DatabaseDriver {
	return {
		execute: mock(async () => makeSuccessResult([{ id: 1 }])),
		cancel: mock(async () => {}),
		quoteIdentifier: (name: string) => `"${name}"`,
		getDriverType: () => "sqlite" as const,
		...overrides,
	} as unknown as DatabaseDriver;
}

function makeMockConnectionManager(driver: DatabaseDriver): ConnectionManager {
	return {
		getDriver: () => driver,
	} as unknown as ConnectionManager;
}

describe("QueryExecutor", () => {
	test("executes a single SELECT and returns results", async () => {
		const rows = [{ id: 1, name: "Alice" }];
		const driver = makeMockDriver({
			execute: mock(async () => makeSuccessResult(rows)),
		});
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		const results = await executor.executeQuery("conn-1", "SELECT * FROM users");

		expect(results).toHaveLength(1);
		expect(results[0].rows).toEqual(rows);
		expect(results[0].columns).toEqual([
			{ name: "id", dataType: "unknown" },
			{ name: "name", dataType: "unknown" },
		]);
		expect(results[0].error).toBeUndefined();
		expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
		expect(driver.execute).toHaveBeenCalledTimes(1);
	});

	test("passes params for single-statement query", async () => {
		const driver = makeMockDriver();
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		await executor.executeQuery("conn-1", "SELECT * FROM users WHERE id = $1", [42]);

		expect(driver.execute).toHaveBeenCalledWith(
			"SELECT * FROM users WHERE id = $1",
			[42],
		);
	});

	test("multi-statement execution returns multiple results", async () => {
		let callCount = 0;
		const driver = makeMockDriver({
			execute: mock(async () => {
				callCount++;
				return makeSuccessResult([{ n: callCount }]);
			}),
		});
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		const results = await executor.executeQuery(
			"conn-1",
			"SELECT 1; SELECT 2; SELECT 3",
		);

		expect(results).toHaveLength(3);
		expect(results[0].rows).toEqual([{ n: 1 }]);
		expect(results[1].rows).toEqual([{ n: 2 }]);
		expect(results[2].rows).toEqual([{ n: 3 }]);
		expect(driver.execute).toHaveBeenCalledTimes(3);
	});

	test("multi-statement does not pass params to individual statements", async () => {
		const driver = makeMockDriver();
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		await executor.executeQuery("conn-1", "SELECT 1; SELECT 2", [42]);

		expect(driver.execute).toHaveBeenCalledWith("SELECT 1", undefined);
	});

	test("DML query returns affected rows", async () => {
		const driver = makeMockDriver({
			execute: mock(async () => ({
				columns: [],
				rows: [],
				rowCount: 0,
				affectedRows: 5,
				durationMs: 10,
			})),
		});
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		const results = await executor.executeQuery("conn-1", "DELETE FROM users WHERE age < 18");

		expect(results).toHaveLength(1);
		expect(results[0].affectedRows).toBe(5);
		expect(results[0].rows).toEqual([]);
	});

	test("measures duration", async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 20));
				return makeSuccessResult();
			}),
		});
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		const results = await executor.executeQuery("conn-1", "SELECT pg_sleep(0.02)");

		expect(results[0].durationMs).toBeGreaterThanOrEqual(15);
	});

	test("catches errors and returns them in result", async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				throw new Error("relation \"nope\" does not exist");
			}),
		});
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		const results = await executor.executeQuery("conn-1", "SELECT * FROM nope");

		expect(results).toHaveLength(1);
		expect(results[0].error).toBe('relation "nope" does not exist');
		expect(results[0].rows).toEqual([]);
		expect(results[0].columns).toEqual([]);
		expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
	});

	test("stops multi-statement execution on error", async () => {
		let callCount = 0;
		const driver = makeMockDriver({
			execute: mock(async (sql: string) => {
				callCount++;
				if (callCount === 2) throw new Error("syntax error");
				return makeSuccessResult([{ n: callCount }]);
			}),
		});
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		const results = await executor.executeQuery(
			"conn-1",
			"SELECT 1; BAD SQL; SELECT 3",
		);

		expect(results).toHaveLength(2);
		expect(results[0].error).toBeUndefined();
		expect(results[1].error).toBe("syntax error");
		expect(driver.execute).toHaveBeenCalledTimes(2);
	});

	test("timeout rejects long-running queries", async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 200));
				return makeSuccessResult();
			}),
		});
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm, 50); // 50ms timeout

		const results = await executor.executeQuery("conn-1", "SELECT pg_sleep(1)");

		expect(results).toHaveLength(1);
		expect(results[0].error).toContain("timed out");
	});

	test("custom timeout overrides default", async () => {
		const driver = makeMockDriver({
			execute: mock(async () => {
				await new Promise((r) => setTimeout(r, 200));
				return makeSuccessResult();
			}),
		});
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm, 10_000); // high default

		const results = await executor.executeQuery("conn-1", "SELECT pg_sleep(1)", undefined, 50);

		expect(results).toHaveLength(1);
		expect(results[0].error).toContain("timed out");
	});

	test("cancelQuery cancels a running query", async () => {
		let resolveExecute: () => void;
		const executePromise = new Promise<void>((r) => { resolveExecute = r; });

		const driver = makeMockDriver({
			execute: mock(async () => {
				await executePromise;
				return makeSuccessResult();
			}),
			cancel: mock(async () => {
				resolveExecute!();
			}),
		});
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm, 5000);

		const resultPromise = executor.executeQuery("conn-1", "SELECT pg_sleep(10)");

		// Wait for query to start
		await new Promise((r) => setTimeout(r, 10));

		const queryIds = executor.getRunningQueryIds();
		expect(queryIds).toHaveLength(1);

		const cancelled = await executor.cancelQuery(queryIds[0]);
		expect(cancelled).toBe(true);

		const results = await resultPromise;
		expect(results).toHaveLength(1);
		expect(results[0].error).toBe("Query was cancelled");
		expect(driver.cancel).toHaveBeenCalled();
	});

	test("cancelQuery returns false for unknown queryId", async () => {
		const driver = makeMockDriver();
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		const cancelled = await executor.cancelQuery("nonexistent");
		expect(cancelled).toBe(false);
	});

	test("running queries are cleaned up after execution", async () => {
		const driver = makeMockDriver();
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		expect(executor.getRunningQueryIds()).toHaveLength(0);
		await executor.executeQuery("conn-1", "SELECT 1");
		expect(executor.getRunningQueryIds()).toHaveLength(0);
	});

	test("empty SQL returns empty results", async () => {
		const driver = makeMockDriver();
		const cm = makeMockConnectionManager(driver);
		const executor = new QueryExecutor(cm);

		const results = await executor.executeQuery("conn-1", "");
		expect(results).toEqual([]);
		expect(driver.execute).not.toHaveBeenCalled();
	});
});
