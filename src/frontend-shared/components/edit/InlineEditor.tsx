import { createSignal, onMount } from 'solid-js'
import { DatabaseDataType, isSqlDefault, SQL_DEFAULT } from '../../../shared/types/database'
import type { GridColumnDef } from '../../../shared/types/grid'
import { isBooleanType, isDateType, isNumericType, isTextType } from '../../lib/column-types'
import { isQuickValueModifier } from '../../lib/keyboard'
import './InlineEditor.css'

interface InlineEditorProps {
	value: unknown
	column: GridColumnDef
	width: number
	onSave: (value: unknown) => void
	onCancel: () => void
	onMoveNext: () => void
	onMoveDown: () => void
}

function valueToString(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (isSqlDefault(value)) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

function parseValue(text: string, column: GridColumnDef): unknown {
	if (text === '') return column.nullable ? null : text

	if (isNumericType(column.dataType)) {
		const n = Number(text)
		return Number.isNaN(n) ? text : n
	}

	if (isBooleanType(column.dataType)) {
		const lower = text.toLowerCase()
		if (lower === 'true' || lower === '1' || lower === 't') return true
		if (lower === 'false' || lower === '0' || lower === 'f') return false
		return text
	}

	return text
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

	const dataType = () => props.column.dataType
	const isBool = () => isBooleanType(dataType())
	const isDate = () => isDateType(dataType())
	const isNum = () => isNumericType(dataType())
	const isText = () => isTextType(dataType())

	onMount(() => {
		if (inputRef) {
			inputRef.focus()
			if ('select' in inputRef) {
				inputRef.select()
			}
		}
	})

	function save() {
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
					<button class="inline-editor__null-btn" onClick={handleSetNull} title="Set NULL">
						NULL
					</button>
				)}
			</div>
		)
	}

	if (isDate()) {
		const inputType = dataType().toLowerCase() === 'date' ? 'date' : 'datetime-local'
		return (
			<div
				class="inline-editor inline-editor--date"
				style={{ width: `${props.width}px` }}
				onKeyDown={handleKeyDown}
			>
				<input
					ref={(el) => {
						inputRef = el
					}}
					type={inputType}
					value={dateInputValue()}
					onBlur={() => save()}
				/>
				{props.column.nullable && (
					<button class="inline-editor__null-btn" onClick={handleSetNull} title="Set NULL">
						NULL
					</button>
				)}
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
					<button class="inline-editor__null-btn" onClick={handleSetNull} title="Set NULL">
						NULL
					</button>
				)}
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
					<button class="inline-editor__null-btn" onClick={handleSetNull} title="Set NULL">
						NULL
					</button>
				)}
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
				<button class="inline-editor__null-btn" onClick={handleSetNull} title="Set NULL">
					NULL
				</button>
			)}
		</div>
	)
}
