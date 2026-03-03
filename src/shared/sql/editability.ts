/**
 * SQL query editability analysis.
 *
 * Determines whether the result set of a SELECT query can be edited inline
 * by detecting the source table and verifying the query structure is simple
 * enough (no JOINs, aggregations, UNIONs, subqueries, etc.).
 */

// ── Types ─────────────────────────────────────────────────

export type QueryEditabilityReason =
	| 'not_select'
	| 'aggregation'
	| 'union'
	| 'subquery'
	| 'multi_table'
	| 'no_pk'
	| 'unknown_table'

export interface SelectSourceInfo {
	schema?: string
	table: string
}

export type SelectAnalysisResult =
	| { editable: true; source: SelectSourceInfo }
	| { editable: false; reason: QueryEditabilityReason }

// ── Public API ────────────────────────────────────────────

/**
 * Analyze a SQL query to determine if its result rows can be edited inline.
 *
 * Returns the source table info for simple single-table SELECTs,
 * or a reason why the result is not editable.
 */
export function analyzeSelectSource(sql: string): SelectAnalysisResult {
	// Strip string literals, comments, and dollar-quoted strings for keyword analysis.
	// Preserves identifiers (double-quoted, backtick-quoted) so we can extract table names.
	const stripped = stripNonCode(sql)
	const normalized = stripped.replace(/\s+/g, ' ').trim()
	const upper = normalized.toUpperCase()

	// CTE queries — too complex to analyze
	if (upper.startsWith('WITH ')) {
		return { editable: false, reason: 'subquery' }
	}

	// Must be a SELECT
	if (!upper.startsWith('SELECT ')) {
		return { editable: false, reason: 'not_select' }
	}

	// Set operations
	if (/\bUNION\b|\bINTERSECT\b|\bEXCEPT\b/.test(upper)) {
		return { editable: false, reason: 'union' }
	}

	// GROUP BY / HAVING anywhere in the query
	if (/\bGROUP\s+BY\b|\bHAVING\b/.test(upper)) {
		return { editable: false, reason: 'aggregation' }
	}

	// JOINs
	if (/\bJOIN\b/.test(upper)) {
		return { editable: false, reason: 'multi_table' }
	}

	// Find FROM clause
	const fromMatch = upper.match(/\bFROM\b/)
	if (!fromMatch || fromMatch.index === undefined) {
		return { editable: false, reason: 'not_select' }
	}

	// Check for subqueries in SELECT list (between SELECT and FROM).
	// Must be checked before aggregate function detection since subqueries
	// can contain aggregate functions (e.g., (SELECT COUNT(*) FROM ...)).
	const selectClause = upper.substring(7, fromMatch.index)
	if (/\(\s*SELECT\b/.test(selectClause)) {
		return { editable: false, reason: 'subquery' }
	}

	// Aggregate functions in the SELECT clause (not in subqueries)
	if (/\b(COUNT|SUM|AVG|MIN|MAX|ARRAY_AGG|STRING_AGG|GROUP_CONCAT)\s*\(/.test(selectClause)) {
		return { editable: false, reason: 'aggregation' }
	}

	// Analyze FROM clause
	const fromEnd = fromMatch.index + 4
	const afterFrom = normalized.substring(fromEnd).trimStart()

	// Subquery in FROM
	if (afterFrom.startsWith('(')) {
		return { editable: false, reason: 'subquery' }
	}

	// Extract FROM clause content (up to next clause keyword)
	const clauseEnd = afterFrom.toUpperCase().search(
		/\b(WHERE|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FOR\s+UPDATE|WINDOW|FETCH)\b/,
	)
	const fromClause = clauseEnd === -1 ? afterFrom : afterFrom.substring(0, clauseEnd)

	// Multiple tables (comma-separated)
	if (fromClause.includes(',')) {
		return { editable: false, reason: 'multi_table' }
	}

	// Extract table reference
	const source = parseTableRef(fromClause.trim())
	if (!source) {
		return { editable: false, reason: 'unknown_table' }
	}

	return { editable: true, source }
}

// ── Internal helpers ──────────────────────────────────────

/**
 * Strip string literals, comments, and dollar-quoted strings from SQL,
 * replacing them with spaces. Preserves identifiers and all other tokens.
 */
function stripNonCode(sql: string): string {
	let result = ''
	let i = 0

	while (i < sql.length) {
		const ch = sql[i]
		const next = i + 1 < sql.length ? sql[i + 1] : ''

		// Line comment
		if (ch === '-' && next === '-') {
			const end = sql.indexOf('\n', i)
			result += ' '
			i = end === -1 ? sql.length : end + 1
			continue
		}

		// Block comment
		if (ch === '/' && next === '*') {
			const end = sql.indexOf('*/', i + 2)
			result += ' '
			i = end === -1 ? sql.length : end + 2
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

		// Everything else (including double-quoted identifiers)
		result += ch
		i++
	}

	return result
}

/**
 * Parse a table reference like `schema.table alias` or `"Schema"."Table" AS t`.
 * Returns the schema and table names (unquoted).
 */
function parseTableRef(ref: string): SelectSourceInfo | null {
	let pos = 0

	const first = parseIdent(ref, pos)
	if (!first) return null

	pos = first.end
	while (pos < ref.length && /\s/.test(ref[pos])) pos++

	// Schema.table
	if (ref[pos] === '.') {
		pos++
		while (pos < ref.length && /\s/.test(ref[pos])) pos++
		const second = parseIdent(ref, pos)
		if (!second) return null
		return { schema: first.name, table: second.name }
	}

	return { table: first.name }
}

/**
 * Parse a SQL identifier (quoted or unquoted) starting at `pos`.
 */
function parseIdent(s: string, pos: number): { name: string; end: number } | null {
	if (pos >= s.length) return null

	// Double-quoted identifier
	if (s[pos] === '"') {
		let end = pos + 1
		let name = ''
		while (end < s.length) {
			if (s[end] === '"') {
				if (end + 1 < s.length && s[end + 1] === '"') {
					name += '"'
					end += 2
				} else {
					end++
					break
				}
			} else {
				name += s[end]
				end++
			}
		}
		return name ? { name, end } : null
	}

	// Backtick-quoted identifier (MySQL)
	if (s[pos] === '`') {
		let end = pos + 1
		let name = ''
		while (end < s.length && s[end] !== '`') {
			name += s[end]
			end++
		}
		if (end < s.length) end++
		return name ? { name, end } : null
	}

	// Unquoted identifier
	if (/[a-zA-Z_]/.test(s[pos])) {
		let end = pos
		while (end < s.length && /[a-zA-Z0-9_]/.test(s[end])) end++
		return { name: s.substring(pos, end), end }
	}

	return null
}
