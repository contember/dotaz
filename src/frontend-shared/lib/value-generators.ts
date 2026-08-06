import { DatabaseDataType } from '@dotaz/shared/types/database'

export type ValueGeneratorKind = 'uuid-v4' | 'uuid-v7' | 'current-date' | 'current-time' | 'current-timestamp'

export function getValueGeneratorKinds(dataType: DatabaseDataType): ValueGeneratorKind[] {
	switch (dataType) {
		case DatabaseDataType.Uuid:
			return ['uuid-v4', 'uuid-v7']
		case DatabaseDataType.Date:
			return ['current-date']
		case DatabaseDataType.Time:
			return ['current-time']
		case DatabaseDataType.Timestamp:
			return ['current-timestamp']
		default:
			return []
	}
}

function randomBytes(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(16))
}

function formatUuid(bytes: Uint8Array): string {
	if (bytes.length !== 16) {
		throw new RangeError('UUID source must contain exactly 16 bytes')
	}

	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function generateUuidV4(source = randomBytes()): string {
	const bytes = new Uint8Array(source)
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return formatUuid(bytes)
}

export function generateUuidV7(timestamp = Date.now(), source = randomBytes()): string {
	if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffffffff) {
		throw new RangeError('UUID v7 timestamp must fit in 48 bits')
	}

	const bytes = new Uint8Array(source)
	if (bytes.length !== 16) {
		throw new RangeError('UUID source must contain exactly 16 bytes')
	}

	let remaining = timestamp
	for (let index = 5; index >= 0; index--) {
		bytes[index] = remaining % 256
		remaining = Math.floor(remaining / 256)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x70
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return formatUuid(bytes)
}

export function generateCurrentDate(now = new Date()): string {
	const year = now.getFullYear()
	const month = String(now.getMonth() + 1).padStart(2, '0')
	const day = String(now.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

export function generateCurrentTime(now = new Date()): string {
	const hours = String(now.getHours()).padStart(2, '0')
	const minutes = String(now.getMinutes()).padStart(2, '0')
	const seconds = String(now.getSeconds()).padStart(2, '0')
	return `${hours}:${minutes}:${seconds}`
}

export function generateCurrentTimestamp(now = new Date()): string {
	return now.toISOString()
}
