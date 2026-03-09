import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import { createStore, reconcile, unwrap } from 'solid-js/store'
import type { AiProvider, ColorTheme, FormatProfile } from '@dotaz/shared/types/settings'
import { formatDateWithProfile, formatNumberWithProfile } from '../../lib/cell-formatters'
import type { SessionConfig } from '../../stores/settings'
import { settingsStore } from '../../stores/settings'
import Dialog from './Dialog'
import SettingsAI from './SettingsAI'
import SettingsAppearance from './SettingsAppearance'
import SettingsDataFormat from './SettingsDataFormat'
import './SettingsDialog.css'
import SettingsGrid from './SettingsGrid'
import SettingsSession from './SettingsSession'

export type SettingsSection = 'appearance' | 'data-format' | 'ai' | 'session' | 'grid'

interface SettingsDialogProps {
	open: boolean
	onClose: () => void
	initialSection?: SettingsSection
}

export default function SettingsDialog(props: SettingsDialogProps) {
	const [section, setSection] = createSignal<SettingsSection>('appearance')
	const [appearance, setAppearance] = createStore({ colorTheme: 'dark' as ColorTheme })
	const [dataFormat, setDataFormat] = createStore<FormatProfile>({
		dateFormat: 'YYYY-MM-DD HH:mm:ss',
		decimalSeparator: '.',
		thousandsSeparator: '',
		decimalPlaces: -1,
		nullDisplay: 'NULL',
		booleanDisplay: 'true/false',
		binaryDisplay: 'size',
	})
	const [ai, setAi] = createStore({ provider: 'anthropic' as AiProvider, apiKey: '', model: '', endpoint: '' })
	const [session, setSession] = createStore<SessionConfig>({ defaultConnectionMode: 'pool', autoPin: 'on-begin', autoUnpin: 'never' })
	const [grid, setGrid] = createStore({ autoCount: false })
	let savedTheme: ColorTheme = 'dark'

	// Load all values when dialog opens
	createEffect(() => {
		if (props.open) {
			setSection(props.initialSection ?? 'appearance')

			const app = settingsStore.appearanceConfig
			setAppearance(reconcile({ colorTheme: app.colorTheme }))
			savedTheme = app.colorTheme

			setDataFormat(reconcile({ ...unwrap(settingsStore.formatProfile) }))
			setAi(reconcile({ ...unwrap(settingsStore.aiConfig) }))
			setSession(reconcile({ ...unwrap(settingsStore.sessionConfig) }))
			setGrid(reconcile({ autoCount: settingsStore.gridConfig.autoCount }))
		}
	})

	const numberPreview = createMemo(() => {
		return formatNumberWithProfile(1234567.891, dataFormat)
	})

	const datePreview = createMemo(() => {
		return formatDateWithProfile(new Date(2026, 2, 2, 14, 30, 45), dataFormat.dateFormat)
	})

	function defaultModel(): string {
		switch (ai.provider) {
			case 'anthropic':
				return 'claude-sonnet-4-20250514'
			case 'openai':
				return 'gpt-4o'
			case 'custom':
				return ''
		}
	}

	function handleCancel() {
		settingsStore.applyTheme(savedTheme)
		props.onClose()
	}

	function handleThemeChange(theme: ColorTheme) {
		setAppearance('colorTheme', theme)
		settingsStore.applyTheme(theme)
	}

	function handleSave() {
		settingsStore.saveAppearanceConfig({ colorTheme: appearance.colorTheme })
		settingsStore.saveFormatProfile({ ...unwrap(dataFormat) })
		settingsStore.saveAiConfig({ ...unwrap(ai) })
		settingsStore.saveSessionConfig({ ...unwrap(session) })
		settingsStore.saveGridConfig({ autoCount: grid.autoCount })
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
					<button
						class="settings-nav__item"
						classList={{ 'settings-nav__item--active': section() === 'grid' }}
						onClick={() => setSection('grid')}
					>
						Grid
					</button>
				</nav>

				<div class="settings-content">
					<Show when={section() === 'appearance'}>
						<SettingsAppearance
							colorTheme={appearance.colorTheme}
							setColorTheme={handleThemeChange}
						/>
					</Show>
					<Show when={section() === 'data-format'}>
						<SettingsDataFormat
							dateFormat={dataFormat.dateFormat}
							setDateFormat={(v) => setDataFormat('dateFormat', v)}
							decimalSeparator={dataFormat.decimalSeparator}
							setDecimalSeparator={(v) => setDataFormat('decimalSeparator', v)}
							thousandsSeparator={dataFormat.thousandsSeparator}
							setThousandsSeparator={(v) => setDataFormat('thousandsSeparator', v)}
							decimalPlaces={dataFormat.decimalPlaces}
							setDecimalPlaces={(v) => setDataFormat('decimalPlaces', v)}
							nullDisplay={dataFormat.nullDisplay}
							setNullDisplay={(v) => setDataFormat('nullDisplay', v)}
							booleanDisplay={dataFormat.booleanDisplay}
							setBooleanDisplay={(v) => setDataFormat('booleanDisplay', v)}
							binaryDisplay={dataFormat.binaryDisplay}
							setBinaryDisplay={(v) => setDataFormat('binaryDisplay', v)}
							datePreview={datePreview()}
							numberPreview={numberPreview()}
						/>
					</Show>
					<Show when={section() === 'ai'}>
						<SettingsAI
							provider={ai.provider}
							setProvider={(p) => {
								setAi('provider', p)
								if (!ai.model) setAi('model', defaultModel())
							}}
							apiKey={ai.apiKey}
							setApiKey={(v) => setAi('apiKey', v)}
							model={ai.model}
							setModel={(v) => setAi('model', v)}
							endpoint={ai.endpoint}
							setEndpoint={(v) => setAi('endpoint', v)}
							defaultModel={defaultModel()}
						/>
					</Show>
					<Show when={section() === 'session'}>
						<SettingsSession
							mode={session.defaultConnectionMode}
							setMode={(v) => setSession('defaultConnectionMode', v)}
							autoPin={session.autoPin}
							setAutoPin={(v) => setSession('autoPin', v)}
							autoUnpin={session.autoUnpin}
							setAutoUnpin={(v) => setSession('autoUnpin', v)}
						/>
					</Show>
					<Show when={section() === 'grid'}>
						<SettingsGrid
							autoCount={grid.autoCount}
							setAutoCount={(v) => setGrid('autoCount', v)}
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
