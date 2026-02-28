/**
 * Simple SQL formatter: uppercase keywords, major clauses on new lines with indentation.
 */

// Major clause keywords that start on a new line (no indentation)
const CLAUSE_KEYWORDS = [
	"SELECT",
	"FROM",
	"WHERE",
	"ORDER BY",
	"GROUP BY",
	"HAVING",
	"LIMIT",
	"OFFSET",
	"UNION",
	"UNION ALL",
	"INTERSECT",
	"EXCEPT",
	"INSERT INTO",
	"UPDATE",
	"SET",
	"DELETE FROM",
	"VALUES",
];

// JOIN variants that start on a new line
const JOIN_KEYWORDS = [
	"LEFT OUTER JOIN",
	"RIGHT OUTER JOIN",
	"FULL OUTER JOIN",
	"CROSS JOIN",
	"INNER JOIN",
	"LEFT JOIN",
	"RIGHT JOIN",
	"FULL JOIN",
	"NATURAL JOIN",
	"JOIN",
];

// Sub-clause keywords indented under their parent clause
const SUB_KEYWORDS = ["ON", "AND", "OR"];

// All SQL keywords to uppercase (common ones)
const ALL_KEYWORDS = [
	"SELECT", "DISTINCT", "FROM", "WHERE", "AND", "OR", "NOT", "IN",
	"EXISTS", "BETWEEN", "LIKE", "ILIKE", "IS", "NULL", "TRUE", "FALSE",
	"AS", "ON", "USING", "JOIN", "INNER", "LEFT", "RIGHT", "FULL",
	"OUTER", "CROSS", "NATURAL", "ORDER", "BY", "GROUP", "HAVING",
	"LIMIT", "OFFSET", "UNION", "ALL", "INTERSECT", "EXCEPT",
	"INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
	"CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW",
	"PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "CHECK",
	"DEFAULT", "CONSTRAINT", "CASCADE", "RESTRICT",
	"BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION",
	"CASE", "WHEN", "THEN", "ELSE", "END",
	"ASC", "DESC", "NULLS", "FIRST", "LAST",
	"COUNT", "SUM", "AVG", "MIN", "MAX",
	"CAST", "COALESCE", "NULLIF",
	"WITH", "RECURSIVE", "RETURNING",
];

interface Token {
	type: "word" | "string" | "whitespace" | "symbol";
	value: string;
	upper: string; // uppercase value for keyword matching
}

/**
 * Tokenize SQL into words, strings, whitespace, and symbols.
 * Strings (single/double quoted) are kept intact.
 */
function tokenize(sql: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < sql.length) {
		const ch = sql[i];

		// Single or double quoted string
		if (ch === "'" || ch === '"') {
			const quote = ch;
			let str = ch;
			i++;
			while (i < sql.length) {
				if (sql[i] === quote) {
					str += sql[i];
					i++;
					// Handle escaped quotes ('' or "")
					if (i < sql.length && sql[i] === quote) {
						str += sql[i];
						i++;
					} else {
						break;
					}
				} else {
					str += sql[i];
					i++;
				}
			}
			tokens.push({ type: "string", value: str, upper: str });
			continue;
		}

		// Whitespace
		if (/\s/.test(ch)) {
			let ws = "";
			while (i < sql.length && /\s/.test(sql[i])) {
				ws += sql[i];
				i++;
			}
			tokens.push({ type: "whitespace", value: ws, upper: ws });
			continue;
		}

		// Word (identifier or keyword)
		if (/[a-zA-Z_]/.test(ch)) {
			let word = "";
			while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) {
				word += sql[i];
				i++;
			}
			tokens.push({ type: "word", value: word, upper: word.toUpperCase() });
			continue;
		}

		// Everything else is a symbol (operators, parens, commas, etc.)
		tokens.push({ type: "symbol", value: ch, upper: ch });
		i++;
	}

	return tokens;
}

/**
 * Check if a sequence of tokens (ignoring whitespace) matches a multi-word keyword
 * starting at position `start`. Returns the number of tokens consumed (including whitespace).
 */
function matchMultiKeyword(tokens: Token[], start: number, keyword: string): number {
	const parts = keyword.split(" ");
	let ti = start;
	let pi = 0;

	while (pi < parts.length && ti < tokens.length) {
		if (tokens[ti].type === "whitespace") {
			ti++;
			continue;
		}
		if (tokens[ti].upper !== parts[pi]) {
			return 0;
		}
		pi++;
		ti++;
	}

	return pi === parts.length ? ti - start : 0;
}

/**
 * Format SQL: uppercase keywords, major clauses on new lines.
 */
export function formatSql(sql: string): string {
	const trimmed = sql.trim();
	if (!trimmed) return "";

	const tokens = tokenize(trimmed);

	// First pass: uppercase keywords
	for (const token of tokens) {
		if (token.type === "word") {
			if (ALL_KEYWORDS.includes(token.upper)) {
				token.value = token.upper;
			}
		}
	}

	// Second pass: insert newlines before clause/join keywords
	const lines: string[] = [];
	let currentLine = "";
	let i = 0;
	let parenDepth = 0;

	while (i < tokens.length) {
		const token = tokens[i];

		// Track parenthesis depth — don't break lines inside subqueries/function calls
		if (token.type === "symbol" && token.value === "(") {
			parenDepth++;
			currentLine += token.value;
			i++;
			continue;
		}
		if (token.type === "symbol" && token.value === ")") {
			if (parenDepth > 0) parenDepth--;
			currentLine += token.value;
			i++;
			continue;
		}

		if (parenDepth > 0) {
			currentLine += token.value;
			i++;
			continue;
		}

		// Try to match multi-word clause keywords first (longest match)
		if (token.type === "word") {
			let matched = false;

			// Check clause keywords (longest first for greedy matching)
			const allKeywords = [...CLAUSE_KEYWORDS, ...JOIN_KEYWORDS].sort(
				(a, b) => b.split(" ").length - a.split(" ").length,
			);

			for (const kw of allKeywords) {
				const consumed = matchMultiKeyword(tokens, i, kw);
				if (consumed > 0) {
					// Collect the matched keyword text
					const kwText = [];
					for (let j = i; j < i + consumed; j++) {
						kwText.push(tokens[j].value);
					}
					const keywordStr = kwText.filter(t => t.trim()).join(" ");

					const isJoin = JOIN_KEYWORDS.includes(kw);
					const isClause = CLAUSE_KEYWORDS.includes(kw);

					if (isClause || isJoin) {
						// Push current line and start new one
						const trimmedLine = currentLine.trimEnd();
						if (trimmedLine) {
							lines.push(trimmedLine);
						}
						currentLine = keywordStr;
					} else {
						currentLine += keywordStr;
					}

					i += consumed;
					matched = true;
					break;
				}
			}

			if (matched) continue;

			// Check sub-keywords (AND, OR, ON) — new line with indent
			if (SUB_KEYWORDS.includes(token.upper)) {
				const trimmedLine = currentLine.trimEnd();
				if (trimmedLine) {
					lines.push(trimmedLine);
				}
				currentLine = "  " + token.value;
				i++;
				continue;
			}
		}

		// Default: skip leading whitespace in the line, collapse other whitespace
		if (token.type === "whitespace") {
			if (currentLine.trimEnd()) {
				currentLine += " ";
			}
		} else {
			currentLine += token.value;
		}
		i++;
	}

	const trimmedLine = currentLine.trimEnd();
	if (trimmedLine) {
		lines.push(trimmedLine);
	}

	return lines.join("\n");
}
