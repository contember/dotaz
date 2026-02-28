/** Basic keyboard handling utility for grid shortcuts. */

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
