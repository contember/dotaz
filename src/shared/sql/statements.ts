import type { ErrorPosition } from '../types/query'

/**
 * Split a SQL string into individual statements by semicolons.
 * Respects single-quoted strings (with '' escaping), double-quoted identifiers,
 * dollar-quoted strings ($$...$$), line comments (--), and block comments.
 */
export function splitStatements(sql: string): string[] {
	const statements: string[] = []
	let current = ''
	let i = 0

	while (i < sql.length) {
		const ch = sql[i]
		const next = i + 1 < sql.length ? sql[i + 1] : ''

		// Line comment: -- until end of line
		if (ch === '-' && next === '-') {
			const lineEnd = sql.indexOf('\n', i)
			if (lineEnd === -1) {
				current += sql.slice(i)
				i = sql.length
			} else {
				current += sql.slice(i, lineEnd + 1)
				i = lineEnd + 1
			}
			continue
		}

		// Block comment: /* ... */
		if (ch === '/' && next === '*') {
			const endIdx = sql.indexOf('*/', i + 2)
			if (endIdx === -1) {
				current += sql.slice(i)
				i = sql.length
			} else {
				current += sql.slice(i, endIdx + 2)
				i = endIdx + 2
			}
			continue
		}

		// Dollar-quoted string: $$...$$ or $tag$...$tag$
		if (ch === '$') {
			const tagMatch = sql.slice(i).match(/^(\$[a-zA-Z0-9_]*\$)/)
			if (tagMatch) {
				const tag = tagMatch[1]
				const endIdx = sql.indexOf(tag, i + tag.length)
				if (endIdx === -1) {
					current += sql.slice(i)
					i = sql.length
				} else {
					current += sql.slice(i, endIdx + tag.length)
					i = endIdx + tag.length
				}
				continue
			}
		}

		// Single-quoted string (SQL escaping: '' for literal quote)
		if (ch === "'") {
			current += ch
			i++
			while (i < sql.length) {
				if (sql[i] === "'") {
					current += sql[i]
					i++
					// Escaped quote ''
					if (i < sql.length && sql[i] === "'") {
						current += sql[i]
						i++
					} else {
						break
					}
				} else {
					current += sql[i]
					i++
				}
			}
			continue
		}

		// Double-quoted identifier
		if (ch === '"') {
			current += ch
			i++
			while (i < sql.length) {
				if (sql[i] === '"') {
					current += sql[i]
					i++
					// Escaped quote ""
					if (i < sql.length && sql[i] === '"') {
						current += sql[i]
						i++
					} else {
						break
					}
				} else {
					current += sql[i]
					i++
				}
			}
			continue
		}

		// Statement delimiter
		if (ch === ';') {
			const trimmed = current.trim()
			if (trimmed.length > 0) {
				statements.push(trimmed)
			}
			current = ''
			i++
			continue
		}

		current += ch
		i++
	}

	const trimmed = current.trim()
	if (trimmed.length > 0) {
		statements.push(trimmed)
	}

	return statements
}

/**
 * Convert a 1-based character offset into line/column numbers.
 * Both line and column in the result are 1-based.
 */
export function offsetToLineColumn(sql: string, offset: number): { line: number; column: number } {
	let line = 1
	let col = 1
	// offset is 1-based from PostgreSQL
	const target = Math.min(offset - 1, sql.length)
	for (let i = 0; i < target; i++) {
		if (sql[i] === '\n') {
			line++
			col = 1
		} else {
			col++
		}
	}
	return { line, column: col }
}

/**
 * Strip string literals (single-quoted, double-quoted, dollar-quoted)
 * and comments (line and block) from SQL, replacing them with spaces.
 * Used for safe keyword detection without matching inside literals.
 */
