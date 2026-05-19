import { createEffect, onCleanup, Show } from 'solid-js'
import { uiStore } from '../../stores/ui'
import './ConfirmDialog.css'

/**
 * Renders the active confirmation request from uiStore. Mounted once at the
 * AppShell level. Call sites obtain a Promise<boolean> via `uiStore.confirm()`.
 * Replaces `window.confirm` — Electrobun's system webview does not implement it.
 */
export default function ConfirmDialog() {
	const request = () => uiStore.confirmRequest

	function confirm() {
		uiStore.resolveConfirm(true)
	}

	function cancel() {
		uiStore.resolveConfirm(false)
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) cancel()
	}

	let confirmBtnRef: HTMLButtonElement | undefined
	let dialogRef: HTMLDivElement | undefined

	createEffect(() => {
		const req = request()
		if (!req) return

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault()
				// Stop the event before it reaches the keydown listener on any
				// underlying Dialog so we don't close the parent dialog too.
				e.stopPropagation()
				cancel()
			} else if (e.key === 'Enter') {
				const active = document.activeElement as HTMLElement | null
				const tag = active?.tagName
				// Don't hijack Enter from a field where it has its own semantic.
				if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) return
				// If focus is on a button *inside* the dialog (confirm or cancel)
				// the browser already fires a native click — let it through.
				// A button elsewhere on the page (trigger, closed menu item) is
				// irrelevant: confirm anyway.
				if (tag === 'BUTTON' && dialogRef?.contains(active)) return
				e.preventDefault()
				e.stopPropagation()
				confirm()
			}
		}

		const previouslyFocused = document.activeElement as HTMLElement | null
		// Capture phase so we run before any outer Dialog's bubble-phase listener.
		document.addEventListener('keydown', handleKeyDown, true)

		requestAnimationFrame(() => {
			confirmBtnRef?.focus()
		})

		onCleanup(() => {
			document.removeEventListener('keydown', handleKeyDown, true)
			previouslyFocused?.focus()
		})
	})

	return (
		<Show when={request()}>
			{(req) => (
				<div class="confirm-dialog-overlay" onClick={handleOverlayClick}>
					<div ref={dialogRef} class="confirm-dialog" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">
						<h2 id="confirm-title" class="confirm-dialog__title">{req().title}</h2>
						<p id="confirm-message" class="confirm-dialog__message">{req().message}</p>
						<div class="confirm-dialog__actions">
							<button type="button" class="btn btn--secondary" onClick={cancel}>
								{req().cancelLabel ?? 'Cancel'}
							</button>
							<button
								ref={confirmBtnRef}
								type="button"
								class="btn"
								classList={{
									'btn--danger': req().danger === true,
									'btn--primary': req().danger !== true,
								}}
								onClick={confirm}
							>
								{req().confirmLabel ?? 'Confirm'}
							</button>
						</div>
					</div>
				</div>
			)}
		</Show>
	)
}
