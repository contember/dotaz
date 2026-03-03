import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type {
	AiProvider,
	BinaryDisplay,
	BooleanDisplay,
	ColorTheme,
	DateFormat,
	DecimalSeparator,
	FormatProfile,
	NullDisplay,
	ThousandsSeparator,
} from '../../../shared/types/settings'
import type { AutoPin, AutoUnpin, ConnectionMode } from '../../stores/session'
import { settingsStore } from '../../stores/settings'
import type { SessionConfig } from '../../stores/settings'
import Dialog from './Dialog'
import './SettingsDialog.css'

export type SettingsSection = 'appearance' | 'data-format' | 'ai' | 'session'

interface SettingsDialogProps {
	open: boolean
	onClose: () => void
	initialSection?: SettingsSection
}

export default function SettingsDialog(props: SettingsDialogProps) {
	const [section, setSection] = createSignal<SettingsSection>('appearance')

	// ── Appearance signals ──
	const [colorTheme, setColorTheme] = createSignal<ColorTheme>('dark')
	let savedTheme: ColorTheme = 'dark'

	// ── Data Format signals ──
	const [dateFormat, setDateFormat] = createSignal<DateFormat>('YYYY-MM-DD HH:mm:ss')
	const [decimalSeparator, setDecimalSeparator] = createSignal<DecimalSeparator>('.')
	const [thousandsSeparator, setThousandsSeparator] = createSignal<ThousandsSeparator>('')
	const [decimalPlaces, setDecimalPlaces] = createSignal(-1)
	const [nullDisplay, setNullDisplay] = createSignal<NullDisplay>('NULL')
	const [booleanDisplay, setBooleanDisplay] = createSignal<BooleanDisplay>('true/false')
	const [binaryDisplay, setBinaryDisplay] = createSignal<BinaryDisplay>('size')

	// ── AI signals ──
	const [aiProvider, setAiProvider] = createSignal<AiProvider>('anthropic')
	const [apiKey, setApiKey] = createSignal('')
	const [aiModel, setAiModel] = createSignal('')
	const [aiEndpoint, setAiEndpoint] = createSignal('')

	// ── Session signals ──
	const [connMode, setConnMode] = createSignal<ConnectionMode>('pool')
	const [autoPin, setAutoPin] = createSignal<AutoPin>('on-begin')
	const [autoUnpin, setAutoUnpin] = createSignal<AutoUnpin>('never')

	// Load all values when dialog opens
	createEffect(() => {
		if (props.open) {
			// Set initial section
			setSection(props.initialSection ?? 'appearance')

			// Appearance
			const appearance = settingsStore.appearanceConfig
			setColorTheme(appearance.colorTheme)
			savedTheme = appearance.colorTheme

			// Data Format
			const p = settingsStore.formatProfile
			setDateFormat(p.dateFormat)
			setDecimalSeparator(p.decimalSeparator)
			setThousandsSeparator(p.thousandsSeparator)
			setDecimalPlaces(p.decimalPlaces)
			setNullDisplay(p.nullDisplay)
			setBooleanDisplay(p.booleanDisplay)
			setBinaryDisplay(p.binaryDisplay)

			// AI
			const ai = settingsStore.aiConfig
			setAiProvider(ai.provider)
			setApiKey(ai.apiKey)
			setAiModel(ai.model)
			setAiEndpoint(ai.endpoint)

			// Session
			const sess = settingsStore.sessionConfig
			setConnMode(sess.defaultConnectionMode)
			setAutoPin(sess.autoPin)
			setAutoUnpin(sess.autoUnpin)
		}
	})

	const numberPreview = createMemo(() => {
		const num = 1234567.891
		return formatNumberPreview(num, decimalSeparator(), thousandsSeparator(), decimalPlaces())
	})

	const datePreview = createMemo(() => {
		const now = new Date(2026, 2, 2, 14, 30, 45)
		return formatDatePreview(now, dateFormat())
	})

	function defaultModel(): string {
		switch (aiProvider()) {
			case 'anthropic':
				return 'claude-sonnet-4-20250514'
			case 'openai':
				return 'gpt-4o'
			case 'custom':
				return ''
		}
	}

	function handleCancel() {
		// Revert theme to saved value
		settingsStore.applyTheme(savedTheme)
		props.onClose()
	}

	function handleThemeChange(theme: ColorTheme) {
		setColorTheme(theme)
		// Live preview
		settingsStore.applyTheme(theme)
	}

	function handleSave() {
		// Save Appearance
		settingsStore.saveAppearanceConfig({ colorTheme: colorTheme() })

		// Save Data Format
		const profile: FormatProfile = {
			dateFormat: dateFormat(),
			decimalSeparator: decimalSeparator(),
			thousandsSeparator: thousandsSeparator(),
			decimalPlaces: decimalPlaces(),
			nullDisplay: nullDisplay(),
			booleanDisplay: booleanDisplay(),
			binaryDisplay: binaryDisplay(),
		}
		settingsStore.saveFormatProfile(profile)

		// Save AI
		settingsStore.saveAiConfig({
			provider: aiProvider(),
			apiKey: apiKey(),
			model: aiModel(),
			endpoint: aiEndpoint(),
		})

		// Save Session
		const sessionConfig: SessionConfig = {
			defaultConnectionMode: connMode(),
			autoPin: autoPin(),
			autoUnpin: autoUnpin(),
		}
		settingsStore.saveSessionConfig(sessionConfig)

		props.onClose()
	}

	return (
		<Dialog open={props.open} title="Settings" onClose={handleCancel} class="settings-dialog">
			<div class="settings-layout">
				<nav class="settings-nav">
					<button
						class="settings-nav__item"
						classList={{ 'settings-nav__item--active': section() === 'appearance' }}
						onClick={() => setSection('appearance')}
					>
						Appearance
					</button>
					<button
						class="settings-nav__item"
						classList={{ 'settings-nav__item--active': section() === 'data-format' }}
						onClick={() => setSection('data-format')}
					>
						Data Format
					</button>
					<button
						class="settings-nav__item"
						classList={{ 'settings-nav__item--active': section() === 'ai' }}
						onClick={() => setSection('ai')}
					>
						AI
					</button>
					<button
						class="settings-nav__item"
						classList={{ 'settings-nav__item--active': section() === 'session' }}
						onClick={() => setSection('session')}
					>
						Session
					</button>
				</nav>

				<div class="settings-content">
					<Show when={section() === 'appearance'}>
						<AppearanceSection
							colorTheme={colorTheme()}
							setColorTheme={handleThemeChange}
						/>
					</Show>
					<Show when={section() === 'data-format'}>
						<DataFormatSection
							dateFormat={dateFormat()}
							setDateFormat={setDateFormat}
							decimalSeparator={decimalSeparator()}
							setDecimalSeparator={setDecimalSeparator}
							thousandsSeparator={thousandsSeparator()}
							setThousandsSeparator={setThousandsSeparator}
							decimalPlaces={decimalPlaces()}
							setDecimalPlaces={setDecimalPlaces}
							nullDisplay={nullDisplay()}
							setNullDisplay={setNullDisplay}
							booleanDisplay={booleanDisplay()}
							setBooleanDisplay={setBooleanDisplay}
							binaryDisplay={binaryDisplay()}
							setBinaryDisplay={setBinaryDisplay}
							datePreview={datePreview()}
							numberPreview={numberPreview()}
						/>
					</Show>
					<Show when={section() === 'ai'}>
						<AiSection
							provider={aiProvider()}
							setProvider={(p) => {
								setAiProvider(p)
								if (!aiModel()) setAiModel(defaultModel())
							}}
							apiKey={apiKey()}
							setApiKey={setApiKey}
							model={aiModel()}
							setModel={setAiModel}
							endpoint={aiEndpoint()}
							setEndpoint={setAiEndpoint}
							defaultModel={defaultModel()}
						/>
					</Show>
					<Show when={section() === 'session'}>
						<SessionSection
							mode={connMode()}
							setMode={setConnMode}
							autoPin={autoPin()}
							setAutoPin={setAutoPin}
							autoUnpin={autoUnpin()}
							setAutoUnpin={setAutoUnpin}
						/>
					</Show>
				</div>
			</div>

			<div class="settings-actions">
				<button class="btn btn--secondary" onClick={handleCancel}>Cancel</button>
				<button class="btn btn--primary" onClick={handleSave}>Save</button>
			</div>
		</Dialog>
	)
}

