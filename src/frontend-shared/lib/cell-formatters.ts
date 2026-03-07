import type { DateFormat, FormatProfile } from '../../shared/types/settings'

/**
 * Format a Date object according to a DateFormat profile.
 * Used by both the grid cell display and settings preview.
 */
export function formatDateWithProfile(d: Date, fmt: DateFormat): string {
	const pad = (n: number): string => String(n).padStart(2, '0')
	const Y = d.getFullYear()
	const M = pad(d.getMonth() + 1)
	const D = pad(d.getDate())
	const h = pad(d.getHours())
	const m = pad(d.getMinutes())
	const s = pad(d.getSeconds())

	switch (fmt) {
		case 'YYYY-MM-DD HH:mm:ss':
			return `${Y}-${M}-${D} ${h}:${m}:${s}`
		case 'DD.MM.YYYY HH:mm:ss':
			return `${D}.${M}.${Y} ${h}:${m}:${s}`
		case 'MM/DD/YYYY HH:mm:ss':
			return `${M}/${D}/${Y} ${h}:${m}:${s}`
		case 'YYYY-MM-DD':
			return `${Y}-${M}-${D}`
		case 'ISO 8601':
			return d.toISOString()
	}
}

/**
 * Parse an unknown value to a Date and format it with the given DateFormat.
 * Returns String(value) if the value cannot be parsed as a date.
 */
export function formatTimestamp(value: unknown, fmt: DateFormat): string {
	let d: Date | null = null
	if (value instanceof Date) {
		d = value
	} else if (typeof value === 'string') {
		const parsed = new Date(value)
		if (!Number.isNaN(parsed.getTime())) {
			d = parsed
		}
	}
	if (!d) return String(value)
	return formatDateWithProfile(d, fmt)
}

/**
 * Format a numeric value according to a FormatProfile
 * (decimal separator, thousands separator, decimal places).
 */
export function formatNumberWithProfile(value: unknown, profile: FormatProfile): string {
	const num = typeof value === 'number' ? value : Number(value)
	if (!Number.isFinite(num)) return String(value)

	let str: string
	if (profile.decimalPlaces >= 0) {
		str = num.toFixed(profile.decimalPlaces)
	} else {
		str = String(num)
	}

	const [intPart, fracPart] = str.split('.')

	let formattedInt = intPart
	if (profile.thousandsSeparator) {
		formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, profile.thousandsSeparator)
	}

	if (fracPart !== undefined) {
		return formattedInt + profile.decimalSeparator + fracPart
	}
	return formattedInt
}

/**
 * Format a boolean value according to a FormatProfile's booleanDisplay setting.
 */
export function formatBoolean(value: unknown, profile: FormatProfile): string {
	const truthy = !!value
	const parts = profile.booleanDisplay.split('/')
	return truthy ? parts[0] : parts[1]
}

/**
 * Format a binary value according to a FormatProfile's binaryDisplay setting.
 */
export function formatBinary(value: unknown, profile: FormatProfile): string {
	if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
		const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
		switch (profile.binaryDisplay) {
			case 'hex':
				return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
			case 'base64':
				return btoa(String.fromCharCode(...bytes))
			case 'size':
				return `(binary ${bytes.length} bytes)`
		}
	}
	// Fallback for non-buffer binary values
	const str = String(value)
	if (profile.binaryDisplay === 'size') {
		return `(binary ${str.length} bytes)`
	}
	return str
}

/**
 * Format a Date as a local ISO date string (YYYY-MM-DD).
 */
export function toLocalDateString(date: Date): string {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}
