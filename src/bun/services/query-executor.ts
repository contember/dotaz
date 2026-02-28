import type { DatabaseDriver } from "../db/driver";
import type { ColumnFilter, SortColumn } from "../../shared/types/grid";

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
function qualifyTable(schema: string, table: string, driver: DatabaseDriver): string {
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