// ── Appearance Section ───────────────────────────────────

function AppearanceSection(props: {
	colorTheme: ColorTheme
	setColorTheme: (v: ColorTheme) => void
}) {
	return (
		<div class="settings-form">
			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Color Theme</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Theme</label>
					<select
						class="settings-form__select"
						value={props.colorTheme}
						onChange={(e) => props.setColorTheme(e.currentTarget.value as ColorTheme)}
					>
						<option value="dark">Dark</option>
						<option value="light">Light</option>
						<option value="high-contrast">High Contrast</option>
						<option value="nord">Nord</option>
						<option value="solarized-dark">Solarized Dark</option>
						<option value="monokai">Monokai</option>
					</select>
				</div>
			</div>
		</div>
	)
}

// ── Data Format Section ──────────────────────────────────

function DataFormatSection(props: {
	dateFormat: DateFormat
	setDateFormat: (v: DateFormat) => void
	decimalSeparator: DecimalSeparator
	setDecimalSeparator: (v: DecimalSeparator) => void
	thousandsSeparator: ThousandsSeparator
	setThousandsSeparator: (v: ThousandsSeparator) => void
	decimalPlaces: number
	setDecimalPlaces: (v: number) => void
	nullDisplay: NullDisplay
	setNullDisplay: (v: NullDisplay) => void
	booleanDisplay: BooleanDisplay
	setBooleanDisplay: (v: BooleanDisplay) => void
	binaryDisplay: BinaryDisplay
	setBinaryDisplay: (v: BinaryDisplay) => void
	datePreview: string
	numberPreview: string
}) {
	return (
		<div class="settings-form">
			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Date & Time</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Display format</label>
					<select
						class="settings-form__select"
						value={props.dateFormat}
						onChange={(e) => props.setDateFormat(e.currentTarget.value as DateFormat)}
					>
						<option value="YYYY-MM-DD HH:mm:ss">YYYY-MM-DD HH:mm:ss</option>
						<option value="DD.MM.YYYY HH:mm:ss">DD.MM.YYYY HH:mm:ss</option>
						<option value="MM/DD/YYYY HH:mm:ss">MM/DD/YYYY HH:mm:ss</option>
						<option value="YYYY-MM-DD">YYYY-MM-DD (date only)</option>
						<option value="ISO 8601">ISO 8601</option>
					</select>
				</div>
				<div class="settings-form__preview">Preview: {props.datePreview}</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Numbers</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Decimal separator</label>
					<select
						class="settings-form__select"
						value={props.decimalSeparator}
						onChange={(e) => props.setDecimalSeparator(e.currentTarget.value as DecimalSeparator)}
					>
						<option value=".">Dot (.)</option>
						<option value=",">Comma (,)</option>
					</select>
				</div>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Thousands separator</label>
					<select
						class="settings-form__select"
						value={props.thousandsSeparator}
						onChange={(e) => props.setThousandsSeparator(e.currentTarget.value as ThousandsSeparator)}
					>
						<option value="">None</option>
						<option value=",">Comma (,)</option>
						<option value=".">Dot (.)</option>
						<option value=" ">Space</option>
					</select>
				</div>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Decimal places</label>
					<input
						class="settings-form__input settings-form__input--short"
						type="number"
						min="-1"
						max="20"
						value={props.decimalPlaces}
						onInput={(e) => props.setDecimalPlaces(Number(e.currentTarget.value))}
					/>
				</div>
				<div class="settings-form__preview">
					Preview: {props.numberPreview} <span style={{ color: 'var(--ink-muted)', 'font-size': 'var(--font-size-xs)' }}>(-1 = as-is)</span>
				</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">NULL Values</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Display text</label>
					<select
						class="settings-form__select"
						value={props.nullDisplay}
						onChange={(e) => props.setNullDisplay(e.currentTarget.value as NullDisplay)}
					>
						<option value="NULL">NULL</option>
						<option value="(empty)">(empty)</option>
						<option value={'\u2205'}>{'\u2205'} (empty set)</option>
					</select>
				</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Boolean</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Display format</label>
					<select
						class="settings-form__select"
						value={props.booleanDisplay}
						onChange={(e) => props.setBooleanDisplay(e.currentTarget.value as BooleanDisplay)}
					>
						<option value="true/false">true / false</option>
						<option value="1/0">1 / 0</option>
						<option value="yes/no">yes / no</option>
						<option value={'\u2713/\u2717'}>{'\u2713 / \u2717'} (check/cross)</option>
					</select>
				</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Binary Data</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Display format</label>
					<select
						class="settings-form__select"
						value={props.binaryDisplay}
						onChange={(e) => props.setBinaryDisplay(e.currentTarget.value as BinaryDisplay)}
					>
						<option value="size">(binary N bytes)</option>
						<option value="hex">Hex</option>
						<option value="base64">Base64</option>
					</select>
				</div>
			</div>
		</div>
	)
}

