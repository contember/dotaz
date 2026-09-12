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
 * never hidden inside a construct the scanner thinks is quoted. It may reject some exotic but
 * legitimate single statements (an `E'…\'…'` escape string, a `#` comment carrying a `;`); a
 * read-only agent query never needs those, and a false rejection is safe where a false pass is not.
 */
export function isSingleStatement(sql: string, type?: ConnectionType): boolean {
	// With no dialect, the same bytes can be a quote on one engine and bare identifier chars on
	// another (`$$` is a Postgres dollar-quote but plain text in MySQL), so no single interpretation
	// is safe for whichever engine actually runs the SQL. Require every supported dialect to agree
	// it is one statement: the real engine is one of them, so a separator it honors is never missed.
	if (type === undefined) {
		return ALL_DIALECTS.every((dialect) => isSingleStatement(sql, dialect))
	}

	const stripped = stripQuotesAndComments(sql, type)
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
 * Replace every string, quoted identifier, and comment with spaces so a caller can scan for
 * statement separators without matching one inside a literal. Returns `null` when a construct is
 * left open at end of input, or when a dialect-specific ambiguity means the scanner cannot be sure
 * where a construct ends — both are treated as "not provably single" by the caller.
 *
 * The rules are dialect-specific because the engines genuinely differ (MySQL honors backslash
 * escapes and `#` comments and reads `$$` as bare text; Postgres nests block comments and has
 * dollar-quotes; SQLite has `[…]` identifiers). `isSingleStatement` handles the no-dialect case
 * itself by requiring all three to agree, so this always receives a concrete type.
 */
function stripQuotesAndComments(sql: string, type: ConnectionType): string | null {
	const isMysql = type === 'mysql'
	const isPostgres = type === 'postgresql'
	const isSqlite = type === 'sqlite'

	// MySQL treats "…" as a string (with backslash escapes) unless ANSI_QUOTES is set; the others
	// treat it as an identifier. Either way it is a quoted region, so the only thing that matters
	// here is honoring backslash escapes when finding its end.
	const backslashInSingle = isMysql
	const backslashInDouble = isMysql
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
		// `--`: a comment for Postgres/SQLite always; for MySQL only when followed by whitespace
		// or end of input (`--x` is an operator there). Unknown dialect uses the MySQL rule so a
		// same-line separator after `--x` stays visible.
		if (ch === '-' && next === '-') {
			const after = i + 2 < n ? sql[i + 2] : ''
			const isComment = !dashNeedsWhitespace || after === '' || /\s/.test(after)
			if (isComment) {
				const eol = sql.indexOf('\n', i)
				out += ' '
				i = eol === -1 ? n : eol + 1
				continue
			}
		}
		// `#`: a line comment in MySQL. Honored under an unknown dialect too, so a `;` it might carry
		// cannot be left dangling as content.
		if (ch === '#' && honorHash) {
			const eol = sql.indexOf('\n', i)
			out += ' '
			i = eol === -1 ? n : eol + 1
			continue
		}

		// ── Block comments ─────────────────────────────────
		if (ch === '/' && next === '*') {
			// MySQL executes `/*! … */` and `/*+ … */`; scanning their contents keeps any inner
			// separator visible, so treat the `/*` as ordinary characters.
			if (isMysql && (sql[i + 2] === '!' || sql[i + 2] === '+')) {
				out += ch
				i++
				continue
			}
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
		// The opening `$` must not touch an identifier character, or it is part of that identifier
		// (`x$$` is a name, not a quote). This is the classifier bug the read-only bypass exploited.
		if (ch === '$' && dollarQuotes) {
			const prev = i > 0 ? sql[i - 1] : ''
			if (!isIdentChar(prev)) {
				const tag = matchDollarTag(sql, i)
				if (tag) {
					const end = sql.indexOf(tag, i + tag.length)
					if (end === -1) return null // unterminated dollar-quote
					out += ' '
					i = end + tag.length
					continue
				}
			}
		}

		// ── Single-quoted string ───────────────────────────
		if (ch === "'") {
			const end = skipQuoted(sql, i, "'", backslashInSingle)
			if (end === -1) return null
			out += ' '
			i = end
			continue
		}

		// ── Double-quoted string / identifier ──────────────
		if (ch === '"') {
			const end = skipQuoted(sql, i, '"', backslashInDouble)
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

/** Match a `$tag$` opener at `start` (tag is a valid Postgres identifier or empty), or null. */
function matchDollarTag(sql: string, start: number): string | null {
	if (sql[start] !== '$') return null
	let i = start + 1
	while (i < sql.length && isIdentChar(sql[i])) i++
	if (sql[i] !== '$') return null
	return sql.slice(start, i + 1)
}

/**
 * Index just past a quoted region opened by `quote` at `start`. Honors doubling (`''`, `""`,
 * `` `` ``) and, when `backslash` is set, backslash escapes. Returns -1 when the region is
 * left open — which the caller treats as "not provably single".
 */
function skipQuoted(sql: string, start: number, quote: string, backslash: boolean): number {
	let i = start + 1
	while (i < sql.length) {
		const ch = sql[i]
		if (backslash && ch === '\\') {
			i += 2
			continue
		}
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
