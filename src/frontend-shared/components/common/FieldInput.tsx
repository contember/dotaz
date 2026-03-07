import { Show } from 'solid-js'
import { DatabaseDataType } from '../../../shared/types/database'
import type { GridColumnDef } from '../../../shared/types/grid'
import { isBooleanType, isDateType, isNumericType, isTextType } from '../../../shared/column-types'
import { dateInputValue, parseValue, valueToString } from '../../lib/value-format'
import DateInput from './DateInput'

export interface FieldInputProps {
	column: GridColumnDef
	value: unknown
	onChange: (value: unknown) => void
	readOnly?: boolean
	isNull?: boolean
	isDefault?: boolean
	placeholder?: string
	onKeyDown?: (e: KeyboardEvent) => void
	prettyJson?: boolean
	class?: string
}

export default function FieldInput(props: FieldInputProps) {
	if (isBooleanType(props.column.dataType)) {
		return (
			<div class="row-detail__checkbox-row" onKeyDown={(e) => props.onKeyDown?.(e)}>
				<input
					type="checkbox"
					checked={!!props.value && !props.isNull && !props.isDefault}
					disabled={props.readOnly}
					onChange={(e) => props.onChange(e.target.checked)}
				/>
				<span style={{ 'font-size': 'var(--font-size-sm)', color: 'var(--ink-secondary)' }}>
					{props.isDefault ? 'DEFAULT' : props.isNull ? 'NULL' : props.value ? 'true' : 'false'}
				</span>
			</div>
		)
	}

	if (isDateType(props.column.dataType)) {
		return (
			<DateInput
				class="row-detail__input"
				value={props.isNull || props.isDefault ? '' : dateInputValue(props.value, props.column.dataType)}
				onChange={(v) => {
					if (v === '') {
						if (props.column.nullable) props.onChange(null)
					} else {
						props.onChange(v)
					}
				}}
				mode={props.column.dataType === DatabaseDataType.Date ? 'date' : 'datetime'}
				readOnly={props.readOnly}
				placeholder={props.placeholder}
				onKeyDown={(e) => props.onKeyDown?.(e)}
			/>
		)
	}

	if (isTextType(props.column.dataType)) {
		return (
			<>
				<Show when={(props.isNull || props.isDefault) && props.readOnly}>
					<input
						class="row-detail__input row-detail__input--null"
						type="text"
						value={props.isDefault ? 'DEFAULT' : 'NULL'}
						readOnly
					/>
				</Show>
				<Show when={!((props.isNull || props.isDefault) && props.readOnly)}>
					<textarea
						class={`row-detail__textarea${props.class ? ` ${props.class}` : ''}`}
						classList={{
							'row-detail__input--null': props.isNull,
							'row-detail__input--default': props.isDefault,
						}}
						value={props.isNull || props.isDefault ? '' : valueToString(props.value, props.prettyJson)}
						readOnly={props.readOnly}
						placeholder={props.placeholder}
						onKeyDown={(e) => props.onKeyDown?.(e)}
						onInput={(e) => props.onChange(parseValue(e.target.value, props.column))}
					/>
				</Show>
			</>
		)
	}

	return (
		<input
			class="row-detail__input"
			classList={{
				'row-detail__input--null': props.isNull,
				'row-detail__input--default': props.isDefault,
			}}
			type="text"
			inputMode={isNumericType(props.column.dataType) ? 'numeric' : undefined}
			value={props.isNull || props.isDefault ? '' : valueToString(props.value, props.prettyJson)}
			readOnly={props.readOnly}
			placeholder={props.placeholder}
			onKeyDown={(e) => props.onKeyDown?.(e)}
			onInput={(e) => props.onChange(parseValue(e.target.value, props.column))}
		/>
	)
}
