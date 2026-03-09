import type { ColorTheme } from '@dotaz/shared/types/settings'
import Select from './Select'

export default function SettingsAppearance(props: {
	colorTheme: ColorTheme
	setColorTheme: (v: ColorTheme) => void
}) {
	return (
		<div class="settings-form">
			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Color Theme</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Theme</label>
					<Select
						class="settings-form__select"
						value={props.colorTheme}
						onChange={(v) => props.setColorTheme(v as ColorTheme)}
						options={[
							{ value: 'dark', label: 'Dark' },
							{ value: 'light', label: 'Light' },
							{ value: 'high-contrast', label: 'High Contrast' },
							{ value: 'nord', label: 'Nord' },
							{ value: 'solarized-dark', label: 'Solarized Dark' },
							{ value: 'monokai', label: 'Monokai' },
						]}
					/>
				</div>
			</div>
		</div>
	)
}
