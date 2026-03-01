import type { DatabaseDriver } from "../db/driver";
import type { ColumnFilter, SortColumn } from "../../shared/types/grid";
import type { ExportFormat, CsvDelimiter, CsvEncoding } from "../../shared/types/export";
import { buildWhereClause, buildOrderByClause } from "../../shared/sql/builders";

const BATCH_SIZE = 1000;

export interface ExportParams {
	schema: string;
	table: string;
	format: ExportFormat;
	columns?: string[];
	includeHeaders?: boolean;
	delimiter?: CsvDelimiter;
	encoding?: CsvEncoding;
	utf8Bom?: boolean;
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
	const encode = createEncoder(params.format === "csv" ? params.encoding : undefined);

	try {
		const formatter = createFormatter(params, driver);

		// Write UTF-8 BOM if requested
		if (params.format === "csv" && params.utf8Bom && (params.encoding ?? "utf-8") === "utf-8") {
			writer.write(new Uint8Array([0xEF, 0xBB, 0xBF]));
		}

		// Write header/preamble
		const preamble = formatter.preamble();
		if (preamble) writer.write(encode(preamble));

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
			writer.write(encode(chunk));

			totalRows += rows.length;
			offset += rows.length;
			isFirst = false;

			if (rows.length < batchLimit) break;
		}

		// Write footer/epilogue
		const epilogue = formatter.epilogue();
		if (epilogue) writer.write(encode(epilogue));

		await writer.end();

		const stat = await Bun.file(filePath).stat();
		return { rowCount: totalRows, sizeBytes: stat?.size ?? 0 };
	} catch (err) {
		await writer.end();
		try {
			const { unlink } = await import("node:fs/promises");
			await unlink(filePath);
		} catch {
			// Best-effort cleanup
		}
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
	const from = driver.qualifyTable(schema, table);
	const columnList = columns && columns.length > 0
		? columns.map((c) => driver.quoteIdentifier(c)).join(", ")
		: "*";
	const where = buildWhereClause(filters, driver);
	const orderBy = buildOrderByClause(sort, driver);

	let paramIndex = where.params.length;
	paramIndex++;
	const limitParam = driver.placeholder(paramIndex);
	paramIndex++;
	const offsetParam = driver.placeholder(paramIndex);

	const parts = [`SELECT ${columnList} FROM ${from}`];
	if (where.sql) parts.push(where.sql);
	if (orderBy) parts.push(orderBy);
	parts.push(`LIMIT ${limitParam} OFFSET ${offsetParam}`);

	return {
		sql: parts.join(" "),
		params: [...where.params, limit, offset],
	};
}

// ── Helpers ────────────────────────────────────────────────

