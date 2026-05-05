import { isArrayType } from '../column-types'
import type { DatabaseDataType } from '../types/database'
import { isSqlDefault } from '../types/database'
import type { SqlDialect } from './dialect'

/**
 * Format a JS array as a PostgreSQL array literal, e.g. `["a","b"]` → `{a,b}`.
 * Strings that contain delimiters/whitespace/quotes/backslashes or that look
 * like the NULL keyword are quoted; quotes and backslashes inside quoted
 * elements are escaped per PG's `array_in` parser rules.
 */
export function formatPgArrayLiteral(arr: readonly unknown[]): string {
	const parts = arr.map((el) => {
		if (el === null || el === undefined) return 'NULL'
		if (typeof el === 'number' || typeof el === 'boolean') return String(el)
		if (typeof el === 'string') return quoteArrayElement(el)
		// Nested arrays (multi-dim) — recurse, but render with PG's nested
		// `{...}` syntax rather than wrapping in quotes.
		if (Array.isArray(el)) return formatPgArrayLiteral(el)
		// Other structured values fall back to JSON inside a quoted element.
		return quoteArrayElement(JSON.stringify(el))
	})
	return '{' + parts.join(',') + '}'
}

function quoteArrayElement(s: string): string {
	if (s === '' || /^null$/i.test(s) || /[,{}\\"\s]/.test(s)) {
		return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
	}
	return s
}

/**
 * Convert a JS value to the wire form expected by the target driver for the
 * given column type. Pass-through for everything except PG array columns,
 * where Bun.SQL's default `String(value)` produces a malformed array literal.
 */
export function serializeValueForDialect(
	value: unknown,
	dataType: DatabaseDataType,
	dialect: SqlDialect,
): unknown {
	if (value === null || value === undefined) return value
	if (isSqlDefault(value)) return value
	if (dialect.getDriverType() === 'postgresql' && isArrayType(dataType) && Array.isArray(value)) {
		return formatPgArrayLiteral(value)
	}
	return value
}
