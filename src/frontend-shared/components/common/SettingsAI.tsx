import type { AiProvider } from '@dotaz/shared/types/settings'
import Select from './Select'

export default function SettingsAI(props: {
	provider: AiProvider
	setProvider: (v: AiProvider) => void
	apiKey: string
	setApiKey: (v: string) => void
	model: string
	setModel: (v: string) => void
	endpoint: string
	setEndpoint: (v: string) => void
	defaultModel: string
}) {
	return (
		<div class="settings-form">
			<div class="settings-form__section">
				<h4 class="settings-form__section-title">LLM Provider</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Provider</label>
					<Select
						class="settings-form__select"
						value={props.provider}
						onChange={(v) => props.setProvider(v as AiProvider)}
						options={[
							{ value: 'anthropic', label: 'Anthropic (Claude)' },
							{ value: 'openai', label: 'OpenAI' },
							{ value: 'custom', label: 'Custom (OpenAI-compatible)' },
						]}
					/>
				</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">API Key</h4>
				<div class="settings-form__field">
					<input
						class="settings-form__input"
						type="password"
						placeholder="Enter your API key..."
						value={props.apiKey}
						onInput={(e) => props.setApiKey(e.currentTarget.value)}
						autocomplete="off"
					/>
				</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Model</h4>
				<div class="settings-form__field">
					<input
						class="settings-form__input"
						type="text"
						placeholder={props.defaultModel || 'model-name'}
						value={props.model}
						onInput={(e) => props.setModel(e.currentTarget.value)}
					/>
				</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Custom Endpoint</h4>
				<div class="settings-form__field">
					<input
						class="settings-form__input"
						type="text"
						placeholder={props.provider === 'custom' ? 'https://your-api.example.com' : 'Leave empty for default'}
						value={props.endpoint}
						onInput={(e) => props.setEndpoint(e.currentTarget.value)}
					/>
				</div>
				<div class="settings-form__preview" style={{ 'font-size': '11px' }}>
					{props.provider === 'anthropic' && 'Default: https://api.anthropic.com'}
					{props.provider === 'openai' && 'Default: https://api.openai.com'}
					{props.provider === 'custom' && 'Required for custom providers'}
				</div>
			</div>
		</div>
	)
}
