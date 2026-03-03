import { createStore } from 'solid-js/store'

// ── Toast types ──────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastOptions {
	/** Override auto-dismiss duration in ms. Set to 0 for persistent. */
	duration?: number
}

export interface Toast {
	id: string
	type: ToastType
	message: string
	duration: number
}

// ── Store state ──────────────────────────────────────────

interface UIState {
	toasts: Toast[]
}

const DEFAULT_DURATION = 5000

const [state, setState] = createStore<UIState>({
	toasts: [],
})

/** Maps toast ID to its auto-dismiss timer, so we can cancel on manual dismiss. */
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>()

// ── Toast actions ────────────────────────────────────────

function addToast(type: ToastType, message: string, options?: ToastOptions): string {
	// Deduplicate: skip if there's already an active toast with the same type and message
	const existing = state.toasts.find((t) => t.type === type && t.message === message)
	if (existing) return existing.id

	const id = crypto.randomUUID()
	// Errors are persistent by default; others auto-dismiss after 5s
	const duration = options?.duration ?? (type === 'error' ? 0 : DEFAULT_DURATION)

	const toast: Toast = { id, type, message, duration }
	setState('toasts', (prev) => [...prev, toast])

	if (duration > 0) {
		const timer = setTimeout(() => {
			toastTimers.delete(id)
			removeToast(id)
		}, duration)
		toastTimers.set(id, timer)
	}

	return id
}

function removeToast(id: string) {
	const timer = toastTimers.get(id)
	if (timer) {
		clearTimeout(timer)
		toastTimers.delete(id)
	}
	setState('toasts', (prev) => prev.filter((t) => t.id !== id))
}

// ── Export ────────────────────────────────────────────────

export const uiStore = {
	get toasts() {
		return state.toasts
	},
	addToast,
	removeToast,
}
