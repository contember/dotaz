import { isBooleanType, isNumericType, isStructuredType } from '@dotaz/shared/column-types'
import { DatabaseDataType, isSqlDefault } from '@dotaz/shared/types/database'
import type { GridColumnDef } from '@dotaz/shared/types/grid'

// --- Number & size formatting ---

export function formatNumber(n: number): string {
	return n.toLocaleString()
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// --- Display formatting ---

export function formatDisplayValue(value: unknown, maxLength?: number): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'object') return JSON.stringify(value)
	const str = String(value)
	if (maxLength && str.length > maxLength) return str.slice(0, maxLength) + '...'
	return str
}

export function displayValue(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (isSqlDefault(value)) return 'DEFAULT'
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

export function tryFormatJson(value: unknown): string | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value, null, 2)
		} catch {
			return null
		}
	}
	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (
			(trimmed.startsWith('{') && trimmed.endsWith('}'))
			|| (trimmed.startsWith('[') && trimmed.endsWith(']'))
		) {
			try {
				const parsed = JSON.parse(trimmed)
				return JSON.stringify(parsed, null, 2)
			} catch {
				return null
			}
		}
	}
	return null
}

// --- Value conversion ---

export function valueToString(value: unknown, pretty?: boolean): string {
	if (value === null || value === undefined) return ''
	if (isSqlDefault(value)) return ''
	if (typeof value === 'object') return JSON.stringify(value, null, pretty ? 2 : undefined)
	return String(value)
}

/**
 * Format a value from a JSON-typed column. Unlike `valueToString`, this never
 * uses raw `String()` — primitives are emitted as JSON literals (strings get
 * quoted, etc.) so a JSON-encoded string scalar (corruption: `"[\"x\"]"` in
 * jsonb) is visually distinct from an actual array (`["x"]`).
 */
export function formatJsonValue(value: unknown, pretty = false): string {
	if (value === null || value === undefined) return ''
	if (isSqlDefault(value)) return ''
	return JSON.stringify(value, null, pretty ? 2 : undefined)
}

export interface ValueDisplayOptions {
	/** Pretty-print JSON across multiple lines. */
	pretty?: boolean
	/** Text for null values (default `'NULL'`). Use `''` for editor pre-fills. */
	nullText?: string
	/** Text for `DEFAULT` markers (default `'DEFAULT'`). Use `''` for editors. */
	defaultText?: string
	/** Truncate the result with an ellipsis after this many characters. */
	maxLength?: number
}

/**
 * Single, column-type-aware formatter used by every cell-value renderer
 * (grid cells, value panels, row detail, FK popover…). Centralised so the
 * JSON-string vs JSON-array distinction stays consistent across all surfaces.
 */
export function formatColumnValue(
	value: unknown,
	dataType: DatabaseDataType,
	opts: ValueDisplayOptions = {},
): string {
	const out = formatRaw(value, dataType, opts)
	if (opts.maxLength && out.length > opts.maxLength) return out.slice(0, opts.maxLength) + '...'
	return out
}

function formatRaw(value: unknown, dataType: DatabaseDataType, opts: ValueDisplayOptions): string {
	if (value === null || value === undefined) return opts.nullText ?? 'NULL'
	if (isSqlDefault(value)) return opts.defaultText ?? 'DEFAULT'
	// JSON & PG array columns share the same JSON-style rendering — both arrive
	// as parsed JS values and round-trip through JSON syntax in the editor.
	if (isStructuredType(dataType)) return formatJsonValue(value, opts.pretty ?? false)
	const jsonFormatted = tryFormatJson(value)
	if (jsonFormatted !== null) return opts.pretty ? jsonFormatted : jsonFormatted.replace(/\s+/g, ' ')
	return displayValue(value)
}

/**
 * Pre-fill string for an editor opened on a column-typed value. Empty string
 * for NULL/DEFAULT; otherwise the same formatting as the displayed cell so
 * round-trip "click-in / click-out without changes" is a no-op.
 */
export function formatColumnValueForEditor(value: unknown, dataType: DatabaseDataType): string {
	return formatColumnValue(value, dataType, { pretty: true, nullText: '', defaultText: '' })
}

export type ParseColumnResult =
	| { ok: true; value: unknown }
	| { ok: false; error: string }

/**
 * Parse a string from a JSON-column editor into the value to send to the DB.
 * Empty string maps to NULL when the column is nullable; otherwise it is an
 * error. Anything else must be valid JSON — saving the raw string would let
 * Bun.SQL re-stringify it and produce a double-encoded JSON-string scalar.
 */
export function parseJsonColumnInput(raw: string, nullable: boolean): ParseColumnResult {
	if (raw === '') {
		if (nullable) return { ok: true, value: null }
		return { ok: false, error: 'Value is required' }
	}
	try {
		return { ok: true, value: JSON.parse(raw) }
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' }
	}
}

export function parseValue(text: string, column: GridColumnDef): unknown {
	if (text === '') return column.nullable ? null : text
	if (isNumericType(column.dataType)) {
		const n = Number(text)
		return Number.isNaN(n) ? text : n
	}
	if (isBooleanType(column.dataType)) {
		const lower = text.toLowerCase()
		if (lower === 'true' || lower === '1' || lower === 't') return true
		if (lower === 'false' || lower === '0' || lower === 'f') return false
		return text
	}
	return text
}

export function dateInputValue(value: unknown, dataType: DatabaseDataType): string {
	if (value === null || value === undefined || isSqlDefault(value)) return ''
	const str = String(value)
	if (dataType === DatabaseDataType.Date) return str.substring(0, 10)
	const d = new Date(str)
	if (Number.isNaN(d.getTime())) return str
	return d.toISOString().substring(0, 19)
}
