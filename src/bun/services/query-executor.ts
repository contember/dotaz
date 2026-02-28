import type { DatabaseDriver } from "../db/driver";
import type { ColumnFilter, SortColumn } from "../../shared/types/grid";
import type { QueryResult } from "../../shared/types/query";
import type { DataChange } from "../../shared/types/rpc";
import type { ConnectionManager } from "./connection-manager";
import type { AppDatabase } from "../storage/app-db";

export interface WhereClauseResult {
	sql: string;
	params: unknown[];
}

/**
 * Build a WHERE clause from an array of column filters.
 * Returns the SQL fragment (including "WHERE") and the parameter values.
 * If no filters, returns empty string and empty params.
 */
export function buildWhereClause(
	filters: ColumnFilter[] | undefined,
	driver: DatabaseDriver,
	paramOffset = 0,
): WhereClauseResult {
	if (!filters || filters.length === 0) {
		return { sql: "", params: [] };
	}

	const conditions: string[] = [];
	const params: unknown[] = [];
	let paramIndex = paramOffset;

	for (const filter of filters) {
		const col = driver.quoteIdentifier(filter.column);

		switch (filter.operator) {
			case "eq":
				paramIndex++;
				conditions.push(`${col} = $${paramIndex}`);
				params.push(filter.value);
				break;
			case "neq":
				paramIndex++;
				conditions.push(`${col} != $${paramIndex}`);
				params.push(filter.value);
				break;
			case "gt":
				paramIndex++;
				conditions.push(`${col} > $${paramIndex}`);
				params.push(filter.value);
				break;
			case "gte":
				paramIndex++;
				conditions.push(`${col} >= $${paramIndex}`);
				params.push(filter.value);
				break;
			case "lt":
				paramIndex++;
				conditions.push(`${col} < $${paramIndex}`);
				params.push(filter.value);
				break;
			case "lte":
				paramIndex++;
				conditions.push(`${col} <= $${paramIndex}`);
				params.push(filter.value);
				break;
			case "like":
				paramIndex++;
				conditions.push(`${col} LIKE $${paramIndex}`);
				params.push(filter.value);
				break;
			case "notLike":
				paramIndex++;
				conditions.push(`${col} NOT LIKE $${paramIndex}`);
				params.push(filter.value);
				break;
			case "in": {
				const values = Array.isArray(filter.value) ? filter.value : [filter.value];
				const placeholders = values.map(() => {
					paramIndex++;
					return `$${paramIndex}`;
				});
				conditions.push(`${col} IN (${placeholders.join(", ")})`);
				params.push(...values);
				break;
			}
			case "notIn": {
				const values = Array.isArray(filter.value) ? filter.value : [filter.value];
				const placeholders = values.map(() => {
					paramIndex++;
					return `$${paramIndex}`;
				});
				conditions.push(`${col} NOT IN (${placeholders.join(", ")})`);
				params.push(...values);
				break;
			}
			case "isNull":
				conditions.push(`${col} IS NULL`);
				break;
			case "isNotNull":
				conditions.push(`${col} IS NOT NULL`);
				break;
		}
	}

	return {
		sql: `WHERE ${conditions.join(" AND ")}`,
		params,
	};
}

/**
 * Build an ORDER BY clause from sort column specifications.
 * Returns the SQL fragment (including "ORDER BY") or empty string if no sorts.
 */
export function buildOrderByClause(
	sort: SortColumn[] | undefined,
	driver: DatabaseDriver,
): string {
	if (!sort || sort.length === 0) {
		return "";
	}

	const clauses = sort.map((s) => {
		const col = driver.quoteIdentifier(s.column);
		const dir = s.direction === "desc" ? "DESC" : "ASC";
		return `${col} ${dir}`;
	});

	return `ORDER BY ${clauses.join(", ")}`;
}

/**
 * Qualify a table name with its schema. For SQLite "main" schema, skip qualification.
 */
export function qualifyTable(schema: string, table: string, driver: DatabaseDriver): string {
	if (driver.getDriverType() === "sqlite" && schema === "main") {
		return driver.quoteIdentifier(table);
	}
	return `${driver.quoteIdentifier(schema)}.${driver.quoteIdentifier(table)}`;
}

/**
 * Build a complete SELECT query with pagination, sorting, and filtering.
 * Returns the SQL string and parameter values.
 */
