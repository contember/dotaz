import type { DatabaseDriver } from "../db/driver";
import type { QueryResult, ExplainResult, ExplainNode } from "../../shared/types/query";
import type { ConnectionManager } from "./connection-manager";
import type { AppDatabase } from "../storage/app-db";
import { splitStatements, parseErrorPosition } from "../../shared/sql/statements";
import { DatabaseError } from "../../shared/types/errors";

// Re-export shared SQL utilities for backward compatibility
export type { WhereClauseResult, GeneratedStatement } from "../../shared/sql/builders";
export {
	buildQuickSearchClause,
	buildWhereClause,
	buildOrderByClause,
	buildSelectQuery,
	buildCountQuery,
	generateInsert,
	generateUpdate,
	generateDelete,
	generateChangeSql,
	generateChangePreview,
	generateChangesPreview,
} from "../../shared/sql/builders";
export { splitStatements, offsetToLineColumn, parseErrorPosition, detectDestructiveWithoutWhere } from "../../shared/sql/statements";

// ── QueryExecutor ──────────────────────────────────────────

interface RunningQuery {
	queryId: string;
	connectionId: string;
	cancelled: boolean;
}

export class QueryExecutor {
	private connectionManager: ConnectionManager;
	private runningQueries = new Map<string, RunningQuery>();
	private defaultTimeoutMs: number;
	private appDb?: AppDatabase;

	constructor(connectionManager: ConnectionManager, defaultTimeoutMs = 30_000, appDb?: AppDatabase) {
		this.connectionManager = connectionManager;
		this.defaultTimeoutMs = defaultTimeoutMs;
		this.appDb = appDb;
	}

	/**
	 * Execute one or more SQL statements against a connection.
	 * Multi-statement SQL is split by semicolons and executed sequentially.
	 * Returns an array of results (one per statement).
	 */
	async executeQuery(
		connectionId: string,
		sql: string,
		params?: unknown[],
		timeoutMs?: number,
		queryId?: string,
		database?: string,
	): Promise<QueryResult[]> {
		const driver = this.connectionManager.getDriver(connectionId, database);
		const statements = splitStatements(sql);

		if (statements.length === 0) {
			return [];
		}

		const id = queryId ?? crypto.randomUUID();
		const entry: RunningQuery = { queryId: id, connectionId, cancelled: false };
		this.runningQueries.set(id, entry);

		const timeout = timeoutMs ?? this.defaultTimeoutMs;
		const results: QueryResult[] = [];

		try {
			for (const stmt of statements) {
				if (entry.cancelled) {
					results.push(makeCancelledResult());
					break;
				}

				const result = await this.executeSingle(
					driver,
					stmt,
					// Only pass params for the first (or only) statement
					statements.length === 1 ? params : undefined,
					timeout,
					entry,
				);
				results.push(result);

				if (result.error) {
					break;
				}
			}
		} finally {
			this.runningQueries.delete(id);
			this.logHistory(connectionId, sql, results);
		}

		return results;
	}

	/**
	 * Cancel a running query by its queryId.
	 */
	async cancelQuery(queryId: string): Promise<boolean> {
		const entry = this.runningQueries.get(queryId);
		if (!entry) {
			return false;
		}

		entry.cancelled = true;

		try {
			const driver = this.connectionManager.getDriver(entry.connectionId);
			await driver.cancel();
		} catch (err) {
			console.debug("Cancel query failed (driver may have completed):", err instanceof Error ? err.message : err);
		}

		return true;
	}

	/**
	 * Get the list of currently running query IDs.
	 */
	getRunningQueryIds(): string[] {
		return [...this.runningQueries.keys()];
	}

