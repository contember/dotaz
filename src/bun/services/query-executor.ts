import type { DatabaseDriver } from "../db/driver";
import type { QueryResult } from "../../shared/types/query";
import type { ConnectionManager } from "./connection-manager";
import type { AppDatabase } from "../storage/app-db";
import { splitStatements, parseErrorPosition } from "../../shared/sql/statements";

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
export { splitStatements, offsetToLineColumn, parseErrorPosition } from "../../shared/sql/statements";

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
		} catch {
			// Driver may already have completed; ignore cancel errors
		}

		return true;
	}

	/**
	 * Get the list of currently running query IDs.
	 */
	getRunningQueryIds(): string[] {
		return [...this.runningQueries.keys()];
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

			return {
				columns: [],
				rows: [],
				rowCount: 0,
				durationMs,
				error: err instanceof Error ? err.message : String(err),
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
		} catch {
			// Don't let history logging failures break query execution
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
