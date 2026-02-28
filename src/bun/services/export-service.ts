import type { DatabaseDriver } from "../db/driver";
import type { ColumnFilter, SortColumn } from "../../shared/types/grid";
import type { ExportFormat, CsvDelimiter } from "../../shared/types/export";
import { buildWhereClause, buildOrderByClause, qualifyTable } from "./query-executor";

const BATCH_SIZE = 1000;

export interface ExportParams {
	schema: string;
	table: string;
	format: ExportFormat;
	columns?: string[];
	includeHeaders?: boolean;
	delimiter?: CsvDelimiter;
	batchSize?: number;
	filters?: ColumnFilter[];
	sort?: SortColumn[];
	limit?: number;
}

export interface ExportFileResult {
	rowCount: number;
	sizeBytes: number;
}

/**
 * Export data from a table to a file in CSV, JSON, or SQL INSERT format.
 * Uses batched fetching to avoid OOM on large datasets.
 */
export async function exportToFile(
	driver: DatabaseDriver,
	params: ExportParams,
	filePath: string,
): Promise<ExportFileResult> {
	const file = Bun.file(filePath);
	const writer = file.writer();
	let totalRows = 0;

	try {
		const formatter = createFormatter(params, driver);

		// Write header/preamble
		const preamble = formatter.preamble();
		if (preamble) writer.write(preamble);

		let offset = 0;
		let isFirst = true;
		const fetchLimit = params.limit;

		while (true) {
			const batchLimit = fetchLimit !== undefined
				? Math.min(BATCH_SIZE, fetchLimit - offset)
				: BATCH_SIZE;

			if (batchLimit <= 0) break;

			const { sql, params: queryParams } = buildExportQuery(
				params.schema, params.table, params.columns,
				params.filters, params.sort, batchLimit, offset, driver,
			);

			const result = await driver.execute(sql, queryParams);
			const rows = result.rows;
			if (rows.length === 0) break;

			const chunk = formatter.formatBatch(rows, isFirst);
			writer.write(chunk);

			totalRows += rows.length;
			offset += rows.length;
			isFirst = false;

			if (rows.length < batchLimit) break;
		}

		// Write footer/epilogue
		const epilogue = formatter.epilogue();
		if (epilogue) writer.write(epilogue);

		await writer.end();

		const stat = await Bun.file(filePath).stat();
		return { rowCount: totalRows, sizeBytes: stat?.size ?? 0 };
	} catch (err) {
		await writer.end();
		throw err;
	}
}

/**
 * Generate a preview string of the first N rows in the given format.
 */
export async function exportPreview(
	driver: DatabaseDriver,
	params: ExportParams,
): Promise<string> {
	const limit = params.limit ?? 10;
	const { sql, params: queryParams } = buildExportQuery(
		params.schema, params.table, params.columns,
		params.filters, params.sort, limit, 0, driver,
	);

	const result = await driver.execute(sql, queryParams);
	const rows = result.rows;

	const formatter = createFormatter(params, driver);
	const parts: string[] = [];

	const preamble = formatter.preamble();
	if (preamble) parts.push(preamble);

	parts.push(formatter.formatBatch(rows, true));

	const epilogue = formatter.epilogue();
	if (epilogue) parts.push(epilogue);

	return parts.join("");
}

// ── Query building ─────────────────────────────────────────

function buildExportQuery(
	schema: string,
	table: string,
	columns: string[] | undefined,
	filters: ColumnFilter[] | undefined,
	sort: SortColumn[] | undefined,
	limit: number,
	offset: number,
	driver: DatabaseDriver,
): { sql: string; params: unknown[] } {
	const from = qualifyTable(schema, table, driver);
	const columnList = columns && columns.length > 0
		? columns.map((c) => driver.quoteIdentifier(c)).join(", ")
		: "*";
	const where = buildWhereClause(filters, driver);
	const orderBy = buildOrderByClause(sort, driver);

	let paramIndex = where.params.length;
	paramIndex++;
	const limitParam = `$${paramIndex}`;
	paramIndex++;
	const offsetParam = `$${paramIndex}`;

	const parts = [`SELECT ${columnList} FROM ${from}`];
	if (where.sql) parts.push(where.sql);
	if (orderBy) parts.push(orderBy);
	parts.push(`LIMIT ${limitParam} OFFSET ${offsetParam}`);

	return {
		sql: parts.join(" "),
		params: [...where.params, limit, offset],
	};
}

