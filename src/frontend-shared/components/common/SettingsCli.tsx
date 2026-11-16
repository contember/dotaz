import { formatFingerprint } from '@dotaz/shared/remote-approval'
import { For, onMount, Show } from 'solid-js'
import { approversStore } from '../../stores/approvers'

export default function SettingsCli(props: {
	enabled: boolean
	setEnabled: (v: boolean) => void
}) {
	onMount(() => void approversStore.load())

	return (
		<div class="settings-form">
			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Command-line access</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Allow CLI access</label>
					<input
						type="checkbox"
						checked={props.enabled}
						onChange={(e) => props.setEnabled(e.currentTarget.checked)}
					/>
				</div>
				<div class="settings-form__preview">
					Off by default. When enabled, Dotaz opens a local control endpoint so the <code>dotaz</code>{' '}
					command — and any AI agent or other process running as you on this machine — can read every database this app is connected to: schemas, rows,
					query history. Writes are never executed directly: an agent can only propose SQL, which you approve or reject in a console tab. Turn this off
					when you are not using it.
				</div>
			</div>
			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Remote approvals</h4>
				<div class="settings-form__preview">
					Passkeys paired here can approve or reject a proposal from another device. Dotaz verifies each signature itself, over exactly the SQL, connection
					and database it will run, so nothing on this computer can approve on their behalf. A device asks to be paired through the CLI; you accept it here
					after comparing its fingerprint.
				</div>
				<Show when={approversStore.approvers.length > 0} fallback={<p class="settings-form__label">No keys paired.</p>}>
					<ul class="settings-approvers">
						<For each={approversStore.approvers}>
							{(approver) => (
								<li class="settings-approvers__item">
									<div class="settings-approvers__text">
										<strong>{approver.label}</strong>
										<span class="settings-approvers__meta">
											{approver.origin} · <code>{formatFingerprint(approver.fingerprint)}</code> · added {new Date(approver.addedAt).toLocaleDateString()}
										</span>
									</div>
									<button type="button" class="btn btn--secondary btn--sm" onClick={() => void approversStore.remove(approver)}>
										Remove
									</button>
								</li>
							)}
						</For>
					</ul>
				</Show>
			</div>
		</div>
	)
}
