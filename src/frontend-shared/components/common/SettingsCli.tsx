export default function SettingsCli(props: {
	enabled: boolean
	setEnabled: (v: boolean) => void
}) {
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
		</div>
	)
}
