import { describe, expect, test } from 'bun:test'
import {
	generateCurrentDate,
	generateCurrentTime,
	generateCurrentTimestamp,
	generateUuidV4,
	generateUuidV7,
	getValueGeneratorKinds,
} from '../src/frontend-shared/lib/value-generators'
import { DatabaseDataType } from '../src/shared/types/database'

describe('value generators', () => {
	test('exposes only generators compatible with the column type', () => {
		expect(getValueGeneratorKinds(DatabaseDataType.Uuid)).toEqual(['uuid-v4', 'uuid-v7'])
		expect(getValueGeneratorKinds(DatabaseDataType.Date)).toEqual(['current-date'])
		expect(getValueGeneratorKinds(DatabaseDataType.Time)).toEqual(['current-time'])
		expect(getValueGeneratorKinds(DatabaseDataType.Timestamp)).toEqual(['current-timestamp'])
		expect(getValueGeneratorKinds(DatabaseDataType.Text)).toEqual([])
		expect(getValueGeneratorKinds(DatabaseDataType.Integer)).toEqual([])
	})

	test('generates an RFC 4122 UUID v4', () => {
		const uuid = generateUuidV4(new Uint8Array(16).fill(0xff))

		expect(uuid).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
	})

	test('generates a time-ordered RFC 9562 UUID v7', () => {
		const uuid = generateUuidV7(0x0123456789ab, new Uint8Array(16))

		expect(uuid).toBe('01234567-89ab-7000-8000-000000000000')
	})

	test('rejects UUID v7 timestamps outside the 48-bit field', () => {
		expect(() => generateUuidV7(0x1000000000000)).toThrow(RangeError)
	})

	test('formats local date and time values', () => {
		const now = new Date(2026, 7, 6, 9, 5, 3)

		expect(generateCurrentDate(now)).toBe('2026-08-06')
		expect(generateCurrentTime(now)).toBe('09:05:03')
	})

	test('formats timestamps as ISO 8601', () => {
		const now = new Date('2026-08-06T07:05:03.123Z')

		expect(generateCurrentTimestamp(now)).toBe('2026-08-06T07:05:03.123Z')
	})
})
