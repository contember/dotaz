export interface StatementAtCursor {
	text: string;
	from: number;
	to: number;
}

/**
 * Find the SQL statement at the given cursor position.
 * Handles single-quoted strings, double-quoted identifiers,
 * dollar-quoted strings, line comments, and block comments.
 * Returns the statement text and its range, or null if none found.
 */
export function getStatementAtCursor(sql: string, cursorPos: number): StatementAtCursor | null {
	// Find semicolon positions that are NOT inside strings/comments
	const semicolons: number[] = [];
	let i = 0;

	while (i < sql.length) {
		const ch = sql[i];
		const next = i + 1 < sql.length ? sql[i + 1] : "";

		// Line comment: -- until end of line
		if (ch === "-" && next === "-") {
			const lineEnd = sql.indexOf("\n", i);
			i = lineEnd === -1 ? sql.length : lineEnd + 1;
			continue;
		}

		// Block comment: /* ... */
		if (ch === "/" && next === "*") {
			const endIdx = sql.indexOf("*/", i + 2);
			i = endIdx === -1 ? sql.length : endIdx + 2;
			continue;
		}

		// Dollar-quoted string: $$...$$ or $tag$...$tag$
		if (ch === "$") {
			const tagMatch = sql.slice(i).match(/^(\$[a-zA-Z0-9_]*\$)/);
			if (tagMatch) {
				const tag = tagMatch[1];
				const endIdx = sql.indexOf(tag, i + tag.length);
				i = endIdx === -1 ? sql.length : endIdx + tag.length;
				continue;
			}
		}

		// Single-quoted string
		if (ch === "'") {
			i++;
			while (i < sql.length) {
				if (sql[i] === "'") {
					i++;
					if (i < sql.length && sql[i] === "'") {
						i++; // escaped ''
					} else {
						break;
					}
				} else {
					i++;
				}
			}
			continue;
		}

		// Double-quoted identifier
		if (ch === '"') {
			i++;
			while (i < sql.length) {
				if (sql[i] === '"') {
					i++;
					if (i < sql.length && sql[i] === '"') {
						i++; // escaped ""
					} else {
						break;
					}
				} else {
					i++;
				}
			}
			continue;
		}

		// Statement delimiter
		if (ch === ";") {
			semicolons.push(i);
		}

		i++;
	}

	// Find the statement boundaries around the cursor
	let start = 0;
	let end = sql.length;

	for (const pos of semicolons) {
		if (pos < cursorPos) {
			start = pos + 1;
		} else {
			end = pos;
			break;
		}
	}

	const text = sql.slice(start, end).trim();
	if (!text) return null;

	// Compute the actual positions of trimmed text within the original string
	const trimStart = start + (sql.slice(start, end).length - sql.slice(start, end).trimStart().length);
	const trimEnd = end - (sql.slice(start, end).length - sql.slice(start, end).trimEnd().length);

	return { text, from: trimStart, to: trimEnd };
}
