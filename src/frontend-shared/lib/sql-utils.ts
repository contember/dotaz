export interface StatementAtCursor {
	text: string
	from: number
	to: number
}

/**
 * Find positions of all semicolons that are NOT inside strings/comments.
 * Handles single-quoted strings, double-quoted identifiers,
 * dollar-quoted strings, line comments, and block comments.
 */
function findSemicolons(sql: string): number[] {
	const semicolons: number[] = []
	let i = 0

	while (i < sql.length) {
		const ch = sql[i]
		const next = i + 1 < sql.length ? sql[i + 1] : ''

		// Line comment: -- until end of line
		if (ch === '-' && next === '-') {
			const lineEnd = sql.indexOf('\n', i)
			i = lineEnd === -1 ? sql.length : lineEnd + 1
			continue
		}

		// Block comment: /* ... */
		if (ch === '/' && next === '*') {
			const endIdx = sql.indexOf('*/', i + 2)
			i = endIdx === -1 ? sql.length : endIdx + 2
			continue
		}

		// Dollar-quoted string: $$...$$ or $tag$...$tag$
		if (ch === '$') {
			const tagMatch = sql.slice(i).match(/^(\$[a-zA-Z0-9_]*\$)/)
			if (tagMatch) {
				const tag = tagMatch[1]
				const endIdx = sql.indexOf(tag, i + tag.length)
				i = endIdx === -1 ? sql.length : endIdx + tag.length
				continue
			}
		}

		// Single-quoted string
		if (ch === "'") {
			i++
			while (i < sql.length) {
				if (sql[i] === "'") {
					i++
					if (i < sql.length && sql[i] === "'") {
						i++ // escaped ''
					} else {
						break
					}
				} else {
					i++
				}
			}
			continue
		}

		// Double-quoted identifier
		if (ch === '"') {
			i++
			while (i < sql.length) {
				if (sql[i] === '"') {
					i++
					if (i < sql.length && sql[i] === '"') {
						i++ // escaped ""
					} else {
						break
					}
				} else {
					i++
				}
			}
			continue
		}

		// Statement delimiter
		if (ch === ';') {
			semicolons.push(i)
		}

		i++
	}

	return semicolons
}

/**
 * Find the SQL statement at the given cursor position.
 * Returns the statement text and its range, or null if none found.
 */
export function getStatementAtCursor(sql: string, cursorPos: number): StatementAtCursor | null {
	const semicolons = findSemicolons(sql)

	// Find the statement boundaries around the cursor
	let start = 0
	let end = sql.length

	for (const pos of semicolons) {
		if (pos < cursorPos) {
			start = pos + 1
		} else {
			end = pos
			break
		}
	}

	const text = sql.slice(start, end).trim()
	if (!text) return null

	// Compute the actual positions of trimmed text within the original string
	const trimStart = start + (sql.slice(start, end).length - sql.slice(start, end).trimStart().length)
	const trimEnd = end - (sql.slice(start, end).length - sql.slice(start, end).trimEnd().length)

	return { text, from: trimStart, to: trimEnd }
}

/**
 * Find the first non-whitespace position of the next SQL statement after the cursor.
 * Returns null if the cursor is already in the last statement.
 */
export function getNextStatementStart(sql: string, cursorPos: number): number | null {
	const semicolons = findSemicolons(sql)

	// Find the first semicolon at or after the cursor position
	let nextSemicolon = -1
	for (const pos of semicolons) {
		if (pos >= cursorPos) {
			nextSemicolon = pos
			break
		}
	}

	// No semicolon at/after cursor — we're in the last statement
	if (nextSemicolon === -1) return null

	// Find first non-whitespace after the semicolon
	let pos = nextSemicolon + 1
	while (pos < sql.length && /\s/.test(sql[pos])) pos++

	return pos < sql.length ? pos : null
}

/**
 * Find the first non-whitespace position of the previous SQL statement before the cursor.
 * Returns null if the cursor is already in the first statement.
 */
export function getPreviousStatementStart(sql: string, cursorPos: number): number | null {
	const semicolons = findSemicolons(sql)

	// Collect all semicolons before the cursor
	const prevSemicolons: number[] = []
	for (const pos of semicolons) {
		if (pos < cursorPos) prevSemicolons.push(pos)
		else break
	}

	// No semicolons before cursor — we're in the first statement
	if (prevSemicolons.length === 0) return null

	// The previous statement starts after the second-to-last semicolon, or at 0
	let prevStart = 0
	if (prevSemicolons.length >= 2) {
		prevStart = prevSemicolons[prevSemicolons.length - 2] + 1
	}

	// Find first non-whitespace
	let pos = prevStart
	while (pos < sql.length && /\s/.test(sql[pos])) pos++

	return pos < sql.length ? pos : null
}
