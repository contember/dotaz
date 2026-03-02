import { createSignal, createEffect } from "solid-js";
import Dialog from "./Dialog";
import { settingsStore } from "../../stores/settings";
import type { AiProvider } from "../../../shared/types/settings";
import "./FormatSettingsDialog.css";

interface AiSettingsDialogProps {
	open: boolean;
	onClose: () => void;
}

export default function AiSettingsDialog(props: AiSettingsDialogProps) {
	const [provider, setProvider] = createSignal<AiProvider>("anthropic");
	const [apiKey, setApiKey] = createSignal("");
	const [model, setModel] = createSignal("");
	const [endpoint, setEndpoint] = createSignal("");

	createEffect(() => {
		if (props.open) {
			const config = settingsStore.aiConfig;
			setProvider(config.provider);
			setApiKey(config.apiKey);
			setModel(config.model);
			setEndpoint(config.endpoint);
		}
	});

	function handleSave() {
		settingsStore.saveAiConfig({
			provider: provider(),
			apiKey: apiKey(),
			model: model(),
			endpoint: endpoint(),
		});
		props.onClose();
	}

	function defaultModel(): string {
		switch (provider()) {
			case "anthropic": return "claude-sonnet-4-20250514";
			case "openai": return "gpt-4o";
			case "custom": return "";
		}
	}

	return (
		<Dialog open={props.open} title="AI Settings" onClose={props.onClose}>
			<div class="fmt-dialog">
				<div class="fmt-dialog__section">
					<h4 class="fmt-dialog__section-title">LLM Provider</h4>
					<div class="fmt-dialog__field fmt-dialog__field--inline">
						<label class="fmt-dialog__label">Provider</label>
						<select
							class="fmt-dialog__select"
							value={provider()}
							onChange={(e) => {
								const p = e.currentTarget.value as AiProvider;
								setProvider(p);
								if (!model()) setModel(defaultModel());
							}}
						>
							<option value="anthropic">Anthropic (Claude)</option>
							<option value="openai">OpenAI</option>
							<option value="custom">Custom (OpenAI-compatible)</option>
						</select>
					</div>
				</div>

				<div class="fmt-dialog__section">
					<h4 class="fmt-dialog__section-title">API Key</h4>
					<div class="fmt-dialog__field">
						<input
							class="fmt-dialog__input"
							type="password"
							placeholder="Enter your API key..."
							value={apiKey()}
							onInput={(e) => setApiKey(e.currentTarget.value)}
							autocomplete="off"
						/>
					</div>
				</div>

				<div class="fmt-dialog__section">
					<h4 class="fmt-dialog__section-title">Model</h4>
					<div class="fmt-dialog__field">
						<input
							class="fmt-dialog__input"
							type="text"
							placeholder={defaultModel() || "model-name"}
							value={model()}
							onInput={(e) => setModel(e.currentTarget.value)}
						/>
					</div>
				</div>

				<div class="fmt-dialog__section">
					<h4 class="fmt-dialog__section-title">Custom Endpoint</h4>
					<div class="fmt-dialog__field">
						<input
							class="fmt-dialog__input"
							type="text"
							placeholder={provider() === "custom" ? "https://your-api.example.com" : "Leave empty for default"}
							value={endpoint()}
							onInput={(e) => setEndpoint(e.currentTarget.value)}
						/>
					</div>
					<div class="fmt-dialog__preview" style={{ "font-size": "11px" }}>
						{provider() === "anthropic" && "Default: https://api.anthropic.com"}
						{provider() === "openai" && "Default: https://api.openai.com"}
						{provider() === "custom" && "Required for custom providers"}
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
