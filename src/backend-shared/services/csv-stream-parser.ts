import type { CsvDelimiter } from "../../shared/types/import";

export interface CsvStreamOptions {
	delimiter: CsvDelimiter;
	hasHeader: boolean;
	batchSize: number;
	/** Stop after N data rows (for preview). Does not consume rest of stream. */
	maxRows?: number;
}

export interface CsvBatch {
	columns: string[];
	rows: Record<string, unknown>[];
}

const enum RowAction {
	Continue,
	Yield,
	Stop,
}

/**
 * Streaming CSV parser that processes a ReadableStream<Uint8Array> and yields
 * batches of parsed rows. RFC 4180 compliant with correct multi-byte UTF-8
 * handling at chunk boundaries.
 */
export async function* parseCsvStream(
	stream: ReadableStream<Uint8Array>,
	options: CsvStreamOptions,
): AsyncGenerator<CsvBatch> {
	const { delimiter, hasHeader, batchSize, maxRows } = options;
	const decoder = new TextDecoder("utf-8");
	const reader = stream.getReader();

	let buffer = "";
	let pos = 0;
	let inQuotes = false;
	let field = "";
	let currentRow: string[] = [];
	let lineNumber = 1;
	let columns: string[] | null = null;
	let dataRowCount = 0;
	let batch: Record<string, unknown>[] = [];
	let streamDone = false;

	/**
	 * Process a completed row. Mutates columns/batch/dataRowCount.
	 * Returns an action to tell the caller what to do next.
	 */
	function handleCompletedRow(fields: string[]): RowAction {
		// Skip empty rows (single empty field from trailing newline)
		if (fields.length === 1 && fields[0] === "") {
			return RowAction.Continue;
		}

		if (columns === null) {
			if (hasHeader) {
				columns = fields;
				return RowAction.Continue;
			}
			columns = fields.map((_, i) => `col${i + 1}`);
		}

		batch.push(buildRecord(fields, columns));
		dataRowCount++;

		if (maxRows !== undefined && dataRowCount >= maxRows) {
			return RowAction.Stop;
		}
		if (batch.length >= batchSize) {
			return RowAction.Yield;
		}
		return RowAction.Continue;
	}

	try {
		while (!streamDone) {
			const result = await reader.read();
			if (result.done) {
				buffer += decoder.decode(new Uint8Array(0), { stream: false });
				streamDone = true;
			} else {
				buffer += decoder.decode(result.value, { stream: true });
			}

			// Process characters in the buffer
			outer: while (pos < buffer.length) {
				const ch = buffer[pos];

				if (inQuotes) {
					if (ch === '"') {
						if (pos + 1 < buffer.length) {
							if (buffer[pos + 1] === '"') {
								field += '"';
								pos += 2;
							} else {
								inQuotes = false;
								pos++;
							}
						} else if (streamDone) {
							inQuotes = false;
							pos++;
						} else {
							break;
						}
					} else {
						if (ch === "\n") {
							lineNumber++;
						} else if (ch === "\r") {
							lineNumber++;
							if (pos + 1 < buffer.length) {
								if (buffer[pos + 1] === "\n") {
									field += "\r\n";
									pos += 2;
									continue;
								}
							} else if (!streamDone) {
								break;
							}
						}
						field += ch;
						pos++;
					}
				} else {
					if (ch === '"') {
						inQuotes = true;
						pos++;
					} else if (ch === delimiter) {
						currentRow.push(field);
						field = "";
						pos++;
					} else if (ch === "\r" || ch === "\n") {
						if (ch === "\r") {
							if (pos + 1 < buffer.length) {
								pos++;
								if (buffer[pos] === "\n") pos++;
							} else if (streamDone) {
								pos++;
							} else {
								break;
							}
						} else {
							pos++;
						}

						currentRow.push(field);
						field = "";
						lineNumber++;

						const action = handleCompletedRow(currentRow);
						currentRow = [];

						switch (action) {
							case RowAction.Stop:
								if (batch.length > 0) {
									yield { columns: columns!, rows: batch };
									batch = [];
								}
								return;
							case RowAction.Yield:
								yield { columns: columns!, rows: batch };
								batch = [];
								break;
						}
					} else {
						field += ch;
						pos++;
					}
				}
			}

			// Compact buffer: discard processed portion
			if (pos > 0) {
				buffer = buffer.slice(pos);
				pos = 0;
			}
		}

		if (inQuotes) {
			throw new CsvParseError("Unclosed quote", lineNumber);
		}

		// Final row (no trailing newline)
		if (field !== "" || currentRow.length > 0) {
			currentRow.push(field);
			handleCompletedRow(currentRow);
		}

		if (batch.length > 0) {
			yield { columns: columns ?? [], rows: batch };
		}
	} finally {
		reader.releaseLock();
	}
}

// ── Helpers ────────────────────────────────────────────────

function buildRecord(
	fields: string[],
	columns: string[],
): Record<string, unknown> {
	const row: Record<string, unknown> = {};
	for (let i = 0; i < columns.length; i++) {
		const value = i < fields.length ? fields[i] : null;
		row[columns[i]] = value === "" ? null : coerceValue(value as string);
	}
	return row;
}

/**
 * Coerce a string value to a more appropriate type.
 * Same logic as the existing in-memory import-service coercion.
 */
export function coerceValue(value: string | null): unknown {
	if (value === null || value === "") return null;

	const lower = value.toLowerCase();
	if (lower === "true") return true;
	if (lower === "false") return false;

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
 * CSV parse error with line number context.
 */
export class CsvParseError extends Error {
	public readonly lineNumber: number;

	constructor(message: string, lineNumber: number) {
		super(`CSV parse error at line ${lineNumber}: ${message}`);
		this.name = "CsvParseError";
		this.lineNumber = lineNumber;
	}
}