export function buildSelectQuery(
	schema: string,
	table: string,
	page: number,
	pageSize: number,
	sort: SortColumn[] | undefined,
	filters: ColumnFilter[] | undefined,
	driver: DatabaseDriver,
): { sql: string; params: unknown[] } {
	const from = qualifyTable(schema, table, driver);
	const where = buildWhereClause(filters, driver);
	const orderBy = buildOrderByClause(sort, driver);

	const offset = (page - 1) * pageSize;
	let paramIndex = where.params.length;

	paramIndex++;
	const limitParam = `$${paramIndex}`;
	paramIndex++;
	const offsetParam = `$${paramIndex}`;

	const parts = [`SELECT * FROM ${from}`];
	if (where.sql) parts.push(where.sql);
	if (orderBy) parts.push(orderBy);
	parts.push(`LIMIT ${limitParam} OFFSET ${offsetParam}`);

	return {
		sql: parts.join(" "),
		params: [...where.params, pageSize, offset],
	};
}

/**
 * Build a COUNT(*) query with optional filtering.
 * Returns the SQL string and parameter values.
 */
export function buildCountQuery(
	schema: string,
	table: string,
	filters: ColumnFilter[] | undefined,
	driver: DatabaseDriver,
): { sql: string; params: unknown[] } {
	const from = qualifyTable(schema, table, driver);
	const where = buildWhereClause(filters, driver);

	const parts = [`SELECT COUNT(*) AS count FROM ${from}`];
	if (where.sql) parts.push(where.sql);

	return {
		sql: parts.join(" "),
		params: where.params,
	};
}

// ── Statement splitting ────────────────────────────────────

/**
 * Split a SQL string into individual statements by semicolons.
 * Respects quoted strings (single and double quotes) so semicolons
 * inside string literals are not treated as delimiters.
 */
export function splitStatements(sql: string): string[] {
	const statements: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		const prev = i > 0 ? sql[i - 1] : "";

		if (ch === "'" && !inDouble && prev !== "\\") {
			inSingle = !inSingle;
		} else if (ch === '"' && !inSingle && prev !== "\\") {
			inDouble = !inDouble;
		}

		if (ch === ";" && !inSingle && !inDouble) {
			const trimmed = current.trim();
			if (trimmed.length > 0) {
				statements.push(trimmed);
			}
			current = "";
		} else {
			current += ch;
		}
	}

	const trimmed = current.trim();
	if (trimmed.length > 0) {
		statements.push(trimmed);
	}

	return statements;
}

// ── Data Editing SQL Generation ─────────────────────────────

export interface GeneratedStatement {
	sql: string;
	params: unknown[];
}

/**
 * Generate an INSERT statement from a DataChange.
 */
export function generateInsert(change: DataChange, driver: DatabaseDriver): GeneratedStatement {
	const values = change.values;
	if (!values || Object.keys(values).length === 0) {
		throw new Error("INSERT change requires values");
	}

	const table = qualifyTable(change.schema, change.table, driver);
	const columns = Object.keys(values);
	const quotedCols = columns.map((c) => driver.quoteIdentifier(c));
	const placeholders = columns.map((_, i) => `$${i + 1}`);
	const params = columns.map((c) => values[c]);

	return {
		sql: `INSERT INTO ${table} (${quotedCols.join(", ")}) VALUES (${placeholders.join(", ")})`,
		params,
	};
}

/**
 * Generate an UPDATE statement from a DataChange.
 * Only updates the columns specified in `values`.
 */
export function generateUpdate(change: DataChange, driver: DatabaseDriver): GeneratedStatement {
	const { primaryKeys, values } = change;
	if (!primaryKeys || Object.keys(primaryKeys).length === 0) {
		throw new Error("UPDATE change requires primaryKeys");
	}
	if (!values || Object.keys(values).length === 0) {
		throw new Error("UPDATE change requires values");
	}

	const table = qualifyTable(change.schema, change.table, driver);
	const setCols = Object.keys(values);
	const pkCols = Object.keys(primaryKeys);
	const params: unknown[] = [];
	let paramIndex = 0;

	const setClauses = setCols.map((col) => {
		paramIndex++;
		params.push(values[col]);
		return `${driver.quoteIdentifier(col)} = $${paramIndex}`;
	});

	const whereClauses = pkCols.map((col) => {
		paramIndex++;
		params.push(primaryKeys[col]);
		return `${driver.quoteIdentifier(col)} = $${paramIndex}`;
	});

	return {
		sql: `UPDATE ${table} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`,
		params,
	};
}

