import { isBooleanType, isDateType, isNumericType, isTextType } from '@dotaz/shared/column-types'
import { DatabaseDataType, isSqlDefault, SQL_DEFAULT } from '@dotaz/shared/types/database'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import Search from 'lucide-solid/icons/search'
import { createSignal, onMount, Show } from 'solid-js'
import { isQuickValueModifier } from '../../lib/keyboard'
import { parseValue, valueToString } from '../../lib/value-format'
import type { FkTarget } from '../../stores/grid'
import DateInput from '../common/DateInput'
import './InlineEditor.css'

interface InlineEditorProps {
	value: unknown
	column: GridColumnDef
	width: number
	onSave: (value: unknown) => void
	onCancel: () => void
	onMoveNext: () => void
	onMoveDown: () => void
	fkTarget?: FkTarget
	onBrowseFk?: () => void
}

/**
 * Try to handle a quick value shortcut key.
 * Returns true if the shortcut was handled, false otherwise.
 *
 * Ctrl+key shortcuts always work.
 * Single-key shortcuts work when the input is empty (except for text columns
 * where single letters are valid input).
 */
function tryQuickValueShortcut(
	e: KeyboardEvent,
	column: GridColumnDef,
	inputEmpty: boolean,
	isTextColumn: boolean,
	onSave: (value: unknown) => void,
): boolean {
	const key = e.key.toLowerCase()
	const isCtrl = isQuickValueModifier(e)

	// Ctrl+N or 'n' when empty (non-text) → NULL
	if (key === 'n' && column.nullable && (isCtrl || (inputEmpty && !isTextColumn))) {
		e.preventDefault()
		e.stopPropagation()
		onSave(null)
		return true
	}

	// Ctrl+T or 't' when empty (non-text) → true (boolean only)
	if (key === 't' && isBooleanType(column.dataType) && (isCtrl || inputEmpty)) {
		e.preventDefault()
		e.stopPropagation()
		onSave(true)
		return true
	}

	// Ctrl+F or 'f' when empty (non-text) → false (boolean only)
	if (key === 'f' && isBooleanType(column.dataType) && (isCtrl || inputEmpty)) {
		e.preventDefault()
		e.stopPropagation()
		onSave(false)
		return true
	}

	// Ctrl+D or 'd' when empty (non-text) → DEFAULT
	if (key === 'd' && (isCtrl || (inputEmpty && !isTextColumn))) {
		e.preventDefault()
		e.stopPropagation()
		onSave(SQL_DEFAULT)
		return true
	}

	return false
}