	/**
	 * Run EXPLAIN on a SQL statement and return a parsed plan tree.
	 */
	async explainQuery(
		connectionId: string,
		sql: string,
		analyze: boolean,
		database?: string,
	): Promise<ExplainResult> {
		const driver = this.connectionManager.getDriver(connectionId, database);
		const driverType = driver.getDriverType();
		const start = performance.now();

		try {
			if (driverType === "sqlite") {
				const result = await driver.execute(`EXPLAIN QUERY PLAN ${sql}`);
				const durationMs = Math.round(performance.now() - start);
				const nodes = parseSqliteExplain(result.rows);
				const rawText = result.rows
					.map((r) => `${r.id}|${r.parent}|${r.notused ?? 0}|${r.detail}`)
					.join("\n");
				return { nodes, rawText, durationMs };
			}

			// PostgreSQL / MySQL — use JSON format
			const prefix = analyze
				? "EXPLAIN (ANALYZE, FORMAT JSON)"
				: "EXPLAIN (FORMAT JSON)";
			const result = await driver.execute(`${prefix} ${sql}`);
			const durationMs = Math.round(performance.now() - start);

			// PG returns a single row with a column named "QUERY PLAN"
			const jsonStr = result.rows[0]?.["QUERY PLAN"]
				?? result.rows[0]?.["EXPLAIN"]
				?? JSON.stringify(result.rows);
			const plan = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
			const planArray = Array.isArray(plan) ? plan : [plan];
			const nodes = planArray.map((p: Record<string, unknown>) =>
				parsePostgresNode(p["Plan"] as Record<string, unknown> ?? p),
			);

			// Build raw text by re-running with TEXT format (fallback to JSON)
			let rawText: string;
			try {
				const textPrefix = analyze ? "EXPLAIN (ANALYZE)" : "EXPLAIN";
				const textResult = await driver.execute(`${textPrefix} ${sql}`);
				rawText = textResult.rows
					.map((r) => Object.values(r)[0])
					.join("\n");
			} catch {
				rawText = JSON.stringify(plan, null, 2);
			}

			return { nodes, rawText, durationMs };
		} catch (err) {
			const durationMs = Math.round(performance.now() - start);
			return {
				nodes: [],
				rawText: "",
				durationMs,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	private async executeSingle(
		driver: DatabaseDriver,
		sql: string,
		params: unknown[] | undefined,
		timeoutMs: number,
		entry: RunningQuery,
	): Promise<QueryResult> {
		const start = performance.now();
		const { promise: timeoutPromise, cancel: cancelTimeout } = this.createTimeout(timeoutMs);

		try {
			const result = await Promise.race([
				driver.execute(sql, params),
				timeoutPromise,
			]);

			if (entry.cancelled) {
				return makeCancelledResult(performance.now() - start);
			}

			return {
				...result,
				durationMs: Math.round(performance.now() - start),
			};
		} catch (err) {
			const durationMs = Math.round(performance.now() - start);

			if (entry.cancelled) {
				return makeCancelledResult(durationMs);
			}

			const errorPosition = parseErrorPosition(err, sql);
			const errorCode = err instanceof DatabaseError ? err.code : undefined;

			return {
				columns: [],
				rows: [],
				rowCount: 0,
				durationMs,
				error: err instanceof Error ? err.message : String(err),
				errorCode,
				errorPosition,
			};
		} finally {
			cancelTimeout();
		}
	}

	private createTimeout(ms: number): { promise: Promise<never>; cancel: () => void } {
		let timer: ReturnType<typeof setTimeout>;
		const promise = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(`Query timed out after ${ms}ms`)), ms);
		});
		return { promise, cancel: () => clearTimeout(timer!) };
	}

	private logHistory(connectionId: string, sql: string, results: QueryResult[]): void {
		if (!this.appDb) return;

		const hasError = results.some((r) => r.error);
		const totalDuration = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
		const totalRows = results.reduce((sum, r) => sum + (r.affectedRows ?? r.rowCount), 0);
		const errorMessage = results.find((r) => r.error)?.error;

		try {
			this.appDb.addHistory({
				connectionId,
				sql,
				status: hasError ? "error" : "success",
				durationMs: Math.round(totalDuration),
				rowCount: totalRows,
				errorMessage,
			});
		} catch (err) {
			console.debug("History logging failed:", err instanceof Error ? err.message : err);
		}
	}
}

function makeCancelledResult(durationMs = 0): QueryResult {
	return {
		columns: [],
		rows: [],
		rowCount: 0,
		durationMs: Math.round(durationMs),
		error: "Query was cancelled",
	};
}

// ── EXPLAIN parsers ──────────────────────────────────────────

function parsePostgresNode(plan: Record<string, unknown>): ExplainNode {
	const children = (plan["Plans"] as Record<string, unknown>[] | undefined) ?? [];
	const { "Node Type": _, "Relation Name": __, "Plans": ___, ...rest } = plan;
	return {
		operation: String(plan["Node Type"] ?? "Unknown"),
		relation: plan["Relation Name"] ? String(plan["Relation Name"]) : undefined,
		cost: typeof plan["Total Cost"] === "number" ? plan["Total Cost"] : undefined,
		actualTime: typeof plan["Actual Total Time"] === "number" ? plan["Actual Total Time"] : undefined,
		estimatedRows: typeof plan["Plan Rows"] === "number" ? plan["Plan Rows"] : undefined,
		actualRows: typeof plan["Actual Rows"] === "number" ? plan["Actual Rows"] : undefined,
		extra: Object.keys(rest).length > 0 ? rest : undefined,
		children: children.map((c) => parsePostgresNode(c)),
	};
}

function parseSqliteExplain(rows: Record<string, unknown>[]): ExplainNode[] {
	// SQLite EXPLAIN QUERY PLAN returns: id, parent, notused, detail
	const nodeMap = new Map<number, ExplainNode>();
	const childMap = new Map<number, ExplainNode[]>();

	for (const row of rows) {
		const id = Number(row.id ?? row.selectid ?? 0);
		const parent = Number(row.parent ?? 0);
		const detail = String(row.detail ?? "");

		const node: ExplainNode = {
			operation: detail,
			children: [],
		};

		// Parse operation details like "SCAN users" or "SEARCH users USING INDEX ..."
		const scanMatch = detail.match(/^(SCAN|SEARCH|USE TEMP B-TREE)\s+(.*)/i);
		if (scanMatch) {
			node.operation = scanMatch[1];
			const tablePart = scanMatch[2];
			const tableMatch = tablePart.match(/^(\S+)/);
			if (tableMatch) {
				node.relation = tableMatch[1];
			}
		}

		nodeMap.set(id, node);
		if (!childMap.has(parent)) {
			childMap.set(parent, []);
		}
		childMap.get(parent)!.push(node);
	}

	// Attach children
	for (const [id, node] of nodeMap) {
		node.children = childMap.get(id) ?? [];
	}

	// Return root nodes (parent = 0 or nodes whose parent doesn't exist in the map)
	return childMap.get(0) ?? [...nodeMap.values()].filter((_, i) => {
		const row = rows[i];
		const parent = Number(row?.parent ?? 0);
		return !nodeMap.has(parent);
	});
}
