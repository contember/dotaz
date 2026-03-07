import { beforeEach, describe, expect, mock, test } from 'bun:test'

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
		;[...uiStore.toasts].forEach((t) => uiStore.removeToast(t.id))
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

