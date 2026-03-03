import X from 'lucide-solid/icons/x'
import { createEffect, createSignal, on, Show } from 'solid-js'
import { isSqlDefault, SQL_DEFAULT } from '../../../shared/types/database'
import type { GridColumnDef } from '../../../shared/types/grid'
import { getDataTypeLabel, isBooleanType, isJsonType } from '../../lib/column-types'
import Icon from '../common/Icon'
import Resizer from '../layout/Resizer'
import './ValueEditorPanel.css'

interface ValueEditorPanelProps {
	value: unknown
	column: GridColumnDef
	rowIndex: number
	width: number
	readOnly: boolean
	onSave: (value: unknown) => void
	onResize: (delta: number) => void
	onClose: () => void
}

/** Try to format a value as pretty-printed JSON. Returns null if not valid JSON. */
function tryFormatJson(value: unknown): string | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value, null, 2)
		} catch {
			return null
		}
	}
	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (
			(trimmed.startsWith('{') && trimmed.endsWith('}'))
			|| (trimmed.startsWith('[') && trimmed.endsWith(']'))
		) {
			try {
				const parsed = JSON.parse(trimmed)
				return JSON.stringify(parsed, null, 2)
			} catch {
				return null
			}
		}
	}
	return null
}

function displayValue(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (isSqlDefault(value)) return 'DEFAULT'
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

export default function ValueEditorPanel(props: ValueEditorPanelProps) {
	const [editValue, setEditValue] = createSignal('')
	const [isEditing, setIsEditing] = createSignal(false)
	const [wordWrap, setWordWrap] = createSignal(true)

	// Determine display mode based on column type and value
	const isJson = () => isJsonType(props.column.dataType) || tryFormatJson(props.value) !== null
	const isNull = () => props.value === null || props.value === undefined
	const isDefault = () => isSqlDefault(props.value)

	const formattedValue = () => {
		if (isNull()) return 'NULL'
		if (isDefault()) return 'DEFAULT'
		const jsonFormatted = tryFormatJson(props.value)
		if (jsonFormatted !== null) return jsonFormatted
		return displayValue(props.value)
	}

	// Reset editing state when cell changes
	createEffect(on(
		() => [props.rowIndex, props.column.name] as const,
		() => {
			setIsEditing(false)
		},
	))

	function startEditing() {
		if (props.readOnly) return
		if (isNull()) {
			setEditValue('')
		} else if (isDefault()) {
			setEditValue('')
		} else {
			const jsonFormatted = tryFormatJson(props.value)
			setEditValue(jsonFormatted ?? displayValue(props.value))
		}
		setIsEditing(true)
	}

	function handleSave() {
		const raw = editValue()

		// Try to parse as JSON if the column type is JSON
		if (isJsonType(props.column.dataType)) {
			try {
				const parsed = JSON.parse(raw)
				props.onSave(parsed)
				setIsEditing(false)
				return
			} catch {
				// Save as string if JSON parse fails
			}
		}

		// Boolean handling
		if (isBooleanType(props.column.dataType)) {
			const lower = raw.toLowerCase().trim()
			if (lower === 'true' || lower === '1' || lower === 't') {
				props.onSave(true)
				setIsEditing(false)
				return
			}
			if (lower === 'false' || lower === '0' || lower === 'f') {
				props.onSave(false)
				setIsEditing(false)
				return
			}
		}

		props.onSave(raw)
		setIsEditing(false)
	}

	function handleCancel() {
		setIsEditing(false)
	}

	function handleSetNull() {
		props.onSave(null)
		setIsEditing(false)
	}

	function handleSetDefault() {
		props.onSave(SQL_DEFAULT)
		setIsEditing(false)
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()
			handleCancel()
		}
		// Ctrl+Enter to save
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			handleSave()
		}
	}

	return (
		<>
			<Resizer onResize={(delta) => props.onResize(-delta)} />
			<div class="value-editor-panel" style={{ width: `${props.width}px` }}>
				<div class="value-editor-panel__header">
					<div class="value-editor-panel__title">
						<span class="value-editor-panel__column-name">{props.column.name}</span>
						<span class="value-editor-panel__type-badge">
							{getDataTypeLabel(props.column.dataType)}
						</span>
					</div>
					<div class="value-editor-panel__header-actions">
						<button
							class="value-editor-panel__wrap-btn"
							classList={{ 'value-editor-panel__wrap-btn--active': wordWrap() }}
							onClick={() => setWordWrap((w) => !w)}
							title="Toggle word wrap"
						>
							Wrap
						</button>
						<button
							class="value-editor-panel__close-btn"
							onClick={props.onClose}
							title="Close panel"
						>
							<X size={14} />
						</button>
					</div>
				</div>

				<div class="value-editor-panel__content">
					<Show
						when={isEditing()}
						fallback={
							<div class="value-editor-panel__display-area">
								<pre
									class="value-editor-panel__value"
									classList={{
										'value-editor-panel__value--null': isNull(),
										'value-editor-panel__value--json': isJson() && !isNull(),
										'value-editor-panel__value--wrap': wordWrap(),
									}}
								>
									{formattedValue()}
								</pre>
								<Show when={!props.readOnly}>
									<div class="value-editor-panel__edit-actions">
										<button
											class="value-editor-panel__action-btn"
											onClick={startEditing}
										>
											<Icon name="edit" size={12} /> Edit
										</button>
										<button
											class="value-editor-panel__action-btn"
											onClick={handleSetNull}
											title="Set to NULL"
										>
											NULL
										</button>
										<button
											class="value-editor-panel__action-btn"
											onClick={handleSetDefault}
											title="Set to DEFAULT"
										>
											DEFAULT
										</button>
									</div>
								</Show>
							</div>
						}
					>
						<div class="value-editor-panel__editor-area">
							<textarea
								class="value-editor-panel__textarea"
								classList={{ 'value-editor-panel__textarea--wrap': wordWrap() }}
								value={editValue()}
								onInput={(e) => setEditValue(e.currentTarget.value)}
								onKeyDown={handleKeyDown}
								autofocus
								spellcheck={false}
							/>
							<div class="value-editor-panel__editor-actions">
								<button
									class="value-editor-panel__save-btn"
									onClick={handleSave}
									title="Save (Ctrl+Enter)"
								>
									Save
								</button>
								<button
									class="value-editor-panel__cancel-btn"
									onClick={handleCancel}
								>
									Cancel
								</button>
								<button
									class="value-editor-panel__action-btn"
									onClick={handleSetNull}
									title="Set to NULL"
								>
									NULL
								</button>
								<button
									class="value-editor-panel__action-btn"
									onClick={handleSetDefault}
									title="Set to DEFAULT"
								>
									DEFAULT
								</button>
							</div>
						</div>
					</Show>
				</div>

				<div class="value-editor-panel__footer">
					<span class="value-editor-panel__info">
						Row {props.rowIndex + 1}
						<Show when={!isNull() && !isDefault()}>
							{' '}&middot; {typeof props.value === 'string' ? `${props.value.length} chars` : typeof props.value}
						</Show>
					</span>
				</div>
			</div>
		</>
	)
}
