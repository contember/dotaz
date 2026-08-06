import { describe, expect, test } from 'bun:test'
import { replaceRecordContents } from '../src/frontend-shared/lib/store-records'

describe('replaceRecordContents', () => {
	test('returns a store update that removes missing keys without mutating the target', () => {
		const target = { stale: 1, retained: 2 }

		const replacement = replaceRecordContents(target, { retained: 3, added: 4 })

		expect(replacement).toEqual({ stale: undefined, retained: 3, added: 4 })
		expect(target).toEqual({ stale: 1, retained: 2 })
	})
})
