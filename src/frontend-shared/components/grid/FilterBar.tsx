import FilterX from 'lucide-solid/icons/funnel-x'
import Plus from 'lucide-solid/icons/plus'
import X from 'lucide-solid/icons/x'
import { createSignal, For, Show } from 'solid-js'
import { getColumnCategory } from '@dotaz/shared/column-types'
import type { DatabaseDataType } from '@dotaz/shared/types/database'
import type { ColumnFilter, FilterOperator, GridColumnDef } from '@dotaz/shared/types/grid'
import Select from '../common/Select'
import './FilterBar.css'

interface FilterBarProps {
	columns: GridColumnDef[]
	filters: ColumnFilter[]
	customFilter: string
	onAddFilter: (filter: ColumnFilter) => void
	onUpdateFilter: (oldColumn: string, filter: ColumnFilter) => void
	onRemoveFilter: (column: string) => void
	onSetCustomFilter: (value: string) => void
	onClearAll: () => void
}

interface OperatorOption {
	value: FilterOperator
	label: string
}

const ALL_OPERATORS: OperatorOption[] = [
	{ value: 'eq', label: '=' },
	{ value: 'neq', label: '!=' },
	{ value: 'gt', label: '>' },
	{ value: 'gte', label: '>=' },
	{ value: 'lt', label: '<' },
	{ value: 'lte', label: '<=' },
	{ value: 'like', label: 'LIKE' },
	{ value: 'in', label: 'IN' },
	{ value: 'isNull', label: 'IS NULL' },
	{ value: 'isNotNull', label: 'IS NOT NULL' },
]

function getOperatorsForType(dataType: DatabaseDataType): OperatorOption[] {
	const category = getColumnCategory(dataType)
	switch (category) {
		case 'boolean':
			return ALL_OPERATORS.filter((o) => ['eq', 'neq', 'isNull', 'isNotNull'].includes(o.value))
		case 'number':
			return ALL_OPERATORS.filter((o) => o.value !== 'like')
		case 'text':
			return ALL_OPERATORS
		default:
			return ALL_OPERATORS
	}
}

function operatorNeedsValue(op: FilterOperator): boolean {
	return op !== 'isNull' && op !== 'isNotNull'
}

function formatFilterValue(filter: ColumnFilter): string {
	if (!operatorNeedsValue(filter.operator)) return ''
	if (filter.operator === 'in' && Array.isArray(filter.value)) {
		return (filter.value as unknown[]).join(', ')
	}
	return String(filter.value ?? '')
}

