import { formatFingerprint } from '@dotaz/shared/remote-approval'
import { Show } from 'solid-js'
import { approversStore } from '../../stores/approvers'
import Dialog from '../common/Dialog'
import './ApproverRequestDialog.css'

/**
 * A device asks to approve agent proposals with its passkey. Only this window can accept it,
 * and only after the user compared the fingerprint with the one the device shows. Closing the
 * dialog declines; nothing is added unless the user clicks Pair.
 */
export default function ApproverRequestDialog() {
	const request = () => approversStore.request

	return (
		<Show when={request()}>
			{(req) => (
				<Dialog open title="Pair an approver key" onClose={() => void approversStore.decline(req())} class="approver-request-dialog">
					<div class="approver-request-dialog__content">
						<p>
							A device asks to approve database writes that agents propose through the <code>dotaz</code>{' '}
							CLI, using a passkey. Once paired, a signed approval from it runs the proposed SQL without a click in this window.
						</p>
						<dl class="approver-request-dialog__details">
							<dt>Label</dt>
							<dd>{req().label}</dd>
							<dt>Origin</dt>
							<dd>
								<code>{req().origin}</code>
							</dd>
							<dt>Relying party</dt>
							<dd>
								<code>{req().rpId}</code>
							</dd>
						</dl>
						<div class="approver-request-dialog__fingerprint" aria-label="Key fingerprint">
							{formatFingerprint(req().fingerprint)}
						</div>
						<p class="approver-request-dialog__warning">
							Pair it only if you started this yourself and the device shows exactly this fingerprint. Any program on this computer can ask; only you can
							accept.
						</p>
						<div class="approver-request-dialog__actions">
							<button type="button" class="btn btn--secondary" onClick={() => void approversStore.decline(req())}>
								Decline
							</button>
							<button type="button" class="btn btn--primary" onClick={() => void approversStore.confirm(req())}>
								Pair key
							</button>
						</div>
					</div>
				</Dialog>
			)}
		</Show>
	)
}
