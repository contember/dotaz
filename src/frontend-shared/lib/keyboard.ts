/** Keyboard handling utilities: per-element KeyBindings + global KeyboardManager. */

import { commandRegistry } from './commands'

// ── Shortcut mode ────────────────────────────────────────

type ShortcutMode = 'desktop' | 'browser'
let shortcutMode: ShortcutMode = 'desktop'

/** Called by entry points to set the shortcut mode (default: "desktop"). */
export function setShortcutMode(mode: ShortcutMode) {
	shortcutMode = mode
}

/** Map of command IDs that differ between desktop and browser mode. */
const PLATFORM_SHORTCUTS: Record<string, { desktop: string; browser: string }> = {
	'new-sql-console': { desktop: 'Ctrl+N', browser: 'Alt+N' },
	'close-tab': { desktop: 'Ctrl+W', browser: 'Alt+W' },
	'next-tab': { desktop: 'Ctrl+Tab', browser: 'Alt+PageDown' },
	'prev-tab': { desktop: 'Ctrl+Shift+Tab', browser: 'Alt+PageUp' },
	'tab-switcher': { desktop: 'Ctrl+E', browser: 'Alt+E' },
}

/** Returns the correct shortcut combo for a platform-aware command ID. */
export function platformShortcut(commandId: string): string {
	const entry = PLATFORM_SHORTCUTS[commandId]
	if (!entry) throw new Error(`No platform shortcut for command: ${commandId}`)
	return shortcutMode === 'browser' ? entry.browser : entry.desktop
}

/** Returns true if the quick-value modifier key is pressed (Alt in browser, Ctrl/Cmd in desktop). */
export function isQuickValueModifier(e: KeyboardEvent): boolean {
	return shortcutMode === 'browser' ? e.altKey : (e.ctrlKey || e.metaKey)
}

/** Returns the label for the quick-value modifier ("Alt" in browser, "Ctrl" in desktop). */
export function quickValueModifierLabel(): string {
	return shortcutMode === 'browser' ? 'Alt' : 'Ctrl'
}

// ── Per-element key handler ──────────────────────────────

export interface KeyBinding {
	key: string
	ctrl?: boolean
	shift?: boolean
	alt?: boolean
	handler: (e: KeyboardEvent) => void
}

/**
 * Creates a keydown handler that dispatches to registered bindings.
 * Attach the returned function as an `onKeyDown` handler on a focusable element.
 */
export function createKeyHandler(bindings: KeyBinding[]): (e: KeyboardEvent) => void {
	return (e: KeyboardEvent) => {
		for (const binding of bindings) {
			const ctrlMatch = binding.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey)
			const shiftMatch = binding.shift ? e.shiftKey : !e.shiftKey
			const altMatch = binding.alt ? e.altKey : !e.altKey

			if (e.key.toLowerCase() === binding.key.toLowerCase() && ctrlMatch && shiftMatch && altMatch) {
				binding.handler(e)
				return
			}
		}
	}
}

// ── Global KeyboardManager ───────────────────────────────

export type ShortcutContext = 'global' | 'data-grid' | 'sql-console'

export interface ShortcutEntry {
	commandId: string
	context: ShortcutContext
}

/** Normalise a key combo string like "Ctrl+Shift+P" into a canonical form for matching. */
export function normalizeCombo(combo: string): string {
	const parts = combo.split('+').map((p) => p.trim().toLowerCase())
	// Sort modifiers first (ctrl, shift, alt), then the key
	const modifiers: string[] = []
	let key = ''
	for (const p of parts) {
		if (p === 'ctrl' || p === 'meta' || p === 'cmd') modifiers.push('ctrl')
		else if (p === 'shift') modifiers.push('shift')
		else if (p === 'alt') modifiers.push('alt')
		else key = p
	}
	modifiers.sort()
	return [...modifiers, key].join('+')
}

/** Derive a normalised combo string from a KeyboardEvent. */
export function comboFromEvent(e: KeyboardEvent): string {
	const parts: string[] = []
	if (e.ctrlKey || e.metaKey) parts.push('ctrl')
	if (e.shiftKey) parts.push('shift')
	if (e.altKey) parts.push('alt')
	parts.push(e.key.toLowerCase())
	parts.sort((a, b) => {
		const order = ['alt', 'ctrl', 'shift']
		const ai = order.indexOf(a)
		const bi = order.indexOf(b)
		if (ai !== -1 && bi !== -1) return ai - bi
		if (ai !== -1) return -1
		if (bi !== -1) return 1
		return 0
	})
	return parts.join('+')
}

type ContextProvider = () => ShortcutContext

class KeyboardManager {
	private shortcuts = new Map<string, ShortcutEntry>()
	private contextProvider: ContextProvider = () => 'global'
	private boundHandler: ((e: KeyboardEvent) => void) | null = null

	/** Register a shortcut mapping a key combo to a command ID. */
	register(combo: string, commandId: string, context: ShortcutContext = 'global') {
		this.shortcuts.set(normalizeCombo(combo), { commandId, context })
	}

	/** Remove a shortcut by combo string. */
	unregister(combo: string) {
		this.shortcuts.delete(normalizeCombo(combo))
	}

	/** Set the function that determines the current context (based on active tab type). */
	setContextProvider(provider: ContextProvider) {
		this.contextProvider = provider
	}

	/** Start listening on document keydown. */
	init() {
		if (this.boundHandler) return
		this.boundHandler = (e: KeyboardEvent) => this.handleKeyDown(e)
		document.addEventListener('keydown', this.boundHandler)
	}

	/** Stop listening and clean up. */
	destroy() {
		if (this.boundHandler) {
			document.removeEventListener('keydown', this.boundHandler)
			this.boundHandler = null
		}
	}

	/** Core dispatch logic — exported for testing. */
	handleKeyDown(e: KeyboardEvent) {
		// Skip if another handler (e.g. CodeMirror keymap) already handled the event
		if (e.defaultPrevented) return
		const combo = comboFromEvent(e)
		const entry = this.shortcuts.get(combo)
		if (!entry) return

		// Context check: "global" always matches; specific contexts must match current
		const currentContext = this.contextProvider()
		if (entry.context !== 'global' && entry.context !== currentContext) return

		e.preventDefault()
		commandRegistry.execute(entry.commandId)
	}
}

export const keyboardManager = new KeyboardManager()
