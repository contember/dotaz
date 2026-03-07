import Search from 'lucide-solid/icons/search'
import { createSignal, For, Show } from 'solid-js'
import { DatabaseDataType, isSqlDefault, SQL_DEFAULT } from '../../../shared/types/database'
import type { GridColumnDef } from '../../../shared/types/grid'
import { isBooleanType, isDateType, isNumericType, isTextType } from '../../lib/column-types'
import { isQuickValueModifier, quickValueModifierLabel } from '../../lib/keyboard'
import DateInput from '../common/DateInput'
import FkPickerModal from './FkPickerModal'

export interface RowDetailEditFieldsProps {
	columns: GridColumnDef[]
	fkLookup: Map<string, { schema: string; table: string; column: string }>
	pkColumns: Set<string>
	getValue: (col: string) => unknown
	isChanged: (col: string) => boolean
	setFieldValue: (col: string, value: unknown) => void
	connectionId: string
	database?: string
}

function valueToString(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (isSqlDefault(value)) return ''
	if (typeof value === 'object') return JSON.stringify(value, null, 2)
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

function dateInputValue(value: unknown, dataType: DatabaseDataType): string {
	if (value === null || value === undefined || isSqlDefault(value)) return ''
	const str = String(value)
	if (dataType === DatabaseDataType.Date) return str.substring(0, 10)
	const d = new Date(str)
	if (Number.isNaN(d.getTime())) return str
	return d.toISOString().substring(0, 19)
}

export default function RowDetailEditFields(props: RowDetailEditFieldsProps) {
	const [pickerCol, setPickerCol] = createSignal<string | null>(null)

	const isFieldNull = (col: string) => { const v = props.getValue(col); return v === null || v === undefined }
	const isFieldDefault = (col: string) => isSqlDefault(props.getValue(col))
	const setNull = (col: string) => props.setFieldValue(col, null)
	const setDefault = (col: string) => props.setFieldValue(col, SQL_DEFAULT)

	function handleFieldKeyDown(e: KeyboardEvent, col: GridColumnDef) {
		if (!isQuickValueModifier(e)) return
		const key = e.key.toLowerCase()
		if (props.pkColumns.has(col.name)) return
		if (key === 'n' && col.nullable) {
			e.preventDefault()
			setNull(col.name)
		} else if (key === 't' && isBooleanType(col.dataType)) {
			e.preventDefault()
			props.setFieldValue(col.name, true)
		} else if (key === 'f' && isBooleanType(col.dataType)) {
			e.preventDefault()
			props.setFieldValue(col.name, false)
		} else if (key === 'd') {
			e.preventDefault()
			setDefault(col.name)
		}
	}

	function renderFieldInput(col: GridColumnDef) {
		const isPk = props.pkColumns.has(col.name)
		const readOnly = isPk
		const value = props.getValue(col.name)
		const isNull = isFieldNull(col.name)
		const isDef = isFieldDefault(col.name)
		const specialPlaceholder = isDef ? 'DEFAULT' : isNull ? 'NULL' : ''

		if (isBooleanType(col.dataType)) {
			return (
				<div class="row-detail__checkbox-row" onKeyDown={(e) => handleFieldKeyDown(e, col)}>
					<input
						type="checkbox"
						checked={!!value && !isNull && !isDef}
						disabled={readOnly}
						onChange={(e) => props.setFieldValue(col.name, e.target.checked)}
					/>
					<span style={{ 'font-size': 'var(--font-size-sm)', color: 'var(--ink-secondary)' }}>
						{isDef ? 'DEFAULT' : isNull ? 'NULL' : value ? 'true' : 'false'}
					</span>
				</div>
			)
		}

		if (isDateType(col.dataType)) {
			return (
				<div class="row-detail__input-row">
					<DateInput
						class="row-detail__input"
						value={isNull || isDef ? '' : dateInputValue(value, col.dataType)}
						onChange={(v) => {
							if (v === '') {
								if (col.nullable) props.setFieldValue(col.name, null)
							} else {
								props.setFieldValue(col.name, v)
							}
						}}
						mode={col.dataType === DatabaseDataType.Date ? 'date' : 'datetime'}
						readOnly={readOnly}
						placeholder={specialPlaceholder}
						onKeyDown={(e) => handleFieldKeyDown(e, col)}
					/>
				</div>
			)
		}

		if (isTextType(col.dataType)) {
			return (
				<div class="row-detail__input-row">
					<Show when={(isNull || isDef) && readOnly}>
						<input
							class="row-detail__input row-detail__input--null"
							type="text"
							value={isDef ? 'DEFAULT' : 'NULL'}
							readOnly
						/>
					</Show>
					<Show when={!((isNull || isDef) && readOnly)}>
						<textarea
							class="row-detail__textarea"
							classList={{
								'row-detail__input--null': isNull,
								'row-detail__input--default': isDef,
							}}
							value={isNull || isDef ? '' : valueToString(value)}
							readOnly={readOnly}
							placeholder={specialPlaceholder}
							onKeyDown={(e) => handleFieldKeyDown(e, col)}
							onInput={(e) => props.setFieldValue(col.name, parseValue(e.target.value, col))}
						/>
					</Show>
				</div>
			)
		}

		return (
			<div class="row-detail__input-row">
				<input
					class="row-detail__input"
					classList={{
						'row-detail__input--null': isNull,
						'row-detail__input--default': isDef,
					}}
					type="text"
					inputMode={isNumericType(col.dataType) ? 'numeric' : undefined}
					value={isNull || isDef ? '' : valueToString(value)}
					readOnly={readOnly}
					placeholder={specialPlaceholder}
					onKeyDown={(e) => handleFieldKeyDown(e, col)}
					onInput={(e) => props.setFieldValue(col.name, parseValue(e.target.value, col))}
				/>
			</div>
		)
	}

	return (
		<>
			<For each={props.columns}>
				{(col) => {
					const fk = () => props.fkLookup.get(col.name)
					return (
						<div
							class="row-detail__field"
							classList={{ 'row-detail__field--changed': props.isChanged(col.name) }}
						>
							<div class="row-detail__label">
								<span class="row-detail__label-name">{col.name}</span>
								<span class="row-detail__label-type">{col.dataType}</span>
								<Show when={col.isPrimaryKey}>
									<span class="row-detail__label-badge row-detail__label-badge--pk">PK</span>
								</Show>
								<Show when={fk()}>
									<span class="row-detail__label-badge row-detail__label-badge--fk">FK</span>
								</Show>
								<Show when={!props.pkColumns.has(col.name)}>
									<div class="row-detail__label-actions">
										<Show when={col.nullable}>
											<button
												class="row-detail__set-btn"
												classList={{ 'row-detail__set-btn--active': isFieldNull(col.name) }}
												onClick={() => setNull(col.name)}
												title={`Set NULL (${quickValueModifierLabel()}+N)`}
											>
												NULL
											</button>
										</Show>
										<button
											class="row-detail__set-btn"
											classList={{ 'row-detail__set-btn--active': isFieldDefault(col.name) }}
											onClick={() => setDefault(col.name)}
											title={`Set DEFAULT (${quickValueModifierLabel()}+D)`}
										>
											DEF
										</button>
										<Show when={props.fkLookup.has(col.name)}>
											<button
												class="row-detail__set-btn"
												onClick={() => setPickerCol(col.name)}
												title={`Browse ${props.fkLookup.get(col.name)?.table}`}
											>
												<Search size={10} />
											</button>
										</Show>
									</div>
								</Show>
							</div>
							<Show when={fk()}>
								{(fkTarget) => (
									<span class="row-detail__fk-target">
										&#x2192; {fkTarget().table}.{fkTarget().column}
									</span>
								)}
							</Show>
							{renderFieldInput(col)}
						</div>
					)
				}}
			</For>

			<Show when={pickerCol() !== null}>
				{(_) => {
					const col = pickerCol()!
					const target = props.fkLookup.get(col)
					if (!target) return null
					return (
						<FkPickerModal
							open={true}
							onClose={() => setPickerCol(null)}
							onSelect={(value) => {
								props.setFieldValue(col, value)
								setPickerCol(null)
							}}
							connectionId={props.connectionId}
							schema={target.schema}
							table={target.table}
							column={target.column}
							database={props.database}
						/>
					)
				}}
			</Show>
		</>
	)
}
