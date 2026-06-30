import { isBooleanType, isDateType, isNumericType, isStructuredType, isTextType } from '@dotaz/shared/column-types'
import { DatabaseDataType, isSqlDefault, SQL_DEFAULT } from '@dotaz/shared/types/database'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import Search from 'lucide-solid/icons/search'
import { createSignal, onMount, Show } from 'solid-js'
import { isQuickValueModifier } from '../../lib/keyboard'
import { formatColumnValueForEditor, parseJsonColumnInput, parseValue, valueToString } from '../../lib/value-format'
import type { FkTarget } from '../../stores/grid'
import DateInput from '../common/DateInput'
import './InlineEditor.css'

interface InlineEditorProps {
	value: unknown
	initialValue?: unknown
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
	isFreeformColumn: boolean,
	onSave: (value: unknown) => void,
): boolean {
	const key = e.key.toLowerCase()
	const isCtrl = isQuickValueModifier(e)
	// Single-key shortcuts only trigger when modifier is held OR the input is
	// empty AND it isn't a column where the letter is a legitimate first keystroke
	// (text columns, JSON/array columns where `{` `[` `"` `t` `n` `f` `d` are valid).
	const allowSingleKey = isCtrl || (inputEmpty && !isFreeformColumn)

	if (key === 'n' && column.nullable && allowSingleKey) {
		e.preventDefault()
		e.stopPropagation()
		onSave(null)
		return true
	}

	if (key === 't' && isBooleanType(column.dataType) && (isCtrl || inputEmpty)) {
		e.preventDefault()
		e.stopPropagation()
		onSave(true)
		return true
	}

	if (key === 'f' && isBooleanType(column.dataType) && (isCtrl || inputEmpty)) {
		e.preventDefault()
		e.stopPropagation()
		onSave(false)
		return true
	}

	if (key === 'd' && allowSingleKey) {
		e.preventDefault()
		e.stopPropagation()
		onSave(SQL_DEFAULT)
		return true
	}

	return false
}

export default function InlineEditor(props: InlineEditorProps) {
	const editorValue = () => props.initialValue !== undefined ? props.initialValue : props.value
	const [isNull, setIsNull] = createSignal(
		editorValue() === null || editorValue() === undefined,
	)
	const [isDefault, setIsDefault] = createSignal(isSqlDefault(editorValue()))
	let inputRef: HTMLInputElement | HTMLTextAreaElement | undefined
	let cancelled = false

	const dataType = () => props.column.dataType
	const isBool = () => isBooleanType(dataType())
	const isDate = () => isDateType(dataType())
	const isNum = () => isNumericType(dataType())
	const isText = () => isTextType(dataType())
	const isJson = () => isStructuredType(dataType())
	const [jsonError, setJsonError] = createSignal<string | null>(null)

	const [dateValue, setDateValue] = createSignal(dateInputValue())

	onMount(() => {
		if (inputRef) {
			if (inputRef instanceof HTMLTextAreaElement) {
				inputRef.style.height = 'auto'
				inputRef.style.height = `${Math.min(inputRef.scrollHeight, 240)}px`
			}
			inputRef.focus()
			if (props.initialValue !== undefined && 'setSelectionRange' in inputRef) {
				const end = inputRef.value.length
				inputRef.setSelectionRange(end, end)
			} else if ('select' in inputRef) {
				inputRef.select()
			}
		}
	})

	function save(): boolean {
		if (cancelled) return true
		if (isNull()) {
			props.onSave(null)
			return true
		}
		if (isDefault()) {
			props.onSave(SQL_DEFAULT)
			return true
		}
		if (isBool()) {
			// Checkbox value is handled in handleCheckboxChange
			return true
		}
		if (isDate()) {
			const v = dateValue()
			const parsed = parseValue(v, props.column)
			props.onSave(parsed)
			return true
		}
		if (inputRef) {
			if (isJson()) {
				const result = parseJsonColumnInput(inputRef.value, props.column.nullable)
				if (!result.ok) {
					setJsonError(result.error)
					inputRef.focus()
					return false
				}
				setJsonError(null)
				props.onSave(result.value)
				return true
			}
			const parsed = parseValue(inputRef.value, props.column)
			props.onSave(parsed)
		}
		return true
	}

	function getInputEmpty(): boolean {
		if (isNull() || isDefault()) return true
		if (inputRef) return inputRef.value === ''
		return false
	}

	function handleKeyDown(e: KeyboardEvent) {
		// Try quick value shortcuts first. Skip single-key shortcuts when the
		// editor accepts free-form text (text columns, JSON/array columns) so
		// the user's first keystroke isn't swallowed.
		if (tryQuickValueShortcut(e, props.column, getInputEmpty(), isText() || isJson(), props.onSave)) {
			return
		}

		if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()
			cancelled = true
			props.onCancel()
			return
		}
		if (e.key === 'Tab') {
			e.preventDefault()
			e.stopPropagation()
			if (save()) props.onMoveNext()
			return
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			// In JSON mode plain Enter inserts a newline; require Ctrl/Cmd+Enter to commit.
			if (isJson() && !(e.ctrlKey || e.metaKey)) return
			e.preventDefault()
			e.stopPropagation()
			if (save()) props.onMoveDown()
		}
	}

	function handleCheckboxChange(e: Event) {
		const checked = (e.target as HTMLInputElement).checked
		props.onSave(checked)
	}

	function booleanChecked(): boolean {
		const value = editorValue()
		if (typeof value === 'boolean') return value
		if (typeof value === 'number') return value !== 0
		if (typeof value === 'string') {
			const lower = value.toLowerCase()
			if (lower === 'true' || lower === '1' || lower === 't') return true
			if (lower === 'false' || lower === '0' || lower === 'f') return false
		}
		return !!value
	}

	function handleSetNull() {
		setIsNull(true)
		setIsDefault(false)
		props.onSave(null)
	}

	function markUserInput() {
		setIsNull(false)
		setIsDefault(false)
	}

	function resizeTextArea() {
		if (!(inputRef instanceof HTMLTextAreaElement)) return
		inputRef.style.height = 'auto'
		inputRef.style.height = `${Math.min(inputRef.scrollHeight, isJson() ? 240 : 120)}px`
	}

	// Date formatting for input[type=date]/input[type=datetime-local]
	function dateInputValue(): string {
		const value = editorValue()
		if (isNull() || isDefault() || value === null || value === undefined) return ''
		const str = String(value)
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
					checked={booleanChecked() && !isNull() && !isDefault()}
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
						setIsDefault(false)
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
					value={isNull() || isDefault() ? '' : valueToString(editorValue())}
					onInput={markUserInput}
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
					value={isNull() || isDefault() ? '' : valueToString(editorValue())}
					onBlur={() => save()}
					rows={1}
					onInput={() => {
						markUserInput()
						resizeTextArea()
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

	if (isJson()) {
		return (
			<div
				class="inline-editor inline-editor--json"
				classList={{ 'inline-editor--json-error': jsonError() !== null }}
				style={{ width: `${props.width}px` }}
				onKeyDown={handleKeyDown}
			>
				<textarea
					ref={(el) => {
						inputRef = el
					}}
					value={isNull() || isDefault() ? '' : formatColumnValueForEditor(editorValue(), dataType())}
					onBlur={() => save()}
					onInput={() => {
						markUserInput()
						if (jsonError() !== null) setJsonError(null)
						resizeTextArea()
					}}
					rows={1}
					spellcheck={false}
					title={jsonError() ?? undefined}
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
				value={isNull() || isDefault() ? '' : valueToString(editorValue())}
				onInput={markUserInput}
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
