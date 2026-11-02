import type { ConnectionType } from '../types/connection'
import { isIdentChar } from './statements'

const ALL_DIALECTS: ConnectionType[] = ['postgresql', 'mysql', 'sqlite']

/**
 * Whether `sql` is provably a single statement for the given dialect.
 *
 * This is a security primitive, not a nicety. A read-only agent session runs exactly one
 * statement per engine round-trip; the engine's read-only enforcement is only sound when a
 * hostile string cannot smuggle a second command past it (e.g. `… ; SET SESSION … READ WRITE ;
 * COMMIT ; INSERT …`). No hand-rolled classifier can be trusted to see every separator the
 * engine does, so this scanner is deliberately conservative: it returns `false` (not a single
 * statement) on anything it cannot prove — an unterminated or ambiguous string, comment, or
 * dollar-quote, or any statement separator followed by more content.
 *
 * "Fail closed" means every disagreement with the real lexer errs toward rejection: the scanner
 * ends strings and comments as early as it safely can so a separator the engine would honor is
 * never hidden inside a construct the scanner thinks is quoted. Any backslash inside a quoted
 * string is rejected on PostgreSQL and MySQL: whether it escapes the next quote depends on `E'…'`,
 * `standard_conforming_strings` or `sql_mode`, none of which the scanner can see. A false rejection
 * is safe where a false pass is not.
 */
export function isSingleStatement(sql: string, type?: ConnectionType): boolean {
	// With no dialect, the same bytes can be a quote on one engine and bare identifier chars on
	// another (`$$` is a Postgres dollar-quote but plain text in MySQL), so no single interpretation
	// is safe for whichever engine actually runs the SQL. Require every supported dialect to agree
	// it is one statement: the real engine is one of them, so a separator it honors is never missed.
	if (type === undefined) {
		return ALL_DIALECTS.every((dialect) => isSingleStatement(sql, dialect))
	}

	const stripped = stripQuotesAndComments(sql, type, { allowComments: true })
	if (stripped === null) return false // unterminated / ambiguous construct — fail closed

	// A single trailing separator (with only whitespace or stripped comments after it) is fine;
	// a separator followed by more statement content is not.
	for (let i = 0; i < stripped.length; i++) {
		if (stripped[i] !== ';') continue
		for (let j = i + 1; j < stripped.length; j++) {
			const ch = stripped[j]
			if (ch === ';' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
				continue
			}
			return false // real content after a separator → more than one statement
		}
		return true // only separators/whitespace follow
	}
	return true
}

/**
 * Whether `fragment` can be spliced into `WHERE (…)` as one boolean expression under the given
 * dialect: no statement separator, no comment, and parentheses that never close the wrapper.
 * Uses the same fail-closed lexing as `isSingleStatement`; with no dialect, every one must agree.
 */
export function isWhereFragment(fragment: string, type?: ConnectionType): boolean {
	if (type === undefined) {
		return ALL_DIALECTS.every((dialect) => isWhereFragment(fragment, dialect))
	}

	const stripped = stripQuotesAndComments(fragment, type, { allowComments: false })
	if (stripped === null) return false

	let depth = 0
	for (const ch of stripped) {
		if (ch === ';') return false
		if (ch === '(') depth++
		if (ch === ')' && --depth < 0) return false
	}
	return depth === 0
}

/**
 * Replace every string, quoted identifier, and comment with spaces so a caller can scan for
 * statement separators without matching one inside a literal. Returns `null` when a construct is
 * left open at end of input, when a dialect-specific ambiguity means the scanner cannot be sure
 * where a construct ends, or when it meets a comment and `allowComments` is off.
 *
 * The rules are dialect-specific because the engines genuinely differ (MySQL honors backslash
 * escapes and `#` comments and reads `$$` as bare text; Postgres nests block comments and has
 * dollar-quotes; SQLite has `[…]` identifiers). `isSingleStatement` handles the no-dialect case
 * itself by requiring all three to agree, so this always receives a concrete type.
 */
