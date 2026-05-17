/**
 * Extract a SQL identifier (optionally schema-qualified) at a given offset.
 * Drives Ctrl/Cmd-click navigation in the editor. Lightweight on purpose —
 * works on the raw text rather than the SQL syntax tree so it doesn't choke
 * on incomplete/invalid statements.
 */

export interface IdentifierAtCursor {
	/** Schema/database qualifier, if the identifier was written as `schema.name`. */
	schema?: string
	/** The unquoted identifier. */
	name: string
	/** Offsets of the *name* portion (schema qualifier not included). */
	from: number
	to: number
	/** Offset where the whole qualified expression begins (schema or name). */
	qualifiedFrom: number
}

const IDENT_CHAR = /[A-Za-z0-9_$]/

function scanIdentBackward(text: string, end: number): { from: number; raw: string } | null {
	if (end <= 0) return null
	// Quoted: "..." — scan back across everything except a stray unescaped quote
	if (text[end - 1] === '"') {
		let start = end - 1
		while (start > 0) {
			start--
			if (text[start] === '"') return { from: start, raw: text.slice(start + 1, end - 1) }
		}
		return null
	}
	let start = end
	while (start > 0 && IDENT_CHAR.test(text[start - 1])) start--
	if (start === end) return null
	return { from: start, raw: text.slice(start, end) }
}

function scanIdentForward(text: string, start: number): { to: number; raw: string } | null {
	if (start >= text.length) return null
	if (text[start] === '"') {
		let end = start + 1
		while (end < text.length && text[end] !== '"') end++
		if (end >= text.length) return null
		return { to: end + 1, raw: text.slice(start + 1, end) }
	}
	let end = start
	while (end < text.length && IDENT_CHAR.test(text[end])) end++
	if (end === start) return null
	return { to: end, raw: text.slice(start, end) }
}

export function getIdentifierAtCursor(text: string, pos: number): IdentifierAtCursor | null {
	if (pos < 0 || pos > text.length) return null

	// Find the identifier the cursor sits on or immediately abuts. Quoted form first.
	let from: number
	let to: number
	let name: string

	// Check if cursor is inside a quoted ident: a `"` to the left with a matching `"` to the right
	const leftQuoteIdx = text.lastIndexOf('"', pos - 1)
	if (leftQuoteIdx !== -1) {
		const rightQuoteIdx = text.indexOf('"', pos)
		// Even number of quotes between leftQuoteIdx and us means we're outside; odd means inside
		let between = 0
		for (let i = leftQuoteIdx; i < pos; i++) {
			if (text[i] === '"') between++
		}
		if (between % 2 === 1 && rightQuoteIdx !== -1) {
			from = leftQuoteIdx
			to = rightQuoteIdx + 1
			name = text.slice(leftQuoteIdx + 1, rightQuoteIdx)
		} else {
			const r = scanWord(text, pos)
			if (!r) return null
			from = r.from
			to = r.to
			name = r.raw
		}
	} else {
		const r = scanWord(text, pos)
		if (!r) return null
		from = r.from
		to = r.to
		name = r.raw
	}

	if (!name) return null
	// Reject pure-numeric tokens
	if (/^[0-9]/.test(name)) return null

	// Look for an optional `schema.` qualifier directly before the name (allow whitespace? no — sql ident `a . b` is rare, skip)
	let schema: string | undefined
	let qualifiedFrom = from
	if (from > 0 && text[from - 1] === '.') {
		const prev = scanIdentBackward(text, from - 1)
		if (prev) {
			schema = prev.raw
			qualifiedFrom = prev.from
		}
	}

	return { schema, name, from, to, qualifiedFrom }
}

function scanWord(text: string, pos: number): { from: number; to: number; raw: string } | null {
	let start = pos
	while (start > 0 && IDENT_CHAR.test(text[start - 1])) start--
	let end = pos
	while (end < text.length && IDENT_CHAR.test(text[end])) end++
	if (start === end) {
		// Cursor between non-ident chars; try the char right before
		const back = scanIdentBackward(text, pos)
		if (back && back.from < pos) return { from: back.from, to: pos, raw: back.raw }
		const fwd = scanIdentForward(text, pos)
		if (fwd) return { from: pos, to: fwd.to, raw: fwd.raw }
		return null
	}
	return { from: start, to: end, raw: text.slice(start, end) }
}