export default function InlineEditor(props: InlineEditorProps) {
	const [isNull, setIsNull] = createSignal(
		props.value === null || props.value === undefined,
	)
	const [isDefault, setIsDefault] = createSignal(isSqlDefault(props.value))
	let inputRef: HTMLInputElement | HTMLTextAreaElement | undefined
	let cancelled = false

	const dataType = () => props.column.dataType
	const isBool = () => isBooleanType(dataType())
	const isDate = () => isDateType(dataType())
	const isNum = () => isNumericType(dataType())
	const isText = () => isTextType(dataType())

	const [dateValue, setDateValue] = createSignal(dateInputValue())

	onMount(() => {
		if (inputRef) {
			inputRef.focus()
			if ('select' in inputRef) {
				inputRef.select()
			}
		}
	})

	function save() {
		if (cancelled) return
		if (isNull()) {
			props.onSave(null)
			return
		}
		if (isDefault()) {
			props.onSave(SQL_DEFAULT)
			return
		}
		if (isBool()) {
			// Checkbox value is handled in handleCheckboxChange
			return
		}
		if (isDate()) {
			const v = dateValue()
			const parsed = parseValue(v, props.column)
			props.onSave(parsed)
			return
		}
		if (inputRef) {
			const parsed = parseValue(inputRef.value, props.column)
			props.onSave(parsed)
		}
	}

	function getInputEmpty(): boolean {
		if (isNull() || isDefault()) return true
		if (inputRef) return inputRef.value === ''
		return false
	}

	function handleKeyDown(e: KeyboardEvent) {
		// Try quick value shortcuts first
		if (tryQuickValueShortcut(e, props.column, getInputEmpty(), isText(), props.onSave)) {
			return
		}

		if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()
			cancelled = true
			props.onCancel()
		} else if (e.key === 'Tab') {
			e.preventDefault()
			e.stopPropagation()
			save()
			props.onMoveNext()
		} else if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			e.stopPropagation()
			save()
			props.onMoveDown()
		}
	}

	function handleCheckboxChange(e: Event) {
		const checked = (e.target as HTMLInputElement).checked
		props.onSave(checked)
	}

	function handleSetNull() {
		setIsNull(true)
		setIsDefault(false)
		props.onSave(null)
	}

	// Date formatting for input[type=date]/input[type=datetime-local]
	function dateInputValue(): string {
		if (isNull() || isDefault() || props.value === null || props.value === undefined) return ''
		const str = String(props.value)
		if (dataType() === DatabaseDataType.Date) {
			// Return YYYY-MM-DD
			return str.substring(0, 10)
		}
		// datetime-local expects YYYY-MM-DDTHH:mm:ss
		const d = new Date(str)
		if (Number.isNaN(d.getTime())) return str
		return d.toISOString().substring(0, 19)
	}

	const browseBtn = () => (
		<Show when={props.fkTarget && props.onBrowseFk}>
			<button
				class="inline-editor__browse-btn"
				onMouseDown={(e) => {
					e.preventDefault()
					e.stopPropagation()
				}}
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					props.onBrowseFk?.()
				}}
				title={`Browse ${props.fkTarget?.table}`}
				tabIndex={-1}
			>
				<Search size={10} />
			</button>
		</Show>
	)

	if (isBool()) {
		return (
			<div
				class="inline-editor inline-editor--boolean"
				style={{ width: `${props.width}px` }}
				onKeyDown={handleKeyDown}
				tabIndex={0}
			>
				<input
					ref={(el) => {
						inputRef = el
					}}
					type="checkbox"
					checked={!!props.value && !isNull() && !isDefault()}
					onChange={handleCheckboxChange}
				/>
				{props.column.nullable && (
					<button
						class="inline-editor__null-btn"
						onMouseDown={(e) => {
							e.preventDefault()
							e.stopPropagation()
						}}
						onClick={handleSetNull}
						title="Set NULL"
					>
						NULL
					</button>
				)}
				{browseBtn()}
			</div>
		)
	}

	if (isDate()) {
		return (
			<div
				class="inline-editor inline-editor--date"
				style={{ width: `${props.width}px` }}
				onKeyDown={handleKeyDown}
			>
				<DateInput
					value={dateInputValue()}
					onChange={(v) => {
						setDateValue(v)
						setIsNull(v === '')
					}}
					mode={dataType().toLowerCase() === 'date' ? 'date' : 'datetime'}
					onBlur={() => save()}
					onKeyDown={handleKeyDown}
				/>
				{props.column.nullable && (
					<button
						class="inline-editor__null-btn"
						onMouseDown={(e) => {
							e.preventDefault()
							e.stopPropagation()
						}}
						onClick={handleSetNull}
						title="Set NULL"
					>
						NULL
					</button>
				)}
				{browseBtn()}
			</div>
		)
	}

	if (isNum()) {
		return (
			<div
				class="inline-editor inline-editor--number"
				style={{ width: `${props.width}px` }}
				onKeyDown={handleKeyDown}
			>
				<input
					ref={(el) => {
						inputRef = el
					}}
					type="text"
					inputMode="numeric"
					value={isNull() || isDefault() ? '' : valueToString(props.value)}
					onBlur={() => save()}
				/>
				{props.column.nullable && (
					<button
						class="inline-editor__null-btn"
						onMouseDown={(e) => {
							e.preventDefault()
							e.stopPropagation()
						}}
						onClick={handleSetNull}
						title="Set NULL"
					>
						NULL
					</button>
				)}
				{browseBtn()}
			</div>
		)
	}

	// Default: text input (or textarea for text/varchar types)
	if (isText()) {
		return (
			<div
				class="inline-editor inline-editor--text"
				style={{ width: `${props.width}px` }}
				onKeyDown={handleKeyDown}
			>
				<textarea
					ref={(el) => {
						inputRef = el
					}}
					value={isNull() || isDefault() ? '' : valueToString(props.value)}
					onBlur={() => save()}
					rows={1}
					onInput={(e) => {
						const el = e.target as HTMLTextAreaElement
						el.style.height = 'auto'
						el.style.height = `${Math.min(el.scrollHeight, 120)}px`
					}}
				/>
				{props.column.nullable && (
					<button
						class="inline-editor__null-btn"
						onMouseDown={(e) => {
							e.preventDefault()
							e.stopPropagation()
						}}
						onClick={handleSetNull}
						title="Set NULL"
					>
						NULL
					</button>
				)}
				{browseBtn()}
			</div>
		)
	}

	// Generic fallback
	return (
		<div
			class="inline-editor"
			style={{ width: `${props.width}px` }}
			onKeyDown={handleKeyDown}
		>
			<input
				ref={(el) => {
					inputRef = el
				}}
				type="text"
				value={isNull() || isDefault() ? '' : valueToString(props.value)}
				onBlur={() => save()}
			/>
			{props.column.nullable && (
				<button
					class="inline-editor__null-btn"
					onMouseDown={(e) => {
						e.preventDefault()
						e.stopPropagation()
					}}
					onClick={handleSetNull}
					title="Set NULL"
				>
					NULL
				</button>
			)}
			{browseBtn()}
		</div>
	)
}
