/** Keyboard handling utilities: per-element KeyBindings + global KeyboardManager. */

import { commandRegistry } from "./commands";

// ── Per-element key handler ──────────────────────────────

export interface KeyBinding {
	key: string;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	handler: (e: KeyboardEvent) => void;
}

/**
 * Creates a keydown handler that dispatches to registered bindings.
 * Attach the returned function as an `onKeyDown` handler on a focusable element.
 */
export function createKeyHandler(bindings: KeyBinding[]): (e: KeyboardEvent) => void {
	return (e: KeyboardEvent) => {
		for (const binding of bindings) {
			const ctrlMatch = binding.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
			const shiftMatch = binding.shift ? e.shiftKey : !e.shiftKey;
			const altMatch = binding.alt ? e.altKey : !e.altKey;

			if (e.key.toLowerCase() === binding.key.toLowerCase() && ctrlMatch && shiftMatch && altMatch) {
				binding.handler(e);
				return;
			}
		}
	};
}

// ── Global KeyboardManager ───────────────────────────────

export type ShortcutContext = "global" | "data-grid" | "sql-console";

export interface ShortcutEntry {
	commandId: string;
	context: ShortcutContext;
}

/** Normalise a key combo string like "Ctrl+Shift+P" into a canonical form for matching. */
export function normalizeCombo(combo: string): string {
	const parts = combo.split("+").map((p) => p.trim().toLowerCase());
	// Sort modifiers first (ctrl, shift, alt), then the key
	const modifiers: string[] = [];
	let key = "";
	for (const p of parts) {
		if (p === "ctrl" || p === "meta" || p === "cmd") modifiers.push("ctrl");
		else if (p === "shift") modifiers.push("shift");
		else if (p === "alt") modifiers.push("alt");
		else key = p;
	}
	modifiers.sort();
	return [...modifiers, key].join("+");
}

/** Derive a normalised combo string from a KeyboardEvent. */
export function comboFromEvent(e: KeyboardEvent): string {
	const parts: string[] = [];
	if (e.ctrlKey || e.metaKey) parts.push("ctrl");
	if (e.shiftKey) parts.push("shift");
	if (e.altKey) parts.push("alt");
	parts.push(e.key.toLowerCase());
	parts.sort((a, b) => {
		const order = ["alt", "ctrl", "shift"];
		const ai = order.indexOf(a);
		const bi = order.indexOf(b);
		if (ai !== -1 && bi !== -1) return ai - bi;
		if (ai !== -1) return -1;
		if (bi !== -1) return 1;
		return 0;
	});
	return parts.join("+");
}

type ContextProvider = () => ShortcutContext;

class KeyboardManager {
	private shortcuts = new Map<string, ShortcutEntry>();
	private contextProvider: ContextProvider = () => "global";
	private boundHandler: ((e: KeyboardEvent) => void) | null = null;

	/** Register a shortcut mapping a key combo to a command ID. */
	register(combo: string, commandId: string, context: ShortcutContext = "global") {
		this.shortcuts.set(normalizeCombo(combo), { commandId, context });
	}

	/** Remove a shortcut by combo string. */
	unregister(combo: string) {
		this.shortcuts.delete(normalizeCombo(combo));
	}

	/** Set the function that determines the current context (based on active tab type). */
	setContextProvider(provider: ContextProvider) {
		this.contextProvider = provider;
	}

	/** Start listening on document keydown. */
	init() {
		if (this.boundHandler) return;
		this.boundHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
		document.addEventListener("keydown", this.boundHandler);
	}

	/** Stop listening and clean up. */
	destroy() {
		if (this.boundHandler) {
			document.removeEventListener("keydown", this.boundHandler);
			this.boundHandler = null;
		}
	}

	/** Core dispatch logic — exported for testing. */
	handleKeyDown(e: KeyboardEvent) {
		const combo = comboFromEvent(e);
		const entry = this.shortcuts.get(combo);
		if (!entry) return;

		// Context check: "global" always matches; specific contexts must match current
		const currentContext = this.contextProvider();
		if (entry.context !== "global" && entry.context !== currentContext) return;

		e.preventDefault();
		commandRegistry.execute(entry.commandId);
	}
}

export const keyboardManager = new KeyboardManager();
