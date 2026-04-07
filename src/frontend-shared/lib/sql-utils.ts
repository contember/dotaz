import { scanSqlRegions } from './sql-scanner'

/**
 * Collapse whitespace and truncate SQL to a single-line preview.
 */
export function truncateSql(sql: string, maxLength = 100): string {
	const oneLine = sql.replace(/\s+/g, ' ').trim()
	if (oneLine.length <= maxLength) return oneLine
	return oneLine.slice(0, maxLength) + '...'
}

export interface StatementAtCursor {
	text: string
	from: number
	to: number
}

/**
 * Find positions of all semicolons that are NOT inside strings/comments.
 */
function findSemicolons(sql: string): number[] {
	const regions = scanSqlRegions(sql)
	const semicolons: number[] = []

	let regionIdx = 0
	for (let i = 0; i < sql.length; i++) {
		// Advance past any non-code region
		while (regionIdx < regions.length && regions[regionIdx].to <= i) {
			regionIdx++
		}
		if (regionIdx < regions.length && i >= regions[regionIdx].from) {
			i = regions[regionIdx].to - 1
			continue
		}

		if (sql[i] === ';') {
			semicolons.push(i)
		}
	}

	return semicolons
}

/**
 * Find the SQL statement at the given cursor position.
 * Returns the statement text and its range, or null if none found.
 */
export function getStatementAtCursor(sql: string, cursorPos: number): StatementAtCursor | null {
	const semicolons = findSemicolons(sql)

	// If cursor is right after a semicolon and at a line boundary (newline or EOF),
	// treat it as belonging to the preceding statement
	const atLineEnd = cursorPos >= sql.length || sql[cursorPos] === '\n'
	const effectiveCursor = (cursorPos > 0 && semicolons.includes(cursorPos - 1) && atLineEnd)
		? cursorPos - 1
		: cursorPos

	// Find the statement boundaries around the cursor
	let start = 0
	let end = sql.length

	for (const pos of semicolons) {
		if (pos < effectiveCursor) {
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
