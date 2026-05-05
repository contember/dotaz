import { isBooleanType, isDateType, isNumericType, isStructuredType, isTextType } from '@dotaz/shared/column-types'
import { DatabaseDataType } from '@dotaz/shared/types/database'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import { createEffect, createSignal, on, Show } from 'solid-js'
import { dateInputValue, formatColumnValueForEditor, parseJsonColumnInput, parseValue, valueToString } from '../../lib/value-format'
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
	/** Reports JSON parse errors to the form so save can be blocked. */
	onError?: (error: string | null) => void
}

export default function FieldInput(props: FieldInputProps) {
	if (isStructuredType(props.column.dataType)) {
		return <JsonField {...props} />
	}

	const formatForInput = () =>
		props.isNull || props.isDefault
			? ''
			: valueToString(props.value, props.prettyJson)

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
						value={formatForInput()}
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
			value={formatForInput()}
			readOnly={props.readOnly}
			placeholder={props.placeholder}
			onKeyDown={(e) => props.onKeyDown?.(e)}
			onInput={(e) => props.onChange(parseValue(e.target.value, props.column))}
		/>
	)
}

/**
 * JSON column editor: textarea with auto-grow, parses on blur, surfaces errors.
 * Promotes the parsed JS value to the parent only when valid — never the raw
 * string, otherwise Bun.SQL would re-encode it and corrupt the JSONB cell.
 */
function JsonField(props: FieldInputProps) {
	const initial = () =>
		props.isNull || props.isDefault
			? ''
			: formatColumnValueForEditor(props.value, props.column.dataType)
	const [draft, setDraft] = createSignal(initial())
	const [error, setError] = createSignal<string | null>(null)

	// Re-sync the textarea when the underlying value/null/default state changes
	// from outside (row navigation, NULL button, etc.) — but not when the user
	// just committed; in that case the current draft already represents the new
	// value and overwriting it would clobber compact formatting with pretty.
	createEffect(on(
		() => [props.value, props.isNull, props.isDefault] as const,
		() => {
			const parsed = parseJsonColumnInput(draft(), props.column.nullable)
			if (parsed.ok && JSON.stringify(parsed.value) === JSON.stringify(props.value)) return
			setDraft(initial())
			setError(null)
			props.onError?.(null)
		},
		{ defer: true },
	))

	function autosize(el: HTMLTextAreaElement) {
		el.style.height = 'auto'
		el.style.height = `${Math.min(el.scrollHeight, 240)}px`
	}

	function commit() {
		const result = parseJsonColumnInput(draft(), props.column.nullable)
		if (!result.ok) {
			setError(result.error)
			props.onError?.(result.error)
			return
		}
		setError(null)
		props.onError?.(null)
		props.onChange(result.value)
	}

	return (
		<div class="row-detail__json-field">
			<textarea
				ref={(el) => queueMicrotask(() => autosize(el))}
				class={`row-detail__textarea${props.class ? ` ${props.class}` : ''}`}
				classList={{
					'row-detail__input--null': props.isNull,
					'row-detail__input--default': props.isDefault,
					'row-detail__input--error': error() !== null,
				}}
				value={draft()}
				readOnly={props.readOnly}
				placeholder={props.placeholder}
				spellcheck={false}
				onInput={(e) => {
					setDraft(e.currentTarget.value)
					autosize(e.currentTarget)
					if (error() !== null) {
						setError(null)
						props.onError?.(null)
					}
				}}
				onBlur={commit}
				onKeyDown={(e) => props.onKeyDown?.(e)}
			/>
			<Show when={error() !== null}>
				<div class="row-detail__field-error">{error()}</div>
			</Show>
		</div>
	)
}