export function stripLiteralsAndComments(sql: string): string {
	let result = ''
	let i = 0

	while (i < sql.length) {
		const ch = sql[i]
		const next = i + 1 < sql.length ? sql[i + 1] : ''

		// Line comment
		if (ch === '-' && next === '-') {
			const lineEnd = sql.indexOf('\n', i)
			result += ' '
			i = lineEnd === -1 ? sql.length : lineEnd + 1
			continue
		}

		// Block comment
		if (ch === '/' && next === '*') {
			const endIdx = sql.indexOf('*/', i + 2)
			result += ' '
			i = endIdx === -1 ? sql.length : endIdx + 2
			continue
		}

		// Dollar-quoted string
		if (ch === '$') {
			const tagMatch = sql.slice(i).match(/^(\$[a-zA-Z0-9_]*\$)/)
			if (tagMatch) {
				const tag = tagMatch[1]
				const endIdx = sql.indexOf(tag, i + tag.length)
				result += ' '
				i = endIdx === -1 ? sql.length : endIdx + tag.length
				continue
			}
		}

		// Single-quoted string
		if (ch === "'") {
			result += ' '
			i++
			while (i < sql.length) {
				if (sql[i] === "'") {
					i++
					if (i < sql.length && sql[i] === "'") {
						i++
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
			result += ' '
			i++
			while (i < sql.length) {
				if (sql[i] === '"') {
					i++
					if (i < sql.length && sql[i] === '"') {
						i++
					} else {
						break
					}
				} else {
					i++
				}
			}
			continue
		}

		result += ch
		i++
	}

	return result
}

// ── Statement classification ────────────────────────────────

/** What a statement does to the database. `unknown` is anything we cannot prove. */
export type StatementKind = 'read' | 'write' | 'ddl' | 'unknown'

const READ_KEYWORDS = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'VALUES', 'TABLE'])
const WRITE_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE', 'TRUNCATE', 'CALL', 'DO'])
const DDL_KEYWORDS = new Set(['CREATE', 'ALTER', 'DROP', 'GRANT', 'REVOKE', 'VACUUM', 'REINDEX', 'ATTACH', 'DETACH'])

/** Keywords that can follow a CTE list and decide what the statement really does. */
const CTE_TAIL_KEYWORDS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE', 'VALUES', 'TABLE'])

/**
 * Classify a single SQL statement by what it does to the database.
 * Keyword-based — literals and comments are stripped first so a keyword inside
 * a string never counts. Anything unrecognised is `unknown` so callers fail closed.
 */
export function classifyStatement(sql: string): StatementKind {
	return classifyNormalized(normalizeForClassification(sql))
}

/**
 * Whether every statement in `sql` is provably a read.
 * Fails closed: `unknown`, empty input, and multi-statement input with a single
 * non-read statement all return false.
 */
export function isReadOnlySql(sql: string): boolean {
	const statements = splitStatements(sql)
	if (statements.length === 0) return false
	return statements.every((statement) => classifyStatement(statement) === 'read')
}

function normalizeForClassification(sql: string): string {
	return stripLiteralsAndComments(sql).replace(/\s+/g, ' ').trim().toUpperCase()
}

function classifyNormalized(sql: string): StatementKind {
	// Leading parens (e.g. `(SELECT …) UNION (SELECT …)`) don't change the operation
	const stmt = sql.replace(/^[(\s]+/, '')
	const keyword = stmt.match(/^[A-Z_]+/)?.[0]
	if (!keyword) return 'unknown'

	if (keyword === 'WITH') {
		const tail = findCteTail(stmt)
		return tail === null ? 'unknown' : classifyNormalized(tail)
	}
	if (keyword === 'EXPLAIN') return classifyExplain(stmt)
	// A PRAGMA assignment changes state; only a bare PRAGMA is a read
	if (keyword === 'PRAGMA') return stmt.includes('=') ? 'unknown' : 'read'
	// COPY … TO writes a server-side file rather than the database — not provably a read
	if (keyword === 'COPY') return /\bFROM\b/.test(stmt) ? 'write' : 'unknown'

	if (READ_KEYWORDS.has(keyword)) return 'read'
	if (WRITE_KEYWORDS.has(keyword)) return 'write'
	if (DDL_KEYWORDS.has(keyword)) return 'ddl'
	return 'unknown'
}

/**
 * Return the statement that follows a CTE list, so data-modifying CTEs
 * (`WITH x AS (…) INSERT …`) are classified by their tail, not by `WITH`.
 * CTE bodies are always parenthesised, so the tail is the first matching
 * keyword at paren depth 0.
 */
function findCteTail(sql: string): string | null {
	let depth = 0
	let wordStart = -1

	for (let i = 0; i <= sql.length; i++) {
		const ch = i < sql.length ? sql[i] : ' '
		if (ch === '(' || ch === ')') {
			depth += ch === '(' ? 1 : -1
			wordStart = -1
			continue
		}
		if (/[A-Z0-9_]/.test(ch)) {
			if (wordStart === -1) wordStart = i
			continue
		}
		if (wordStart !== -1 && depth === 0 && CTE_TAIL_KEYWORDS.has(sql.slice(wordStart, i))) {
			return sql.slice(wordStart)
		}
		wordStart = -1
	}
	return null
}

/**
 * EXPLAIN alone never executes its statement, so it reads.
 * EXPLAIN ANALYZE does execute it — classify by the statement being explained.
 */
function classifyExplain(sql: string): StatementKind {
	let rest = sql.slice('EXPLAIN'.length).trim()
	let analyze = false

	if (rest.startsWith('(')) {
		const close = findMatchingParen(rest)
		if (close === -1) return 'unknown'
		const options = rest.slice(1, close)
		analyze = /\bANALYZE\b/.test(options) && !/\bANALYZE\s+(FALSE|OFF|0)\b/.test(options)
		rest = rest.slice(close + 1).trim()
	} else {
		// Vendor modifiers: PG `ANALYZE`/`VERBOSE`, SQLite `QUERY PLAN`, MySQL `FORMAT=JSON`
		while (true) {
			const match = rest.match(/^(ANALYZE|VERBOSE|QUERY PLAN|EXTENDED|PARTITIONS|FORMAT\s*=\s*[A-Z]+)\b\s*/)
			if (!match) break
			if (match[1] === 'ANALYZE') analyze = true
			rest = rest.slice(match[0].length)
		}
	}

	if (!analyze) return 'read'
	if (rest.length === 0) return 'unknown'
	return classifyNormalized(rest)
}

/** Index of the `)` matching the `(` at position 0, or -1 when unbalanced. */
function findMatchingParen(sql: string): number {
	let depth = 0
	for (let i = 0; i < sql.length; i++) {
		if (sql[i] === '(') depth++
		else if (sql[i] === ')' && --depth === 0) return i
	}
	return -1
}

/**
 * Detect if a SQL statement is a DELETE or UPDATE without a WHERE clause.
 * Returns true if the statement would affect all rows in the table.
 * Uses simple parsing — not 100% accurate for complex subqueries,
 * but covers 95%+ of common cases.
 */
export function detectDestructiveWithoutWhere(sql: string): boolean {
	const stripped = stripLiteralsAndComments(sql)
	// Normalize whitespace and uppercase for keyword matching
	const normalized = stripped.replace(/\s+/g, ' ').trim().toUpperCase()

	// Check for DELETE FROM without WHERE
	if (/^DELETE\s/.test(normalized)) {
		return !(/\bWHERE\b/.test(normalized))
	}

	// Check for UPDATE ... SET without WHERE
	if (/^UPDATE\s/.test(normalized) && /\bSET\b/.test(normalized)) {
		return !(/\bWHERE\b/.test(normalized))
	}

	return false
}

/**
 * Detect if a single SQL statement is a SELECT without a user-specified
 * LIMIT, FETCH, or TOP clause (i.e. it would benefit from an auto-limit).
 * Returns true when the statement is an unlimited SELECT.
 * Handles CTEs (`WITH ... SELECT`) and UNION/INTERSECT/EXCEPT.
 */
export function isUnlimitedSelect(sql: string): boolean {
	const stripped = stripLiteralsAndComments(sql)
	const normalized = stripped.replace(/\s+/g, ' ').trim().toUpperCase()

	// Must start with SELECT or WITH (CTE)
	if (!/^(SELECT|WITH)\b/.test(normalized)) return false

	// Already has LIMIT, FETCH FIRST/NEXT, or TOP
	if (/\bLIMIT\b/.test(normalized)) return false
	if (/\bFETCH\s+(FIRST|NEXT)\b/.test(normalized)) return false
	if (/\bTOP\b/.test(normalized)) return false

	return true
}

/**
 * Extract error position from database error objects.
 * PostgreSQL errors include a `position` field (1-based character offset).
 * SQLite errors may include offset info in the message.
 */
export function parseErrorPosition(err: unknown, sql: string): ErrorPosition | undefined {
	if (!err || typeof err !== 'object') return undefined

	const errObj = err as Record<string, unknown>

	// PostgreSQL: position is a 1-based character offset in the query
	if (errObj.position != null) {
		const offset = Number(errObj.position)
		if (!Number.isNaN(offset) && offset > 0) {
			const { line, column } = offsetToLineColumn(sql, offset)
			return { line, column, offset }
		}
	}

	// SQLite: try to parse offset from error message
	// Common pattern: "... near "xxx", at offset N"
	if (err instanceof Error) {
		const match = err.message.match(/at offset (\d+)/)
		if (match) {
			const offset = Number(match[1]) + 1 // convert 0-based to 1-based
			const { line, column } = offsetToLineColumn(sql, offset)
			return { line, column, offset }
		}
	}

	return undefined
}
