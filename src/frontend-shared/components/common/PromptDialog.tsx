import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { uiStore } from '../../stores/ui'
import './PromptDialog.css'

/**
 * Renders the active prompt request from uiStore. Mounted once at the AppShell
 * level. Call sites obtain a Promise<string | null> via `uiStore.prompt()`.
 * Replaces `window.prompt` — Electrobun's system webview does not implement it.
 */
export default function PromptDialog() {
	const request = () => uiStore.promptRequest

	const [value, setValue] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)

	let inputRef: HTMLInputElement | undefined
	let dialogRef: HTMLDivElement | undefined

	function submit() {
		const req = request()
		if (!req) return
		const trimmed = value().trim()
		const validationError = req.validate?.(trimmed) ?? null
		if (validationError) {
			setError(validationError)
			return
		}
		uiStore.resolvePrompt(trimmed)
	}

	function cancel() {
		uiStore.resolvePrompt(null)
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) cancel()
	}

	// Reset local state + wire keyboard whenever a new request appears.
	createEffect(() => {
		const req = request()
		if (!req) return

		setValue(req.initialValue ?? '')
		setError(null)

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault()
				// Stop before the event reaches an underlying Dialog's listener so
				// we don't close the parent dialog too.
				e.stopPropagation()
				cancel()
			} else if (e.key === 'Enter') {
				const active = document.activeElement as HTMLElement | null
				if (active?.tagName === 'TEXTAREA' || active?.isContentEditable) return
				e.preventDefault()
				e.stopPropagation()
				submit()
			}
		}

		const previouslyFocused = document.activeElement as HTMLElement | null
		// Capture phase so we run before any outer Dialog's bubble-phase listener.
		document.addEventListener('keydown', handleKeyDown, true)

		requestAnimationFrame(() => {
			inputRef?.focus()
			inputRef?.select()
		})

		onCleanup(() => {
			document.removeEventListener('keydown', handleKeyDown, true)
			previouslyFocused?.focus()
		})
	})

	return (
		<Show when={request()}>
			{(req) => (
				<div class="prompt-dialog-overlay" onClick={handleOverlayClick}>
					<div ref={dialogRef} class="prompt-dialog" role="dialog" aria-labelledby="prompt-title">
						<h2 id="prompt-title" class="prompt-dialog__title">{req().title}</h2>
						<Show when={req().message}>
							<p class="prompt-dialog__message">{req().message}</p>
						</Show>
						<label class="prompt-dialog__field">
							<Show when={req().label}>
								<span class="prompt-dialog__label">{req().label}</span>
							</Show>
							<input
								ref={inputRef}
								type="text"
								class="prompt-dialog__input"
								value={value()}
								placeholder={req().placeholder}
								onInput={(e) => {
									setValue(e.currentTarget.value)
									if (error()) setError(null)
								}}
							/>
						</label>
						<Show when={error()}>
							<div class="prompt-dialog__error">{error()}</div>
						</Show>
						<div class="prompt-dialog__actions">
							<button type="button" class="btn btn--secondary" onClick={cancel}>
								{req().cancelLabel ?? 'Cancel'}
							</button>
							<button type="button" class="btn btn--primary" onClick={submit}>
								{req().confirmLabel ?? 'OK'}
							</button>
						</div>
					</div>
				</div>
			)}
		</Show>
	)
}
