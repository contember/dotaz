import { createSignal, For, Show } from 'solid-js'
import { DatabaseDataType, SQL_DEFAULT } from '../../../shared/types/database'
import type { GridColumnDef } from '../../../shared/types/grid'
import { isBooleanType, isDateType, isNumericType, isTextType } from '../../lib/column-types'
import type { FkTarget } from '../../stores/grid'
import { gridStore } from '../../stores/grid'
import DateInput from '../common/DateInput'
import Dialog from '../common/Dialog'
import Select from '../common/Select'
import FkPickerModal from '../edit/FkPickerModal'
import './BatchEditDialog.css'

interface BatchEditDialogProps {
	open: boolean
	tabId: string
	columns: GridColumnDef[]
	selectedRows: Set<number>
	fkMap?: Map<string, FkTarget>
	connectionId?: string
	database?: string
	onClose: () => void
}

type FieldMode = 'keep' | 'set' | 'null' | 'default' | 'now' | 'inc' | 'dec'

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
	if (value === null || value === undefined) return ''
	const str = String(value)
	if (dataType === DatabaseDataType.Date) {
		return str.substring(0, 10)
	}
	const d = new Date(str)
	if (Number.isNaN(d.getTime())) return str
	return d.toISOString().substring(0, 19)
}

function getModesForColumn(col: GridColumnDef): FieldMode[] {
	if (col.isPrimaryKey) return ['keep']

	const modes: FieldMode[] = ['keep', 'set']
	if (col.nullable) modes.push('null')
	if (isDateType(col.dataType)) modes.push('now')
	if (isNumericType(col.dataType)) modes.push('inc', 'dec')
	modes.push('default')
	return modes
}

function modeLabel(mode: FieldMode): string {
	switch (mode) {
		case 'keep':
			return 'Keep'
		case 'set':
			return 'Set'
		case 'null':
			return 'NULL'
		case 'default':
			return 'DEFAULT'
		case 'now':
			return 'NOW'
		case 'inc':
			return '+ Inc'
		case 'dec':
			return '− Dec'
	}
}

