import { beforeEach, describe, expect, mock, test } from 'bun:test'

// ── Mock solid-js/store ──────────────────────────────────

mock.module('solid-js/store', () => ({
	createStore: (initial: any) => {
		const localState = structuredClone(initial)

		const setStore = (...args: any[]) => {
			if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'function') {
				// setState("key", fn)
				localState[args[0]] = args[1](localState[args[0]])
			} else if (args.length === 2 && typeof args[0] === 'string') {
				// setState("key", value)
				localState[args[0]] = args[1]
			}
		}

		return [localState, setStore]
	},
}))

// Must import after mock
const { uiStore } = await import('@dotaz/frontend-shared/stores/ui')

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

// ── UI Store: confirm dialog ─────────────────────────────

describe('uiStore.confirm', () => {
	test('confirm resolves true when user confirms', async () => {
		const promise = uiStore.confirm({ title: 'T', message: 'M' })
		expect(uiStore.confirmRequest).not.toBeNull()
		uiStore.resolveConfirm(true)
		expect(await promise).toBe(true)
		expect(uiStore.confirmRequest).toBeNull()
	})

	test('confirm resolves false when user cancels', async () => {
		const promise = uiStore.confirm({ title: 'T', message: 'M' })
		uiStore.resolveConfirm(false)
		expect(await promise).toBe(false)
		expect(uiStore.confirmRequest).toBeNull()
	})

	test('opening a second confirm resolves the previous one with false', async () => {
		const first = uiStore.confirm({ title: 'First', message: 'M1' })
		// Open a second confirm before resolving the first — the first must not hang.
		const second = uiStore.confirm({ title: 'Second', message: 'M2' })
		expect(await first).toBe(false)

		expect(uiStore.confirmRequest?.title).toBe('Second')
		uiStore.resolveConfirm(true)
		expect(await second).toBe(true)
	})

	test('confirmRequest carries through optional labels and danger flag', () => {
		uiStore.confirm({
			title: 'Delete connection',
			message: 'Forever?',
			confirmLabel: 'Delete',
			cancelLabel: 'Keep',
			danger: true,
		})
		const req = uiStore.confirmRequest
		expect(req?.confirmLabel).toBe('Delete')
		expect(req?.cancelLabel).toBe('Keep')
		expect(req?.danger).toBe(true)
		uiStore.resolveConfirm(false)
	})

	test('resolveConfirm is a no-op when no request is active', () => {
		// Should not throw
		uiStore.resolveConfirm(true)
		expect(uiStore.confirmRequest).toBeNull()
	})
})