/**
 * Generate a DELETE statement from a DataChange.
 */
export function generateDelete(change: DataChange, driver: DatabaseDriver): GeneratedStatement {
	const { primaryKeys } = change;
	if (!primaryKeys || Object.keys(primaryKeys).length === 0) {
		throw new Error("DELETE change requires primaryKeys");
	}

	const table = qualifyTable(change.schema, change.table, driver);
	const pkCols = Object.keys(primaryKeys);
	const params: unknown[] = [];

	const whereClauses = pkCols.map((col, i) => {
		params.push(primaryKeys[col]);
		return `${driver.quoteIdentifier(col)} = $${i + 1}`;
	});

	return {
		sql: `DELETE FROM ${table} WHERE ${whereClauses.join(" AND ")}`,
		params,
	};
}

/**
 * Generate a parameterized SQL statement for a single DataChange.
 */
export function generateChangeSql(change: DataChange, driver: DatabaseDriver): GeneratedStatement {
	switch (change.type) {
		case "insert":
			return generateInsert(change, driver);
		case "update":
			return generateUpdate(change, driver);
		case "delete":
			return generateDelete(change, driver);
		default:
			throw new Error(`Unknown change type: ${(change as any).type}`);
	}
}

/**
 * Format a value for readable SQL preview (not for execution).
 */
function formatValueForPreview(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	if (typeof value === "string") {
		return `'${value.replace(/'/g, "''")}'`;
	}
	if (typeof value === "object") {
		return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
	}
	return String(value);
}

/**
 * Generate a human-readable SQL string for a single DataChange (for preview).
 * Values are inlined rather than parameterized.
 */
export function generateChangePreview(change: DataChange, driver: DatabaseDriver): string {
	const table = qualifyTable(change.schema, change.table, driver);

	switch (change.type) {
		case "insert": {
			const values = change.values!;
			const columns = Object.keys(values);
			const quotedCols = columns.map((c) => driver.quoteIdentifier(c));
			const formattedVals = columns.map((c) => formatValueForPreview(values[c]));
			return `INSERT INTO ${table} (${quotedCols.join(", ")}) VALUES (${formattedVals.join(", ")});`;
		}
		case "update": {
			const { primaryKeys, values } = change;
			const setCols = Object.keys(values!);
			const pkCols = Object.keys(primaryKeys!);
			const setClauses = setCols.map(
				(col) => `${driver.quoteIdentifier(col)} = ${formatValueForPreview(values![col])}`,
			);
			const whereClauses = pkCols.map(
				(col) => `${driver.quoteIdentifier(col)} = ${formatValueForPreview(primaryKeys![col])}`,
			);
			return `UPDATE ${table} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")};`;
		}
		case "delete": {
			const { primaryKeys } = change;
			const pkCols = Object.keys(primaryKeys!);
			const whereClauses = pkCols.map(
				(col) => `${driver.quoteIdentifier(col)} = ${formatValueForPreview(primaryKeys![col])}`,
			);
			return `DELETE FROM ${table} WHERE ${whereClauses.join(" AND ")};`;
		}
		default:
			throw new Error(`Unknown change type: ${(change as any).type}`);
	}
}

/**
 * Generate a readable SQL preview for multiple changes.
 */
export function generateChangesPreview(changes: DataChange[], driver: DatabaseDriver): string {
	return changes.map((c) => generateChangePreview(c, driver)).join("\n");
}

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
	): Promise<QueryResult[]> {
		const driver = this.connectionManager.getDriver(connectionId);
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

		try {
			const result = await Promise.race([
				driver.execute(sql, params),
				this.createTimeout(timeoutMs),
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

			return {
				columns: [],
				rows: [],
				rowCount: 0,
				durationMs,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	private createTimeout(ms: number): Promise<never> {
		return new Promise((_, reject) => {
			setTimeout(() => reject(new Error(`Query timed out after ${ms}ms`)), ms);
		});
	}

	private logHistory(connectionId: string, sql: string, results: QueryResult[]): void {
		if (!this.appDb) return;

		const hasError = results.some((r) => r.error);
		const totalDuration = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
		const totalRows = results.reduce((sum, r) => sum + r.rowCount, 0);
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
