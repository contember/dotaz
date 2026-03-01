import type { DatabaseDriver } from "../db/driver";
import type {
	ImportFormat,
	CsvDelimiter,
	ColumnMapping,
	ImportPreviewResult,
	ImportResult,
} from "../../shared/types/import";

const DEFAULT_BATCH_SIZE = 100;

export interface ImportParseParams {
	fileContent: string;
	format: ImportFormat;
	delimiter?: CsvDelimiter;
	hasHeader?: boolean;
}

/**
 * Parse file content and return a preview of the data.
 */
export function parseImportPreview(
	params: ImportParseParams,
	limit?: number,
): ImportPreviewResult {
	const rows = parseFileContent(params);
	const fileColumns = collectColumns(rows);
	const previewLimit = limit ?? 20;
	return {
		fileColumns,
		rows: rows.slice(0, previewLimit),
		totalRows: rows.length,
	};
}

/**
 * Import data into a table using batched INSERT statements wrapped in a transaction.
 */
export async function importData(
	driver: DatabaseDriver,
	params: {
		schema: string;
		table: string;
		fileContent: string;
		format: ImportFormat;
		delimiter?: CsvDelimiter;
		hasHeader?: boolean;
		mappings: ColumnMapping[];
		batchSize?: number;
	},
): Promise<ImportResult> {
	const rows = parseFileContent({
		fileContent: params.fileContent,
		format: params.format,
		delimiter: params.delimiter,
		hasHeader: params.hasHeader,
	});

	// Filter mappings to only those with a target table column
	const activeMappings = params.mappings.filter((m) => m.tableColumn !== null);
	if (activeMappings.length === 0) {
		throw new Error("No columns mapped for import");
	}

	const batchSize = params.batchSize ?? DEFAULT_BATCH_SIZE;
	const qualifiedTable = driver.qualifyTable(params.schema, params.table);
	const quotedCols = activeMappings.map((m) => driver.quoteIdentifier(m.tableColumn!));
	const colList = quotedCols.join(", ");

	// Build and execute batched INSERT statements inside a transaction
	const inExistingTx = driver.inTransaction();
	if (!inExistingTx) {
		await driver.beginTransaction();
	}

	try {
		let totalInserted = 0;

		for (let offset = 0; offset < rows.length; offset += batchSize) {
			const batch = rows.slice(offset, offset + batchSize);
			const placeholders: string[] = [];
			const allParams: unknown[] = [];
			let paramIndex = 0;

			for (const row of batch) {
				const rowPlaceholders: string[] = [];
				for (const mapping of activeMappings) {
					paramIndex++;
					rowPlaceholders.push(driver.placeholder(paramIndex));
					allParams.push(row[mapping.fileColumn] ?? null);
				}
				placeholders.push(`(${rowPlaceholders.join(", ")})`);
			}

			const sql = `INSERT INTO ${qualifiedTable} (${colList}) VALUES ${placeholders.join(", ")}`;
			await driver.execute(sql, allParams);
			totalInserted += batch.length;
		}

		if (!inExistingTx) {
			await driver.commit();
		}

		return { rowCount: totalInserted };
	} catch (err) {
		if (!inExistingTx) {
			try {
				await driver.rollback();
			} catch (rbErr) {
				console.debug("Rollback after import error failed:", rbErr instanceof Error ? rbErr.message : rbErr);
			}
		}
		throw err;
	}
}

// ── Parsing ────────────────────────────────────────────────

function parseFileContent(params: ImportParseParams): Record<string, unknown>[] {
	switch (params.format) {
		case "csv":
			return parseCsv(params.fileContent, params.delimiter ?? ",", params.hasHeader ?? true);
		case "json":
			return parseJson(params.fileContent);
	}
}

/**
 * Parse CSV content into rows of objects.
 */
export function parseCsv(
	content: string,
	delimiter: CsvDelimiter,
	hasHeader: boolean,
): Record<string, unknown>[] {
	const lines = parseCsvLines(content, delimiter);
	if (lines.length === 0) return [];

	let headers: string[];
	let dataStartIndex: number;

	if (hasHeader) {
		headers = lines[0];
		dataStartIndex = 1;
	} else {
		// Generate column names: col1, col2, ...
		headers = lines[0].map((_, i) => `col${i + 1}`);
		dataStartIndex = 0;
	}

	const rows: Record<string, unknown>[] = [];
	for (let i = dataStartIndex; i < lines.length; i++) {
		const line = lines[i];
		const row: Record<string, unknown> = {};
		for (let j = 0; j < headers.length; j++) {
			const value = j < line.length ? line[j] : null;
			row[headers[j]] = value === "" ? null : coerceValue(value as string);
		}
		rows.push(row);
	}

	return rows;
}

/**
 * Parse CSV text into a 2D array of strings, handling quoted fields.
 */
function parseCsvLines(content: string, delimiter: CsvDelimiter): string[][] {
	const lines: string[][] = [];
	let current: string[] = [];
	let field = "";
	let inQuotes = false;
	let i = 0;

	while (i < content.length) {
		const ch = content[i];

		if (inQuotes) {
			if (ch === '"') {
				if (i + 1 < content.length && content[i + 1] === '"') {
					// Escaped quote
					field += '"';
					i += 2;
				} else {
					// End of quoted field
					inQuotes = false;
					i++;
				}
			} else {
				field += ch;
				i++;
			}
		} else {
			if (ch === '"') {
				inQuotes = true;
				i++;
			} else if (ch === delimiter || (delimiter === "\t" && ch === "\t")) {
				current.push(field);
				field = "";
				i++;
			} else if (ch === "\r") {
				// Handle \r\n and standalone \r
				current.push(field);
				field = "";
				if (current.some((f) => f !== "") || current.length > 1) {
					lines.push(current);
				}
				current = [];
				i++;
				if (i < content.length && content[i] === "\n") {
					i++;
				}
			} else if (ch === "\n") {
				current.push(field);
				field = "";
				if (current.some((f) => f !== "") || current.length > 1) {
					lines.push(current);
				}
				current = [];
				i++;
			} else {
				field += ch;
				i++;
			}
		}
	}

	// Last field/line
	if (field !== "" || current.length > 0) {
		current.push(field);
		if (current.some((f) => f !== "") || current.length > 1) {
			lines.push(current);
		}
	}

	return lines;
}

/**
 * Attempt to coerce a string value to a more appropriate type.
 */
function coerceValue(value: string | null): unknown {
	if (value === null || value === "") return null;

	// Boolean
	const lower = value.toLowerCase();
	if (lower === "true") return true;
	if (lower === "false") return false;

	// Number
	if (/^-?\d+$/.test(value)) {
		const n = parseInt(value, 10);
		if (Number.isSafeInteger(n)) return n;
	}
	if (/^-?\d+\.\d+$/.test(value)) {
		const n = parseFloat(value);
		if (isFinite(n)) return n;
	}

	return value;
}

/**
 * Parse JSON content. Expects an array of objects.
 */
export function parseJson(content: string): Record<string, unknown>[] {
	const parsed = JSON.parse(content);

	if (!Array.isArray(parsed)) {
		throw new Error("JSON import expects an array of objects");
	}

	const rows: Record<string, unknown>[] = [];
	for (const item of parsed) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			throw new Error("Each JSON array element must be an object");
		}
		rows.push(item as Record<string, unknown>);
	}

	return rows;
}

// ── Helpers ────────────────────────────────────────────────

function collectColumns(rows: Record<string, unknown>[]): string[] {
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
