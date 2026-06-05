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

// ── Confirm dialog types ─────────────────────────────────

export interface ConfirmOptions {
	title: string
	message: string
	/** Defaults to "Confirm". */
	confirmLabel?: string
	/** Defaults to "Cancel". */
	cancelLabel?: string
	/** Style the confirm button as destructive. */
	danger?: boolean
}

interface ConfirmRequest extends ConfirmOptions {
	id: string
	resolve: (confirmed: boolean) => void
}

// ── Prompt dialog types ──────────────────────────────────

export interface PromptOptions {
	title: string
	/** Optional explanatory text shown above the input. */
	message?: string
	/** Label rendered next to the input. */
	label?: string
	/** Pre-filled value (also selected on open). */
	initialValue?: string
	placeholder?: string
	/** Defaults to "OK". */
	confirmLabel?: string
	/** Defaults to "Cancel". */
	cancelLabel?: string
	/** Return an error string to block submission, or null when the value is valid. */
	validate?: (value: string) => string | null
}

interface PromptRequest extends PromptOptions {
	id: string
	resolve: (value: string | null) => void
}

// ── Store state ──────────────────────────────────────────

interface UIState {
	toasts: Toast[]
	confirmRequest: ConfirmRequest | null
	promptRequest: PromptRequest | null
}

const DEFAULT_DURATION = 5000

const [state, setState] = createStore<UIState>({
	toasts: [],
	confirmRequest: null,
	promptRequest: null,
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

// ── Confirm actions ──────────────────────────────────────

/**
 * Show an in-app confirmation dialog. Returns a Promise that resolves to
 * `true` when the user confirms and `false` on cancel / Escape / overlay
 * click. If another confirm is already open, it is resolved with `false`
 * before the new one shows — call sites should not assume serialization.
 */
function confirm(options: ConfirmOptions): Promise<boolean> {
	const previous = state.confirmRequest
	if (previous) {
		previous.resolve(false)
	}
	return new Promise<boolean>((resolve) => {
		setState('confirmRequest', { ...options, id: crypto.randomUUID(), resolve })
	})
}

/** Resolve the active confirm request. Called by ConfirmDialog on user action. */
function resolveConfirm(confirmed: boolean): void {
	const req = state.confirmRequest
	if (!req) return
	req.resolve(confirmed)
	setState('confirmRequest', null)
}

// ── Prompt actions ───────────────────────────────────────

/**
 * Show an in-app text input dialog. Returns a Promise that resolves to the
 * entered (trimmed) string when confirmed, or `null` on cancel / Escape /
 * overlay click. Replaces `window.prompt`, which the Electrobun system webview
 * does not implement. If another prompt is already open, it is resolved with
 * `null` before the new one shows.
 */
function prompt(options: PromptOptions): Promise<string | null> {
	const previous = state.promptRequest
	if (previous) {
		previous.resolve(null)
	}
	return new Promise<string | null>((resolve) => {
		setState('promptRequest', { ...options, id: crypto.randomUUID(), resolve })
	})
}

/** Resolve the active prompt request. Called by PromptDialog on user action. */
function resolvePrompt(value: string | null): void {
	const req = state.promptRequest
	if (!req) return
	req.resolve(value)
	setState('promptRequest', null)
}

// ── Export ────────────────────────────────────────────────

export const uiStore = {
	get toasts() {
		return state.toasts
	},
	get confirmRequest(): ConfirmRequest | null {
		return state.confirmRequest
	},
	get promptRequest(): PromptRequest | null {
		return state.promptRequest
	},
	addToast,
	removeToast,
	confirm,
	resolveConfirm,
	prompt,
	resolvePrompt,
}
