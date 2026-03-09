import { isBooleanType } from '@dotaz/shared/column-types'
import { isSqlDefault, SQL_DEFAULT } from '@dotaz/shared/types/database'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import Search from 'lucide-solid/icons/search'
import { createSignal, For, Show } from 'solid-js'
import { isQuickValueModifier, quickValueModifierLabel } from '../../lib/keyboard'
import FieldInput from '../common/FieldInput'
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

export default function RowDetailEditFields(props: RowDetailEditFieldsProps) {
	const [pickerCol, setPickerCol] = createSignal<string | null>(null)

	const isFieldNull = (col: string) => {
		const v = props.getValue(col)
		return v === null || v === undefined
	}
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
				<FieldInput
					column={col}
					value={value}
					onChange={(v) => props.setFieldValue(col.name, v)}
					readOnly={readOnly}
					isNull={isNull}
					isDefault={isDef}
					onKeyDown={(e) => handleFieldKeyDown(e, col)}
				/>
			)
		}

		return (
			<div class="row-detail__input-row">
				<FieldInput
					column={col}
					value={value}
					onChange={(v) => props.setFieldValue(col.name, v)}
					readOnly={readOnly}
					isNull={isNull}
					isDefault={isDef}
					placeholder={specialPlaceholder}
					onKeyDown={(e) => handleFieldKeyDown(e, col)}
					prettyJson
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
