import { createStore } from "solid-js/store";

// ── Toast types ──────────────────────────────────────────

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastOptions {
	/** Override auto-dismiss duration in ms. Set to 0 for persistent. */
	duration?: number;
}

export interface Toast {
	id: string;
	type: ToastType;
	message: string;
	duration: number;
}

// ── Store state ──────────────────────────────────────────

interface UIState {
	toasts: Toast[];
}

const DEFAULT_DURATION = 5000;

const [state, setState] = createStore<UIState>({
	toasts: [],
});

// ── Toast actions ────────────────────────────────────────

function addToast(type: ToastType, message: string, options?: ToastOptions): string {
	const id = crypto.randomUUID();
	// Errors are persistent by default; others auto-dismiss after 5s
	const duration = options?.duration ?? (type === "error" ? 0 : DEFAULT_DURATION);

	const toast: Toast = { id, type, message, duration };
	setState("toasts", (prev) => [...prev, toast]);

	if (duration > 0) {
		setTimeout(() => removeToast(id), duration);
	}

	return id;
}

function removeToast(id: string) {
	setState("toasts", (prev) => prev.filter((t) => t.id !== id));
}

// ── Export ────────────────────────────────────────────────

export const uiStore = {
	get toasts() {
		return state.toasts;
	},
	addToast,
	removeToast,
};
