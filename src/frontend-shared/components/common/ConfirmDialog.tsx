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

	createEffect(() => {
		const req = request()
		if (!req) return

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault()
				cancel()
			} else if (e.key === 'Enter') {
				// Only fire if focus is on the dialog or its descendants,
				// to avoid stealing Enter from an input the user happens to type into.
				const active = document.activeElement
				if (active && (active === confirmBtnRef || active.tagName === 'BUTTON')) {
					return
				}
				e.preventDefault()
				confirm()
			}
		}

		const previouslyFocused = document.activeElement as HTMLElement | null
		document.addEventListener('keydown', handleKeyDown)

		requestAnimationFrame(() => {
			confirmBtnRef?.focus()
		})

		onCleanup(() => {
			document.removeEventListener('keydown', handleKeyDown)
			previouslyFocused?.focus()
		})
	})

	return (
		<Show when={request()}>
			{(req) => (
				<div class="confirm-dialog-overlay" onClick={handleOverlayClick}>
					<div class="confirm-dialog" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">
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
