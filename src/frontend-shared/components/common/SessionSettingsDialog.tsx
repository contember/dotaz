import { createSignal, createEffect } from "solid-js";
import Dialog from "./Dialog";
import { settingsStore, type SessionConfig } from "../../stores/settings";
import type { ConnectionMode, AutoPin, AutoUnpin } from "../../stores/session";
import "./FormatSettingsDialog.css";

interface SessionSettingsDialogProps {
	open: boolean;
	onClose: () => void;
}

export default function SessionSettingsDialog(props: SessionSettingsDialogProps) {
	const [mode, setMode] = createSignal<ConnectionMode>("pool");
	const [autoPin, setAutoPin] = createSignal<AutoPin>("on-begin");
	const [autoUnpin, setAutoUnpin] = createSignal<AutoUnpin>("never");

	createEffect(() => {
		if (props.open) {
			const c = settingsStore.sessionConfig;
			setMode(c.defaultConnectionMode);
			setAutoPin(c.autoPin);
			setAutoUnpin(c.autoUnpin);
		}
	});

	function handleSave() {
		const config: SessionConfig = {
			defaultConnectionMode: mode(),
			autoPin: autoPin(),
			autoUnpin: autoUnpin(),
		};
		settingsStore.saveSessionConfig(config);
		props.onClose();
	}

	return (
		<Dialog open={props.open} title="Session Settings" onClose={props.onClose}>
			<div class="fmt-dialog">
				<div class="fmt-dialog__section">
					<h4 class="fmt-dialog__section-title">Default Connection Mode</h4>
					<div class="fmt-dialog__field fmt-dialog__field--inline">
						<label class="fmt-dialog__label">Mode for new tabs</label>
						<select
							class="fmt-dialog__select"
							value={mode()}
							onChange={(e) => setMode(e.currentTarget.value as ConnectionMode)}
						>
							<option value="pool">Pool (shared connections)</option>
							<option value="pinned-per-tab">Pinned per tab (dedicated session)</option>
							<option value="single-session">Single session (all tabs share one)</option>
						</select>
					</div>
				</div>

				<div class="fmt-dialog__section">
					<h4 class="fmt-dialog__section-title">Auto-Pin</h4>
					<div class="fmt-dialog__field fmt-dialog__field--inline">
						<label class="fmt-dialog__label">Auto-create session when</label>
						<select
							class="fmt-dialog__select"
							value={autoPin()}
							onChange={(e) => setAutoPin(e.currentTarget.value as AutoPin)}
						>
							<option value="on-begin">BEGIN / START TRANSACTION</option>
							<option value="on-set-session">BEGIN + SET / CREATE TEMP</option>
							<option value="never">Never</option>
						</select>
					</div>
				</div>

				<div class="fmt-dialog__section">
					<h4 class="fmt-dialog__section-title">Auto-Unpin</h4>
					<div class="fmt-dialog__field fmt-dialog__field--inline">
						<label class="fmt-dialog__label">Auto-destroy session after</label>
						<select
							class="fmt-dialog__select"
							value={autoUnpin()}
							onChange={(e) => setAutoUnpin(e.currentTarget.value as AutoUnpin)}
						>
							<option value="on-commit">COMMIT / ROLLBACK</option>
							<option value="never">Never (keep session)</option>
						</select>
					</div>
				</div>

				<div class="fmt-dialog__actions">
					<button class="btn btn--secondary" onClick={props.onClose}>Cancel</button>
					<button class="btn btn--primary" onClick={handleSave}>Save</button>
				</div>
			</div>
		</Dialog>
	);
}
