import { createSignal, Show } from "solid-js";
import { connectionsStore } from "../../stores/connections";
import Dialog from "../common/Dialog";

export default function PasswordDialog() {
	const [password, setPassword] = createSignal("");

	function handleSubmit() {
		connectionsStore.resolvePasswordPrompt(password());
		setPassword("");
	}

	function handleCancel() {
		connectionsStore.resolvePasswordPrompt(null);
		setPassword("");
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			handleSubmit();
		}
	}

	return (
		<Show when={connectionsStore.passwordPrompt}>
			{(prompt) => (
				<Dialog
					open={true}
					title={`Connect to ${prompt().connectionName}`}
					onClose={handleCancel}
				>
					<div class="conn-dialog">
						<div class="conn-dialog__field">
							<label class="conn-dialog__label">Password</label>
							<input
								class="conn-dialog__input"
								type="password"
								value={password()}
								onInput={(e) => setPassword(e.currentTarget.value)}
								onKeyDown={handleKeyDown}
								placeholder="Enter password"
								autofocus
							/>
						</div>
						<div class="conn-dialog__actions">
							<div />
							<div class="conn-dialog__actions-right">
								<button
									class="conn-dialog__btn conn-dialog__btn--secondary"
									onClick={handleCancel}
								>
									Cancel
								</button>
								<button
									class="conn-dialog__btn conn-dialog__btn--primary"
									onClick={handleSubmit}
								>
									Connect
								</button>
							</div>
						</div>
					</div>
				</Dialog>
			)}
		</Show>
	);
}
