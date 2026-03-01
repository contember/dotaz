import type { ErrorPosition } from "../types/query";

/**
 * Split a SQL string into individual statements by semicolons.
 * Respects single-quoted strings (with '' escaping), double-quoted identifiers,
 * dollar-quoted strings ($$...$$), line comments (--), and block comments.
 */
export function splitStatements(sql: string): string[] {
	const statements: string[] = [];
	let current = "";
	let i = 0;

	while (i < sql.length) {
		const ch = sql[i];
		const next = i + 1 < sql.length ? sql[i + 1] : "";

		// Line comment: -- until end of line
		if (ch === "-" && next === "-") {
			const lineEnd = sql.indexOf("\n", i);
			if (lineEnd === -1) {
				current += sql.slice(i);
				i = sql.length;
			} else {
				current += sql.slice(i, lineEnd + 1);
				i = lineEnd + 1;
			}
			continue;
		}

		// Block comment: /* ... */
		if (ch === "/" && next === "*") {
			const endIdx = sql.indexOf("*/", i + 2);
			if (endIdx === -1) {
				current += sql.slice(i);
				i = sql.length;
			} else {
				current += sql.slice(i, endIdx + 2);
				i = endIdx + 2;
			}
			continue;
		}

		// Dollar-quoted string: $$...$$ or $tag$...$tag$
		if (ch === "$") {
			const tagMatch = sql.slice(i).match(/^(\$[a-zA-Z0-9_]*\$)/);
			if (tagMatch) {
				const tag = tagMatch[1];
				const endIdx = sql.indexOf(tag, i + tag.length);
				if (endIdx === -1) {
					current += sql.slice(i);
					i = sql.length;
				} else {
					current += sql.slice(i, endIdx + tag.length);
					i = endIdx + tag.length;
				}
				continue;
			}
		}

		// Single-quoted string (SQL escaping: '' for literal quote)
		if (ch === "'") {
			current += ch;
			i++;
			while (i < sql.length) {
				if (sql[i] === "'") {
					current += sql[i];
					i++;
					// Escaped quote ''
					if (i < sql.length && sql[i] === "'") {
						current += sql[i];
						i++;
					} else {
						break;
					}
				} else {
					current += sql[i];
					i++;
				}
			}
			continue;
		}

		// Double-quoted identifier
		if (ch === '"') {
			current += ch;
			i++;
			while (i < sql.length) {
				if (sql[i] === '"') {
					current += sql[i];
					i++;
					// Escaped quote ""
					if (i < sql.length && sql[i] === '"') {
						current += sql[i];
						i++;
					} else {
						break;
					}
				} else {
					current += sql[i];
					i++;
				}
			}
			continue;
		}

		// Statement delimiter
		if (ch === ";") {
			const trimmed = current.trim();
			if (trimmed.length > 0) {
				statements.push(trimmed);
			}
			current = "";
			i++;
			continue;
		}

		current += ch;
		i++;
	}

	const trimmed = current.trim();
	if (trimmed.length > 0) {
		statements.push(trimmed);
	}

	return statements;
}

/**
 * Convert a 1-based character offset into line/column numbers.
 * Both line and column in the result are 1-based.
 */
export function offsetToLineColumn(sql: string, offset: number): { line: number; column: number } {
	let line = 1;
	let col = 1;
	// offset is 1-based from PostgreSQL
	const target = Math.min(offset - 1, sql.length);
	for (let i = 0; i < target; i++) {
		if (sql[i] === "\n") {
			line++;
			col = 1;
		} else {
			col++;
		}
	}
	return { line, column: col };
}

/**
 * Extract error position from database error objects.
 * PostgreSQL errors include a `position` field (1-based character offset).
 * SQLite errors may include offset info in the message.
 */
export function parseErrorPosition(err: unknown, sql: string): ErrorPosition | undefined {
	if (!err || typeof err !== "object") return undefined;

	const errObj = err as Record<string, unknown>;

	// PostgreSQL: position is a 1-based character offset in the query
	if (errObj.position != null) {
		const offset = Number(errObj.position);
		if (!Number.isNaN(offset) && offset > 0) {
			const { line, column } = offsetToLineColumn(sql, offset);
			return { line, column, offset };
		}
	}

	// SQLite: try to parse offset from error message
	// Common pattern: "... near "xxx", at offset N"
	if (err instanceof Error) {
		const match = err.message.match(/at offset (\d+)/);
		if (match) {
			const offset = Number(match[1]) + 1; // convert 0-based to 1-based
			const { line, column } = offsetToLineColumn(sql, offset);
			return { line, column, offset };
		}
	}

	return undefined;
}
