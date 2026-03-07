import { describe, expect, test } from 'bun:test'
import { friendlyErrorMessage, RpcError } from '../src/frontend-shared/lib/rpc-errors'

describe('friendlyErrorMessage', () => {
	test('connection refused', () => {
		const msg = friendlyErrorMessage(new Error('connect ECONNREFUSED 127.0.0.1:5432'))
		expect(msg).toContain('Connection refused')
	})

	test('authentication failed', () => {
		const msg = friendlyErrorMessage(new Error('password authentication failed for user "admin"'))
		expect(msg).toContain('Authentication failed')
	})

	test('database not found', () => {
		const msg = friendlyErrorMessage(new Error('database "foo" does not exist'))
		expect(msg).toContain('Database not found')
	})

	test('timeout', () => {
		const msg = friendlyErrorMessage(new Error('Connection timed out after 30000ms'))
		expect(msg).toContain('timed out')
	})

	test('host not found', () => {
		const msg = friendlyErrorMessage(new Error('getaddrinfo ENOTFOUND myhost'))
		expect(msg).toContain('Host not found')
	})

	test('SSL error', () => {
		const msg = friendlyErrorMessage(new Error('SSL connection error: certificate verify failed'))
		expect(msg).toContain('SSL')
	})

	test('permission denied', () => {
		const msg = friendlyErrorMessage(new Error('permission denied for relation users'))
		expect(msg).toContain('Permission denied')
	})

	test('syntax error passes through', () => {
		const msg = friendlyErrorMessage(new Error('query.execute: syntax error at or near "SELEC"'))
		expect(msg).toContain('syntax error')
	})

	test('table not found passes through', () => {
		const msg = friendlyErrorMessage(new Error('query.execute: relation "foo" does not exist'))
		expect(msg).toContain('does not exist')
	})

	test('constraint violation passes through', () => {
		const msg = friendlyErrorMessage(new Error('data.applyChanges: violates unique constraint "users_email_key"'))
		expect(msg).toContain('violates')
		expect(msg).toContain('constraint')
	})

	test('RpcError strips method prefix', () => {
		const err = new RpcError('connections.connect', new Error('some backend error'))
		const msg = friendlyErrorMessage(err)
		expect(msg).toBe('some backend error')
	})

	test('non-Error value', () => {
		const msg = friendlyErrorMessage('plain string error')
		expect(msg).toBe('plain string error')
	})

	test('fallback for empty message', () => {
		const msg = friendlyErrorMessage(new Error(''))
		expect(msg).toBe('An unexpected error occurred')
	})
})