/** Collect all unique column names across all rows, preserving insertion order. */
function collectAllColumns(rows: Record<string, unknown>[]): string[] {
	const seen = new Set<string>();
	const columns: string[] = [];
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			if (!seen.has(key)) {
				seen.add(key);
				columns.push(key);
			}
		}
	}
	return columns;
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
		case "markdown":
			return new MarkdownFormatter();
		case "sql_update":
			return new SqlUpdateFormatter(params.schema, params.table, driver);
		case "html":
			return new HtmlFormatter();
		case "xml":
			return new XmlFormatter();
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

	private columns: string[] | null = null;

	formatBatch(rows: Record<string, unknown>[], isFirst: boolean): string {
		if (rows.length === 0) return "";

		// Derive columns from the first batch; subsequent batches reuse the same set
		if (!this.columns) {
			this.columns = collectAllColumns(rows);
		}
		const columns = this.columns;

		const lines: string[] = [];

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
		this.tableName = driver.qualifyTable(schema, table);
	}

	preamble(): string {
		return "";
	}

	private columns: string[] | null = null;

	formatBatch(rows: Record<string, unknown>[], _isFirst: boolean): string {
		if (rows.length === 0) return "";

		// Derive columns from the first batch; subsequent batches reuse the same set
		if (!this.columns) {
			this.columns = collectAllColumns(rows);
		}
		const columns = this.columns;
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

// ── Markdown ───────────────────────────────────────────────

class MarkdownFormatter implements Formatter {
	private columns: string[] | null = null;

	preamble(): string {
		return "";
	}

	formatBatch(rows: Record<string, unknown>[], isFirst: boolean): string {
		if (rows.length === 0) return "";

		if (!this.columns) {
			this.columns = collectAllColumns(rows);
		}
		const columns = this.columns;
		const lines: string[] = [];

		if (isFirst) {
			lines.push("| " + columns.map(escapeMarkdownCell).join(" | ") + " |");
			lines.push("| " + columns.map(() => "---").join(" | ") + " |");
		}

		for (const row of rows) {
			const cells = columns.map((col) => escapeMarkdownCell(formatMarkdownValue(row[col])));
			lines.push("| " + cells.join(" | ") + " |");
		}

		return lines.join("\n") + "\n";
	}

	epilogue(): string {
		return "";
	}
}

function formatMarkdownValue(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function escapeMarkdownCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ── SQL UPDATE ─────────────────────────────────────────────

class SqlUpdateFormatter implements Formatter {
	private tableName: string;
	private columns: string[] | null = null;

	constructor(
		schema: string,
		table: string,
		driver: DatabaseDriver,
	) {
		this.tableName = driver.qualifyTable(schema, table);
	}

	preamble(): string {
		return "";
	}

	formatBatch(rows: Record<string, unknown>[], _isFirst: boolean): string {
		if (rows.length === 0) return "";

		if (!this.columns) {
			this.columns = collectAllColumns(rows);
		}
		const columns = this.columns;

		// Use first column as PK for WHERE clause (convention: first column is typically the PK)
		const pkColumn = columns[0];
		const setCols = columns.slice(1);

		const statements: string[] = [];

		for (const row of rows) {
			if (setCols.length === 0) continue;

			const setClause = setCols
				.map((col) => `"${col.replace(/"/g, '""')}" = ${formatSqlValue(row[col])}`)
				.join(", ");
			const whereClause = `"${pkColumn.replace(/"/g, '""')}" = ${formatSqlValue(row[pkColumn])}`;

			statements.push(
				`UPDATE ${this.tableName} SET ${setClause} WHERE ${whereClause};\n`,
			);
		}

		return statements.join("");
	}

	epilogue(): string {
		return "";
	}
}

// ── HTML ───────────────────────────────────────────────────

class HtmlFormatter implements Formatter {
	private columns: string[] | null = null;

	preamble(): string {
		return "<table>\n";
	}

	formatBatch(rows: Record<string, unknown>[], isFirst: boolean): string {
		if (rows.length === 0) return "";

		if (!this.columns) {
			this.columns = collectAllColumns(rows);
		}
		const columns = this.columns;
		const lines: string[] = [];

		if (isFirst) {
			lines.push("  <thead>");
			lines.push("    <tr>");
			for (const col of columns) {
				lines.push(`      <th>${escapeHtml(col)}</th>`);
			}
			lines.push("    </tr>");
			lines.push("  </thead>");
			lines.push("  <tbody>");
		}

		for (const row of rows) {
			lines.push("    <tr>");
			for (const col of columns) {
				const value = row[col];
				const display = value === null || value === undefined
					? ""
					: typeof value === "object"
						? escapeHtml(JSON.stringify(value))
						: escapeHtml(String(value));
				lines.push(`      <td>${display}</td>`);
			}
			lines.push("    </tr>");
		}

		return lines.join("\n") + "\n";
	}

	epilogue(): string {
		return "  </tbody>\n</table>\n";
	}
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// ── XML ────────────────────────────────────────────────────

class XmlFormatter implements Formatter {
	private columns: string[] | null = null;

	preamble(): string {
		return '<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n';
	}

	formatBatch(rows: Record<string, unknown>[], _isFirst: boolean): string {
		if (rows.length === 0) return "";

		if (!this.columns) {
			this.columns = collectAllColumns(rows);
		}
		const columns = this.columns;
		const lines: string[] = [];

		for (const row of rows) {
			lines.push("  <row>");
			for (const col of columns) {
				const value = row[col];
				const tag = xmlSafeTag(col);
				if (value === null || value === undefined) {
					lines.push(`    <${tag} xsi:nil="true"/>`);
				} else {
					const display = typeof value === "object"
						? escapeXml(JSON.stringify(value))
						: escapeXml(String(value));
					lines.push(`    <${tag}>${display}</${tag}>`);
				}
			}
			lines.push("  </row>");
		}

		return lines.join("\n") + "\n";
	}

	epilogue(): string {
		return "</rows>\n";
	}
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** Convert a column name to a valid XML tag name. */
function xmlSafeTag(name: string): string {
	// XML tags must start with a letter or underscore, contain only letters/digits/hyphens/dots/underscores
	let tag = name.replace(/[^a-zA-Z0-9_.\-]/g, "_");
	if (!/^[a-zA-Z_]/.test(tag)) tag = "_" + tag;
	return tag;
}

// ── Encoding ───────────────────────────────────────────────

/** Unicode codepoint → Windows-1252 byte for the 0x80–0x9F range */
const UNICODE_TO_WIN1252: Record<number, number> = {
	0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
	0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
	0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
	0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
	0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
	0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
	0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};

function encodeToLatin1(str: string): Uint8Array {
	const buf = new Uint8Array(str.length);
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		buf[i] = code <= 0xFF ? code : 0x3F; // '?' for unmappable
	}
	return buf;
}

function encodeToWindows1252(str: string): Uint8Array {
	const buf = new Uint8Array(str.length);
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code <= 0xFF) {
			buf[i] = code;
		} else {
			buf[i] = UNICODE_TO_WIN1252[code] ?? 0x3F; // '?' for unmappable
		}
	}
	return buf;
}

type ChunkEncoder = (str: string) => string | Uint8Array;

function createEncoder(encoding?: CsvEncoding): ChunkEncoder {
	switch (encoding) {
		case "iso-8859-1":
			return encodeToLatin1;
		case "windows-1252":
			return encodeToWindows1252;
		default:
			return (str) => str; // UTF-8 — BunFileWriter handles string→UTF-8
	}
}
