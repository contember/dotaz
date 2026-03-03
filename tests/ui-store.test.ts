import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { friendlyErrorMessage, RpcError } from '../src/frontend-shared/lib/rpc-errors'

// ── Mock solid-js/store ──────────────────────────────────

let storeState: any

mock.module('solid-js/store', () => ({
	createStore: (initial: any) => {
		storeState = structuredClone(initial)

		const setStore = (...args: any[]) => {
			if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'function') {
				// setState("key", fn)
				storeState[args[0]] = args[1](storeState[args[0]])
			} else if (args.length === 2 && typeof args[0] === 'string') {
				// setState("key", value)
				storeState[args[0]] = args[1]
			}
		}

		return [storeState, setStore]
	},
}))

// Must import after mock
const { uiStore } = await import('../src/frontend-shared/stores/ui')

// ── UI Store: toast management ──────────────────────────

describe('uiStore', () => {
	beforeEach(() => {
		// Clear all toasts between tests
		storeState.toasts = []
	})

	test('addToast adds a toast and returns its id', () => {
		const id = uiStore.addToast('info', 'Hello')
		expect(id).toBeTruthy()
		expect(uiStore.toasts).toHaveLength(1)
		expect(uiStore.toasts[0].type).toBe('info')
		expect(uiStore.toasts[0].message).toBe('Hello')
	})

	test('removeToast removes a toast by id', () => {
		const id = uiStore.addToast('info', 'To be removed')
		expect(uiStore.toasts).toHaveLength(1)
		uiStore.removeToast(id)
		expect(uiStore.toasts).toHaveLength(0)
	})

	test('multiple toasts stack', () => {
		uiStore.addToast('success', 'First')
		uiStore.addToast('error', 'Second')
		uiStore.addToast('warning', 'Third')
		expect(uiStore.toasts).toHaveLength(3)
		expect(uiStore.toasts[0].message).toBe('First')
		expect(uiStore.toasts[1].message).toBe('Second')
		expect(uiStore.toasts[2].message).toBe('Third')
	})

	test('error toasts are persistent by default (duration 0)', () => {
		uiStore.addToast('error', 'Persistent error')
		expect(uiStore.toasts[0].duration).toBe(0)
	})

	test('non-error toasts have 5s duration by default', () => {
		uiStore.addToast('success', 'Auto-dismiss')
		expect(uiStore.toasts[0].duration).toBe(5000)

		uiStore.addToast('info', 'Auto-dismiss info')
		expect(uiStore.toasts[1].duration).toBe(5000)

		uiStore.addToast('warning', 'Auto-dismiss warning')
		expect(uiStore.toasts[2].duration).toBe(5000)
	})

	test('duration can be overridden via options', () => {
		uiStore.addToast('error', 'Short error', { duration: 3000 })
		expect(uiStore.toasts[0].duration).toBe(3000)

		uiStore.addToast('info', 'Persistent info', { duration: 0 })
		expect(uiStore.toasts[1].duration).toBe(0)
	})

	test('removeToast is no-op for unknown id', () => {
		uiStore.addToast('info', 'Stay')
		uiStore.removeToast('nonexistent')
		expect(uiStore.toasts).toHaveLength(1)
	})
})

// ── friendlyErrorMessage ────────────────────────────────

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
