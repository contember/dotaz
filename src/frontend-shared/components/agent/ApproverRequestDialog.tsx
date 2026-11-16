import { formatFingerprint } from '@dotaz/shared/remote-approval'
import type { ApproverRequest } from '@dotaz/shared/types/rpc'
import { createMemo, createSignal, onCleanup, Show } from 'solid-js'
import { approversStore } from '../../stores/approvers'
import Dialog from '../common/Dialog'
import './ApproverRequestDialog.css'

/** Pair stays disabled this long after a request appears, so a click meant for another dialog cannot land on it. */
const ARM_DELAY_MS = 1500

/**
 * A device asks to approve agent proposals with its passkey. Only this window can accept it,
 * and only after the user compared the fingerprint with the one the device shows. Closing the
 * dialog declines; nothing is added unless the user clicks Pair.
 */
export default function ApproverRequestDialog() {
	// Remount per request: a new request never inherits an armed Pair button.
	const requestId = createMemo(() => approversStore.request?.requestId)

	return (
		<Show when={requestId()} keyed>
			{(_id) => {
				const current = approversStore.request
				return current ? <PairingPrompt request={{ ...current }} /> : null
			}}
		</Show>
	)
}

/**
 * `request` is a copy taken when the prompt mounted: Pair confirms exactly the request id and
 * fingerprint on screen, and the backend refuses it if they no longer match what is waiting.
 */
function PairingPrompt(props: { request: ApproverRequest }) {
	const shown = props.request
	const [armed, setArmed] = createSignal(false)
	const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS)
	onCleanup(() => clearTimeout(timer))

	return (
		<Dialog open title="Pair an approver key" onClose={() => void approversStore.decline(shown)} class="approver-request-dialog">
			<div class="approver-request-dialog__content">
				<p>
					A device asks to approve database writes that agents propose through the <code>dotaz</code>{' '}
					CLI, using a passkey. Once paired, a signed approval from it runs the proposed SQL without a click in this window.
				</p>
				<dl class="approver-request-dialog__details">
					<dt>Label</dt>
					<dd>{shown.label}</dd>
					<dt>Origin</dt>
					<dd>
						<code>{shown.origin}</code>
					</dd>
					<dt>Relying party</dt>
					<dd>
						<code>{shown.rpId}</code>
					</dd>
				</dl>
				<div class="approver-request-dialog__fingerprint" aria-label="Key fingerprint">
					{formatFingerprint(shown.fingerprint)}
				</div>
				<p class="approver-request-dialog__warning">
					Pair it only if you started this yourself and the device shows exactly this fingerprint. Any program on this computer can ask; only you can
					accept.
				</p>
				<div class="approver-request-dialog__actions">
					<button type="button" class="btn btn--secondary" onClick={() => void approversStore.decline(shown)}>
						Decline
					</button>
					<button type="button" class="btn btn--primary" disabled={!armed()} onClick={() => void approversStore.confirm(shown)}>
						Pair key
					</button>
				</div>
			</div>
		</Dialog>
	)
}
