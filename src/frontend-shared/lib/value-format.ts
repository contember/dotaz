import { DatabaseDataType, isSqlDefault } from '../../shared/types/database'
import type { GridColumnDef } from '../../shared/types/grid'
import { isBooleanType, isNumericType } from '../../shared/column-types'

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