// ── Formatters ─────────────────────────────────────────────

interface Formatter {
	preamble(): string;
	formatBatch(rows: Record<string, unknown>[], isFirst: boolean): string;
	epilogue(): string;
}

function createFormatter(params: ExportParams, driver: DatabaseDriver): Formatter {
	switch (params.format) {
		case "csv":
			return new CsvFormatter(params.delimiter ?? ",", params.includeHeaders ?? true);
		case "json":
			return new JsonFormatter();
		case "sql":
			return new SqlInsertFormatter(
				params.schema, params.table, driver, params.batchSize ?? 100,
			);
	}
}

// ── CSV ────────────────────────────────────────────────────

class CsvFormatter implements Formatter {
	constructor(
		private delimiter: CsvDelimiter,
		private includeHeaders: boolean,
	) {}

	preamble(): string {
		return "";
	}

	formatBatch(rows: Record<string, unknown>[], isFirst: boolean): string {
		if (rows.length === 0) return "";

		const lines: string[] = [];
		const columns = Object.keys(rows[0]);

		if (isFirst && this.includeHeaders) {
			lines.push(columns.map((c) => this.escapeField(c)).join(this.delimiter));
		}

		for (const row of rows) {
			const fields = columns.map((col) => this.escapeField(formatCsvValue(row[col])));
			lines.push(fields.join(this.delimiter));
		}

		return lines.join("\n") + "\n";
	}

	epilogue(): string {
		return "";
	}

	private escapeField(value: string): string {
		if (value.includes(this.delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r")) {
			return `"${value.replace(/"/g, '""')}"`;
		}
		return value;
	}
}

function formatCsvValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

// ── JSON ───────────────────────────────────────────────────

class JsonFormatter implements Formatter {
	private hasWritten = false;

	preamble(): string {
		return "[\n";
	}

	formatBatch(rows: Record<string, unknown>[], _isFirst: boolean): string {
		if (rows.length === 0) return "";

		const lines = rows.map((row) => {
			const prefix = this.hasWritten ? ",\n" : "";
			this.hasWritten = true;
			return prefix + "  " + JSON.stringify(row);
		});

		return lines.join("");
	}

	epilogue(): string {
		return "\n]\n";
	}
}

// ── SQL INSERT ─────────────────────────────────────────────

class SqlInsertFormatter implements Formatter {
	private tableName: string;

	constructor(
		schema: string,
		table: string,
		driver: DatabaseDriver,
		private batchSize: number,
	) {
		this.tableName = qualifyTable(schema, table, driver);
	}

	preamble(): string {
		return "";
	}

	formatBatch(rows: Record<string, unknown>[], _isFirst: boolean): string {
		if (rows.length === 0) return "";

		const columns = Object.keys(rows[0]);
		const quotedCols = columns.map((c) => `"${c.replace(/"/g, '""')}"`);
		const colList = quotedCols.join(", ");

		const statements: string[] = [];

		for (let i = 0; i < rows.length; i += this.batchSize) {
			const batch = rows.slice(i, i + this.batchSize);
			const valueGroups = batch.map((row) => {
				const vals = columns.map((col) => formatSqlValue(row[col]));
				return `(${vals.join(", ")})`;
			});

			statements.push(
				`INSERT INTO ${this.tableName} (${colList}) VALUES\n${valueGroups.join(",\n")};\n`,
			);
		}

		return statements.join("\n");
	}

	epilogue(): string {
		return "";
	}
}

function formatSqlValue(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
	if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
	return String(value);
}