export default function BatchEditDialog(props: BatchEditDialogProps) {
	const [modes, setModes] = createSignal<Record<string, FieldMode>>({})
	const [values, setValues] = createSignal<Record<string, unknown>>({})
	const [pickerCol, setPickerCol] = createSignal<string | null>(null)

	const getMode = (col: string): FieldMode => modes()[col] ?? 'keep'

	function setMode(col: string, mode: FieldMode) {
		setModes((prev) => ({ ...prev, [col]: mode }))
	}

	function setValue(col: string, value: unknown) {
		setValues((prev) => ({ ...prev, [col]: value }))
	}

	const activeRowCount = () => {
		let count = 0
		for (const rowIndex of props.selectedRows) {
			if (!gridStore.isRowDeleted(props.tabId, rowIndex)) {
				count++
			}
		}
		return count
	}

	const changedColumnCount = () => {
		let count = 0
		for (const col of props.columns) {
			if (getMode(col.name) !== 'keep') count++
		}
		return count
	}

	function handleApply() {
		const tab = gridStore.getTab(props.tabId)

		for (const col of props.columns) {
			const mode = getMode(col.name)
			if (mode === 'keep') continue

			const delta = (mode === 'inc' || mode === 'dec')
				? Number(values()[col.name] ?? 1)
				: 0

			for (const rowIndex of props.selectedRows) {
				if (gridStore.isRowDeleted(props.tabId, rowIndex)) continue

				let finalValue: unknown
				switch (mode) {
					case 'set':
						finalValue = parseValue(String(values()[col.name] ?? ''), col)
						break
					case 'null':
						finalValue = null
						break
					case 'default':
						finalValue = SQL_DEFAULT
						break
					case 'now':
						finalValue = new Date().toISOString()
						break
					case 'inc':
					case 'dec': {
						const current = Number(tab?.rows[rowIndex]?.[col.name] ?? 0)
						finalValue = mode === 'inc' ? current + delta : current - delta
						break
					}
				}
				gridStore.setCellValue(props.tabId, rowIndex, col.name, finalValue)
			}
		}

		props.onClose()
	}

	function renderInput(col: GridColumnDef) {
		const value = () => values()[col.name]

		if (isBooleanType(col.dataType)) {
			return (
				<div class="row-detail__checkbox-row">
					<input
						type="checkbox"
						checked={!!value()}
						onChange={(e) => setValue(col.name, e.target.checked)}
					/>
					<span style={{ 'font-size': 'var(--font-size-sm)', color: 'var(--ink-secondary)' }}>
						{value() ? 'true' : 'false'}
					</span>
				</div>
			)
		}

		if (isDateType(col.dataType)) {
			return (
				<DateInput
					class="row-detail__input"
					value={value() != null ? dateInputValue(value(), col.dataType) : ''}
					onChange={(v) => {
						if (v === '') {
							if (col.nullable) setValue(col.name, null)
						} else {
							setValue(col.name, v)
						}
					}}
					mode={col.dataType === DatabaseDataType.Date ? 'date' : 'datetime'}
				/>
			)
		}

		if (isTextType(col.dataType)) {
			return (
				<textarea
					class="row-detail__textarea batch-edit__textarea"
					value={value() != null ? String(value()) : ''}
					placeholder="Enter value..."
					onInput={(e) => setValue(col.name, parseValue(e.target.value, col))}
				/>
			)
		}

		return (
			<input
				class="row-detail__input"
				type="text"
				inputMode={isNumericType(col.dataType) ? 'numeric' : undefined}
				value={value() != null ? String(value()) : ''}
				placeholder="Enter value..."
				onInput={(e) => setValue(col.name, parseValue(e.target.value, col))}
			/>
		)
	}

	return (
		<>
			<Dialog
				open={props.open}
				title="Batch Edit"
				onClose={props.onClose}
			>
				<div class="batch-edit">
					<div class="batch-edit__fields">
						<For each={props.columns}>
							{(col) => {
								const availableModes = getModesForColumn(col)
								const isPk = col.isPrimaryKey
								const mode = () => getMode(col.name)

								return (
									<div
										class="batch-edit__row"
										classList={{ 'batch-edit__row--active': mode() !== 'keep' }}
									>
										<div class="batch-edit__col-info">
											<span class="batch-edit__col-name">{col.name}</span>
											<span class="batch-edit__col-type">{col.dataType}</span>
											<Show when={isPk}>
												<span class="batch-edit__badge batch-edit__badge--pk">PK</span>
											</Show>
										</div>
										<div class="batch-edit__col-controls">
											<Select
												class="batch-edit__mode-select"
												value={mode()}
												disabled={isPk}
												onChange={(v) => setMode(col.name, v as FieldMode)}
												options={availableModes.map((m) => ({ value: m, label: modeLabel(m) }))}
											/>
											<Show when={mode() === 'set'}>
												<div class="batch-edit__input-wrap">
													{renderInput(col)}
													<Show when={props.fkMap?.has(col.name) && props.connectionId}>
														{(_) => {
															const fkTarget = props.fkMap!.get(col.name)!
															return (
																<button
																	class="batch-edit__browse-btn"
																	onClick={() => setPickerCol(col.name)}
																	title={`Browse ${fkTarget.table}`}
																>
																	...
																</button>
															)
														}}
													</Show>
												</div>
											</Show>
											<Show when={mode() === 'inc' || mode() === 'dec'}>
												<div class="batch-edit__input-wrap">
													<input
														class="row-detail__input"
														type="text"
														inputMode="numeric"
														value={values()[col.name] != null ? String(values()[col.name]) : ''}
														placeholder="1"
														onInput={(e) => {
															const n = Number(e.target.value)
															setValue(col.name, Number.isNaN(n) ? 0 : n)
														}}
													/>
												</div>
											</Show>
										</div>
									</div>
								)
							}}
						</For>
					</div>

					<div class="batch-edit__footer">
						<span class="batch-edit__info">
							Will update {activeRowCount()} row{activeRowCount() !== 1 ? 's' : ''}
							<Show when={changedColumnCount() > 0}>
								{' '}across {changedColumnCount()} column{changedColumnCount() !== 1 ? 's' : ''}
							</Show>
						</span>
						<div class="batch-edit__actions">
							<button class="btn btn--secondary" onClick={props.onClose}>
								Cancel
							</button>
							<button
								class="btn btn--primary"
								onClick={handleApply}
								disabled={activeRowCount() === 0 || changedColumnCount() === 0}
							>
								Apply
							</button>
						</div>
					</div>
				</div>
			</Dialog>

			<Show when={pickerCol() !== null && props.connectionId}>
				{(_) => {
					const col = pickerCol()!
					const target = props.fkMap?.get(col)
					if (!target) return null
					return (
						<FkPickerModal
							open={true}
							onClose={() => setPickerCol(null)}
							onSelect={(value) => {
								setValue(col, value)
								setPickerCol(null)
							}}
							connectionId={props.connectionId!}
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