function stripQuotesAndComments(sql: string, type: ConnectionType, options: { allowComments: boolean }): string | null {
	const isMysql = type === 'mysql'
	const isPostgres = type === 'postgresql'
	const isSqlite = type === 'sqlite'

	// Backslash semantics in quoted text depend on server state (MySQL `sql_mode`, PostgreSQL
	// `E'…'` and `standard_conforming_strings`), so the scanner refuses to guess. PostgreSQL
	// identifiers never treat a backslash as an escape.
	const rejectBackslashInSingle = isMysql || isPostgres
	const rejectBackslashInDouble = isMysql
	const dollarQuotes = isPostgres
	const honorBacktick = isMysql || isSqlite
	const honorBracket = isSqlite
	const honorHash = isMysql
	const dashNeedsWhitespace = isMysql

	let out = ''
	let i = 0
	const n = sql.length

	while (i < n) {
		const ch = sql[i]
		const next = i + 1 < n ? sql[i + 1] : ''

		// ── Line comments ──────────────────────────────────
		// `--`: a comment for Postgres/SQLite always; for MySQL only when followed by an ASCII space
		// or control character, or end of input (`--x` is an operator there). What MySQL counts as a
		// space beyond ASCII depends on the connection charset, so a non-ASCII character fails closed.
		if (ch === '-' && next === '-') {
			let isComment = true
			if (dashNeedsWhitespace && i + 2 < n) {
				const after = sql.charCodeAt(i + 2)
				if (after > 0x7f) return null
				isComment = after <= 0x20 || after === 0x7f
			}
			if (isComment) {
				if (!options.allowComments) return null
				const end = lineCommentEnd(sql, i)
				if (end === null) return null
				out += ' '
				i = end
				continue
			}
		}
		// `#`: a line comment in MySQL.
		if (ch === '#' && honorHash) {
			if (!options.allowComments) return null
			const end = lineCommentEnd(sql, i)
			if (end === null) return null
			out += ' '
			i = end
			continue
		}

		// ── Block comments ─────────────────────────────────
		if (ch === '/' && next === '*') {
			if (!options.allowComments) return null
			// Whether MySQL/MariaDB run the inside of `/*! … */`, `/*+ … */` or `/*M! … */` depends on
			// the server's vendor and version and on where the hint sits — neither reading is safe.
			if (isMysql && /^[!+]|^[Mm]!/.test(sql.slice(i + 2, i + 4))) return null
			// Postgres nests block comments; the others do not. Getting nesting wrong is only safe
			// in the closing-early direction, so non-Postgres uses a flat scan and Postgres counts depth.
			if (isPostgres) {
				let depth = 0
				let j = i
				while (j < n) {
					if (sql[j] === '/' && sql[j + 1] === '*') {
						depth++
						j += 2
					} else if (sql[j] === '*' && sql[j + 1] === '/') {
						depth--
						j += 2
						if (depth === 0) break
					} else {
						j++
					}
				}
				if (depth !== 0) return null // unterminated nested comment
				out += ' '
				i = j
				continue
			}
			const end = sql.indexOf('*/', i + 2)
			out += ' '
			// SQLite tolerates an unterminated block comment (runs to EOF); MySQL does not, but
			// closing at EOF here only drops trailing content, which cannot hide a separator.
			i = end === -1 ? n : end + 2
			continue
		}

		// ── Dollar-quoted strings (Postgres only) ──────────
		// A `$` touching an identifier character or another `$` may continue that identifier
		// (`x$$`, `x$$$` are names) — or, after a number, open a quote (`1$$…$$`). The scanner cannot
		// tell those apart, so a tag-shaped `$` in that position fails closed.
		if (ch === '$' && dollarQuotes) {
			const tag = matchDollarTag(sql, i)
			if (tag) {
				const prev = i > 0 ? sql[i - 1] : ''
				if (isIdentChar(prev) || prev === '$') return null
				const end = sql.indexOf(tag, i + tag.length)
				if (end === -1) return null // unterminated dollar-quote
				out += ' '
				i = end + tag.length
				continue
			}
		}

		// ── Tcl-style variables (SQLite) ───────────────────
		// SQLite lexes `$a(…)` (also `@`, `:`, `#`) as one token running to `)` or whitespace, so it
		// can swallow a quote or a comment opener the scanner would honor.
		if (isSqlite && (ch === '$' || ch === '@' || ch === ':' || ch === '#') && isIdentChar(next)) {
			let j = i + 1
			while (j < n && (isIdentChar(sql[j]) || (sql[j] === ':' && sql[j + 1] === ':'))) j += sql[j] === ':' ? 2 : 1
			if (sql[j] === '(') return null
		}

		// ── Single-quoted string ───────────────────────────
		if (ch === "'") {
			const end = skipQuoted(sql, i, "'", rejectBackslashInSingle)
			if (end === -1) return null
			out += ' '
			i = end
			continue
		}

		// ── Double-quoted string / identifier ──────────────
		if (ch === '"') {
			const end = skipQuoted(sql, i, '"', rejectBackslashInDouble)
			if (end === -1) return null
			out += ' '
			i = end
			continue
		}

		// ── Backtick identifier (MySQL, SQLite) ────────────
		if (ch === '`' && honorBacktick) {
			const end = skipQuoted(sql, i, '`', false)
			if (end === -1) return null
			out += ' '
			i = end
			continue
		}

		// ── Bracket identifier (SQLite) ────────────────────
		if (ch === '[' && honorBracket) {
			const end = sql.indexOf(']', i + 1)
			if (end === -1) return null
			out += ' '
			i = end + 1
			continue
		}

		out += ch
		i++
	}

	return out
}

/**
 * Index just past a line comment starting at `start`, or null when its end is ambiguous: a bare
 * `\r` ends the comment for PostgreSQL but not for MySQL or SQLite. `\r\n` is fine for all three.
 */
function lineCommentEnd(sql: string, start: number): number | null {
	for (let i = start; i < sql.length; i++) {
		if (sql[i] === '\n') return i + 1
		if (sql[i] === '\r' && sql[i + 1] !== '\n') return null
	}
	return sql.length
}

/** Match a `$tag$` opener at `start` (tag is a valid Postgres identifier or empty), or null. */
function matchDollarTag(sql: string, start: number): string | null {
	if (sql[start] !== '$') return null
	const first = sql.charCodeAt(start + 1)
	if (first >= 48 && first <= 57) return null // a tag cannot start with a digit (`$1` is a parameter)
	let i = start + 1
	while (i < sql.length && isIdentChar(sql[i])) i++
	if (sql[i] !== '$') return null
	return sql.slice(start, i + 1)
}

/**
 * Index just past a quoted region opened by `quote` at `start`. Honors doubling (`''`, `""`,
 * `` `` ``). Returns -1 when the region is left open, or when `rejectBackslash` is set and the
 * region contains a backslash — both of which the caller treats as "not provably single".
 */
function skipQuoted(sql: string, start: number, quote: string, rejectBackslash: boolean): number {
	let i = start + 1
	while (i < sql.length) {
		const ch = sql[i]
		if (rejectBackslash && ch === '\\') return -1
		if (ch === quote) {
			if (sql[i + 1] === quote) {
				i += 2 // doubled quote — an escaped quote, string continues
				continue
			}
			return i + 1
		}
		i++
	}
	return -1
}
