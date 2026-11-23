import { keyStatusStore } from '@dotaz/frontend-shared/stores/key-status'
import { describe, expect, test } from 'bun:test'

// Drives the store with what `storage.keyStatus` returns. Other test files replace
// `lib/rpc` with mock.module for the whole process, so the RPC call is not exercised here.
describe('key status notice', () => {
	test('a normal start shows no notice', () => {
		keyStatusStore.apply({ outcome: 'current', item: 'app-encryption-key-v1' })
		expect(keyStatusStore.notice).toBeNull()
	})

	test('web and demo, which use no keychain, show no notice', () => {
		keyStatusStore.apply(null)
		expect(keyStatusStore.notice).toBeNull()
	})

	test('a refused key says saved passwords cannot be decrypted and links the reset steps', () => {
		keyStatusStore.apply({ outcome: 'key-mismatch', item: 'app-encryption-key-v2-0123456789abcdef' })
		const notice = keyStatusStore.notice
		expect(notice?.title).toBe("Saved passwords can't be decrypted")
		expect(notice?.detail).toContain('"app-encryption-key-v2-0123456789abcdef"')
		expect(notice?.detail).toContain('weaker key derived from this machine')
		expect(notice?.linkUrl).toEndWith('docs/keychain.md#resetting-the-key')
	})

	test('a start without a keychain key says new passwords use the machine-derived key', () => {
		keyStatusStore.apply({ outcome: 'fallback', item: 'app-encryption-key-v1' })
		expect(keyStatusStore.notice?.title).toBe("Dotaz can't use its key in the system keychain")
		expect(keyStatusStore.notice?.detail).toContain('weaker key derived from this machine')
	})

	test('hides once dismissed until the next reported start', () => {
		keyStatusStore.apply({ outcome: 'key-mismatch', item: 'app-encryption-key-v1' })
		keyStatusStore.dismiss()
		expect(keyStatusStore.notice).toBeNull()
		keyStatusStore.apply({ outcome: 'key-mismatch', item: 'app-encryption-key-v1' })
		expect(keyStatusStore.notice).not.toBeNull()
	})
})
