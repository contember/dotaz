/** Clipboard paste parsing: auto-detect delimiter, handle quoted values, parse into rows/columns. */

export interface ParsedPasteData {
	rows: string[][];
	delimiter: string;
}

/**
 * Auto-detect the delimiter used in clipboard text.
 * Priority: tab, comma, semicolon.
 * Scans the first logical line (respecting quoted regions that may contain newlines).
 */
export function detectDelimiter(text: string): string {
	const counts = { "\t": 0, ",": 0, ";": 0 };
	let inQuote = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"') {
			if (inQuote && i + 1 < text.length && text[i + 1] === '"') {
				i++; // skip escaped quote
			} else {
				inQuote = !inQuote;
			}
		} else if (!inQuote) {
			if (ch === "\n" || ch === "\r") break; // end of first logical line
			if (ch === "\t") counts["\t"]++;
			else if (ch === ",") counts[","]++;
			else if (ch === ";") counts[";"]++;
		}
	}
	if (counts["\t"] > 0) return "\t";
	if (counts[","] > 0) return ",";
	if (counts[";"] > 0) return ";";
	return "\t"; // default
}

/**
 * Parse clipboard text into rows and columns.
 * Handles:
 * - Quoted values (double-quote enclosed)
 * - Escaped quotes ("" inside quoted values)
 * - Newlines within quoted values
 * - Whitespace trimming for unquoted values
 */
export function parseClipboardText(text: string): ParsedPasteData {
	if (!text.trim()) return { rows: [], delimiter: "\t" };

	const delimiter = detectDelimiter(text);
	const rows: string[][] = [];
	let currentRow: string[] = [];
	let currentField = "";
	let inQuote = false;
	let fieldWasQuoted = false;
	let i = 0;

	function pushField() {
		currentRow.push(fieldWasQuoted ? currentField : currentField.trim());
		currentField = "";
		fieldWasQuoted = false;
	}

	while (i < text.length) {
		const ch = text[i];

		if (inQuote) {
			if (ch === '"') {
				// Check for escaped quote ("")
				if (i + 1 < text.length && text[i + 1] === '"') {
					currentField += '"';
					i += 2;
				} else {
					// End of quoted field
					inQuote = false;
					i++;
				}
			} else {
				currentField += ch;
				i++;
			}
		} else {
			if (ch === '"' && currentField === "" && !fieldWasQuoted) {
				// Start of quoted field
				inQuote = true;
				fieldWasQuoted = true;
				i++;
			} else if (ch === delimiter) {
				pushField();
				i++;
			} else if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") {
				// CRLF
				pushField();
				rows.push(currentRow);
				currentRow = [];
				i += 2;
			} else if (ch === "\n") {
				pushField();
				rows.push(currentRow);
				currentRow = [];
				i++;
			} else {
				currentField += ch;
				i++;
			}
		}
	}

	// Push remaining field/row
	if (currentField !== "" || currentRow.length > 0) {
		pushField();
		rows.push(currentRow);
	}

	// Remove trailing empty row (common from trailing newline)
	if (rows.length > 0) {
		const lastRow = rows[rows.length - 1];
		if (lastRow.length === 1 && lastRow[0] === "") {
			rows.pop();
		}
	}

	return { rows, delimiter };
}

/**
 * Convert a parsed cell value to a database value.
 * Empty string → null, "NULL" text → null (when treatNullText is true).
 */
export function cellValueToDbValue(
	value: string,
	treatNullText: boolean,
): unknown {
	if (value === "") return null;
	if (treatNullText && value.toUpperCase() === "NULL") return null;
	return value;
}