export default function FilterBar(props: FilterBarProps) {
	const [adding, setAdding] = createSignal(false)
	const [selectedColumn, setSelectedColumn] = createSignal('')
	const [selectedOperator, setSelectedOperator] = createSignal<FilterOperator>('eq')
	const [inputValue, setInputValue] = createSignal('')
	const [editingCustom, setEditingCustom] = createSignal(false)
	const [customInput, setCustomInput] = createSignal('')

	function availableColumns() {
		const filtered = new Set(props.filters.map((f) => f.column))
		return props.columns.filter((c) => !filtered.has(c.name))
	}

	function currentColumnDef(): GridColumnDef | undefined {
		return props.columns.find((c) => c.name === selectedColumn())
	}

	function currentOperators(): OperatorOption[] {
		const col = currentColumnDef()
		if (!col) return ALL_OPERATORS
		return getOperatorsForType(col.dataType)
	}

	function resetForm() {
		setSelectedColumn('')
		setSelectedOperator('eq')
		setInputValue('')
		setAdding(false)
	}

	function handleColumnChange(name: string) {
		setSelectedColumn(name)
		setInputValue('')
		const col = props.columns.find((c) => c.name === name)
		if (col) {
			const ops = getOperatorsForType(col.dataType)
			if (!ops.find((o) => o.value === selectedOperator())) {
				setSelectedOperator(ops[0].value)
			}
		}
	}

	function handleApply() {
		const col = selectedColumn()
		const op = selectedOperator()
		if (!col) return

		let value: unknown = null
		if (operatorNeedsValue(op)) {
			const raw = inputValue().trim()
			if (!raw) return
			if (op === 'in') {
				value = raw.split(',').map((v) => v.trim())
			} else {
				value = raw
			}
		}

		props.onAddFilter({ column: col, operator: op, value })
		resetForm()
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			handleApply()
		} else if (e.key === 'Escape') {
			resetForm()
		}
	}

	function startEditingCustom() {
		setCustomInput(props.customFilter)
		setEditingCustom(true)
	}

	function applyCustomFilter() {
		const val = customInput().trim()
		props.onSetCustomFilter(val)
		setEditingCustom(false)
	}

	function cancelCustomEdit() {
		setEditingCustom(false)
	}

	function handleCustomKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			applyCustomFilter()
		} else if (e.key === 'Escape') {
			cancelCustomEdit()
		}
	}

	const hasAnyFilter = () => props.filters.length > 0 || !!props.customFilter

	return (
		<div class="filter-bar">
			<div class="filter-bar__chips">
				<For each={props.filters}>
					{(filter) => {
						const colDef = () => props.columns.find((c) => c.name === filter.column)
						const operators = () => {
							const col = colDef()
							return col ? getOperatorsForType(col.dataType) : ALL_OPERATORS
						}
						const availableCols = () => {
							const used = new Set(props.filters.map((f) => f.column))
							return props.columns.filter((c) => c.name === filter.column || !used.has(c.name))
						}

						function handleChipValueKeyDown(e: KeyboardEvent) {
							if (e.key === 'Enter') {
								const raw = (e.currentTarget as HTMLInputElement).value.trim()
								if (!raw) return
								const value = filter.operator === 'in' ? raw.split(',').map((v) => v.trim()) : raw
								props.onAddFilter({ ...filter, value })
								;(e.currentTarget as HTMLInputElement).blur()
							}
						}

						return (
							<span class="filter-bar__chip">
								<Select
									class="filter-bar__chip-inline-select filter-bar__chip-col-select"
									value={filter.column}
									onChange={(v) => {
										const newCol = props.columns.find((c) => c.name === v)
										const newOps = newCol ? getOperatorsForType(newCol.dataType) : ALL_OPERATORS
										const op = newOps.find((o) => o.value === filter.operator)
											? filter.operator
											: newOps[0].value
										props.onUpdateFilter(filter.column, { ...filter, column: v, operator: op })
									}}
									options={availableCols().map((c) => ({ value: c.name, label: c.name }))}
								/>
								<Select
									class="filter-bar__chip-inline-select filter-bar__chip-op-select"
									value={filter.operator}
									onChange={(v) => props.onAddFilter({ ...filter, operator: v as FilterOperator })}
									options={operators().map((op) => ({ value: op.value, label: op.label }))}
								/>
								<Show when={operatorNeedsValue(filter.operator)}>
									<input
										class="filter-bar__chip-value-input"
										type="text"
										value={formatFilterValue(filter)}
										placeholder="value"
										onKeyDown={handleChipValueKeyDown}
										onBlur={(e) => {
											const raw = e.currentTarget.value.trim()
											if (raw === formatFilterValue(filter)) return
											if (!raw) return
											const value = filter.operator === 'in' ? raw.split(',').map((v) => v.trim()) : raw
											props.onAddFilter({ ...filter, value })
										}}
									/>
								</Show>
								<button
									class="filter-bar__chip-remove"
									onClick={() => props.onRemoveFilter(filter.column)}
									title="Remove filter"
								>
									<X size={12} />
								</button>
							</span>
						)
					}}
				</For>

				<Show when={props.customFilter && !editingCustom()}>
					<span class="filter-bar__chip filter-bar__chip--custom" onClick={startEditingCustom}>
						<span class="filter-bar__chip-op">WHERE</span>
						<span class="filter-bar__chip-val filter-bar__chip-val--custom">{props.customFilter}</span>
						<button
							class="filter-bar__chip-remove"
							onClick={(e) => {
								e.stopPropagation()
								props.onSetCustomFilter('')
							}}
							title="Remove custom filter"
						>
							<X size={12} />
						</button>
					</span>
				</Show>

				<Show when={hasAnyFilter() && (props.filters.length + (props.customFilter ? 1 : 0)) > 1}>
					<button class="filter-bar__clear-all" onClick={props.onClearAll}>
						<FilterX size={12} /> Clear All
					</button>
				</Show>
			</div>

			<Show when={editingCustom()}>
				<div class="filter-bar__form">
					<span class="filter-bar__custom-label">WHERE</span>
					<input
						class="filter-bar__input filter-bar__input--custom"
						type="text"
						placeholder="e.g. age > 18 AND name LIKE 'J%'"
						value={customInput()}
						onInput={(e) => setCustomInput(e.currentTarget.value)}
						onKeyDown={handleCustomKeyDown}
						ref={(el) => setTimeout(() => el.focus())}
					/>
					<button
						class="filter-bar__apply-btn"
						onClick={applyCustomFilter}
						disabled={!customInput().trim()}
					>
						Apply
					</button>
					<button class="filter-bar__cancel-btn" onClick={cancelCustomEdit}>
						Cancel
					</button>
				</div>
			</Show>

			<Show when={!editingCustom()}>
				<Show
					when={adding()}
					fallback={
						<div class="filter-bar__actions">
							<Show when={availableColumns().length > 0}>
								<button class="filter-bar__add-btn" onClick={() => setAdding(true)}>
									<Plus size={12} /> Add Filter
								</button>
							</Show>
							<Show when={!props.customFilter}>
								<button class="filter-bar__add-btn" onClick={startEditingCustom}>
									<Plus size={12} /> WHERE
								</button>
							</Show>
						</div>
					}
				>
					<div class="filter-bar__form">
						<Select
							class="filter-bar__select"
							value={selectedColumn()}
							onChange={(v) => handleColumnChange(v)}
							placeholder="Column..."
							options={[
								{ value: '', label: 'Column...' },
								...availableColumns().map((col) => ({ value: col.name, label: col.name })),
							]}
						/>

						<Select
							class="filter-bar__select"
							value={selectedOperator()}
							onChange={(v) => setSelectedOperator(v as FilterOperator)}
							options={currentOperators().map((op) => ({ value: op.value, label: op.label }))}
						/>

						<Show when={operatorNeedsValue(selectedOperator())}>
							<input
								class="filter-bar__input"
								type="text"
								placeholder={selectedOperator() === 'in' ? 'val1, val2, ...' : 'Value...'}
								value={inputValue()}
								onInput={(e) => setInputValue(e.currentTarget.value)}
								onKeyDown={handleKeyDown}
							/>
						</Show>

						<button
							class="filter-bar__apply-btn"
							onClick={handleApply}
							disabled={!selectedColumn() || (operatorNeedsValue(selectedOperator()) && !inputValue().trim())}
						>
							Apply
						</button>
						<button class="filter-bar__cancel-btn" onClick={resetForm}>
							Cancel
						</button>
					</div>
				</Show>
			</Show>
		</div>
	)
}
