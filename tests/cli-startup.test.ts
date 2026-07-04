import { hasExplicitEncryptionKey, validateEncryptionKeyStartup } from '@dotaz/cli/startup'
import { describe, expect, test } from 'bun:test'

describe('CLI startup encryption key policy', () => {
	test('allows loopback binds without an explicit encryption key', () => {
		expect(validateEncryptionKeyStartup('localhost', undefined)).toBeNull()
		expect(validateEncryptionKeyStartup('127.0.0.1', undefined)).toBeNull()
		expect(validateEncryptionKeyStartup('[::1]', undefined)).toBeNull()
	})

	test('requires an explicit encryption key for non-loopback binds', () => {
		expect(validateEncryptionKeyStartup('0.0.0.0', undefined)).toContain('DOTAZ_ENCRYPTION_KEY is required')
		expect(validateEncryptionKeyStartup('::', undefined)).toContain('DOTAZ_ENCRYPTION_KEY is required')
		expect(validateEncryptionKeyStartup('dotaz.example', undefined)).toContain('DOTAZ_ENCRYPTION_KEY is required')
	})

	test('treats blank encryption keys as missing', () => {
		expect(hasExplicitEncryptionKey('')).toBe(false)
		expect(hasExplicitEncryptionKey('   ')).toBe(false)
		expect(validateEncryptionKeyStartup('0.0.0.0', '   ')).toContain('DOTAZ_ENCRYPTION_KEY is required')
	})

	test('accepts an explicit encryption key for non-loopback binds', () => {
		expect(hasExplicitEncryptionKey('stable-secret')).toBe(true)
		expect(validateEncryptionKeyStartup('0.0.0.0', 'stable-secret')).toBeNull()
	})
})