// ── AI Section ───────────────────────────────────────────

function AiSection(props: {
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
					<select
						class="settings-form__select"
						value={props.provider}
						onChange={(e) => props.setProvider(e.currentTarget.value as AiProvider)}
					>
						<option value="anthropic">Anthropic (Claude)</option>
						<option value="openai">OpenAI</option>
						<option value="custom">Custom (OpenAI-compatible)</option>
					</select>
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

// ── Session Section ──────────────────────────────────────

function SessionSection(props: {
	mode: ConnectionMode
	setMode: (v: ConnectionMode) => void
	autoPin: AutoPin
	setAutoPin: (v: AutoPin) => void
	autoUnpin: AutoUnpin
	setAutoUnpin: (v: AutoUnpin) => void
}) {
	return (
		<div class="settings-form">
			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Default Connection Mode</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Mode for new tabs</label>
					<select
						class="settings-form__select"
						value={props.mode}
						onChange={(e) => props.setMode(e.currentTarget.value as ConnectionMode)}
					>
						<option value="pool">Pool (shared connections)</option>
						<option value="pinned-per-tab">Pinned per tab (dedicated session)</option>
						<option value="single-session">Single session (all tabs share one)</option>
					</select>
				</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Auto-Pin</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Auto-create session when</label>
					<select
						class="settings-form__select"
						value={props.autoPin}
						onChange={(e) => props.setAutoPin(e.currentTarget.value as AutoPin)}
					>
						<option value="on-begin">BEGIN / START TRANSACTION</option>
						<option value="on-set-session">BEGIN + SET / CREATE TEMP</option>
						<option value="never">Never</option>
					</select>
				</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Auto-Unpin</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Auto-destroy session after</label>
					<select
						class="settings-form__select"
						value={props.autoUnpin}
						onChange={(e) => props.setAutoUnpin(e.currentTarget.value as AutoUnpin)}
					>
						<option value="on-commit">COMMIT / ROLLBACK</option>
						<option value="never">Never (keep session)</option>
					</select>
				</div>
			</div>
		</div>
	)
}

// ── Preview helpers ──────────────────────────────────────

function formatNumberPreview(num: number, decSep: string, thousSep: string, places: number): string {
	let str: string
	if (places >= 0) {
		str = num.toFixed(places)
	} else {
		str = String(num)
	}

	const [intPart, fracPart] = str.split('.')

	let formattedInt = intPart
	if (thousSep) {
		formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousSep)
	}

	if (fracPart !== undefined) {
		return formattedInt + decSep + fracPart
	}
	return formattedInt
}

function formatDatePreview(d: Date, format: DateFormat): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	const Y = d.getFullYear()
	const M = pad(d.getMonth() + 1)
	const D = pad(d.getDate())
	const h = pad(d.getHours())
	const m = pad(d.getMinutes())
	const s = pad(d.getSeconds())

	switch (format) {
		case 'YYYY-MM-DD HH:mm:ss':
			return `${Y}-${M}-${D} ${h}:${m}:${s}`
		case 'DD.MM.YYYY HH:mm:ss':
			return `${D}.${M}.${Y} ${h}:${m}:${s}`
		case 'MM/DD/YYYY HH:mm:ss':
			return `${M}/${D}/${Y} ${h}:${m}:${s}`
		case 'YYYY-MM-DD':
			return `${Y}-${M}-${D}`
		case 'ISO 8601':
			return d.toISOString()
	}
}
