import type { BinaryDisplay, BooleanDisplay, DateFormat, DecimalSeparator, NullDisplay, ThousandsSeparator } from '@dotaz/shared/types/settings'
import Select from './Select'

export default function SettingsDataFormat(props: {
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
					<Select
						class="settings-form__select"
						value={props.dateFormat}
						onChange={(v) => props.setDateFormat(v as DateFormat)}
						options={[
							{ value: 'YYYY-MM-DD HH:mm:ss', label: 'YYYY-MM-DD HH:mm:ss' },
							{ value: 'DD.MM.YYYY HH:mm:ss', label: 'DD.MM.YYYY HH:mm:ss' },
							{ value: 'MM/DD/YYYY HH:mm:ss', label: 'MM/DD/YYYY HH:mm:ss' },
							{ value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (date only)' },
							{ value: 'ISO 8601', label: 'ISO 8601' },
						]}
					/>
				</div>
				<div class="settings-form__preview">Preview: {props.datePreview}</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Numbers</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Decimal separator</label>
					<Select
						class="settings-form__select"
						value={props.decimalSeparator}
						onChange={(v) => props.setDecimalSeparator(v as DecimalSeparator)}
						options={[
							{ value: '.', label: 'Dot (.)' },
							{ value: ',', label: 'Comma (,)' },
						]}
					/>
				</div>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Thousands separator</label>
					<Select
						class="settings-form__select"
						value={props.thousandsSeparator}
						onChange={(v) => props.setThousandsSeparator(v as ThousandsSeparator)}
						options={[
							{ value: '', label: 'None' },
							{ value: ',', label: 'Comma (,)' },
							{ value: '.', label: 'Dot (.)' },
							{ value: ' ', label: 'Space' },
						]}
					/>
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
					<Select
						class="settings-form__select"
						value={props.nullDisplay}
						onChange={(v) => props.setNullDisplay(v as NullDisplay)}
						options={[
							{ value: 'NULL', label: 'NULL' },
							{ value: '(empty)', label: '(empty)' },
							{ value: '\u2205', label: '\u2205 (empty set)' },
						]}
					/>
				</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Boolean</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Display format</label>
					<Select
						class="settings-form__select"
						value={props.booleanDisplay}
						onChange={(v) => props.setBooleanDisplay(v as BooleanDisplay)}
						options={[
							{ value: 'true/false', label: 'true / false' },
							{ value: '1/0', label: '1 / 0' },
							{ value: 'yes/no', label: 'yes / no' },
							{ value: '\u2713/\u2717', label: '\u2713 / \u2717 (check/cross)' },
						]}
					/>
				</div>
			</div>

			<div class="settings-form__section">
				<h4 class="settings-form__section-title">Binary Data</h4>
				<div class="settings-form__field settings-form__field--inline">
					<label class="settings-form__label">Display format</label>
					<Select
						class="settings-form__select"
						value={props.binaryDisplay}
						onChange={(v) => props.setBinaryDisplay(v as BinaryDisplay)}
						options={[
							{ value: 'size', label: '(binary N bytes)' },
							{ value: 'hex', label: 'Hex' },
							{ value: 'base64', label: 'Base64' },
						]}
					/>
				</div>
			</div>
		</div>
	)
}
