import { getColumnCategory } from '@dotaz/shared/column-types'
import type { DatabaseDataType } from '@dotaz/shared/types/database'
import type { FilterOperator, GridColumnDef } from '@dotaz/shared/types/grid'
import type { RowColorRule } from '@dotaz/shared/types/rpc'
import Plus from 'lucide-solid/icons/plus'
import X from 'lucide-solid/icons/x'
import { createSignal, For, Show } from 'solid-js'
import Select from '../common/Select'
import './RowColoringPanel.css'

interface RowColoringPanelProps {
	columns: GridColumnDef[]
	rules: RowColorRule[]
	enabled: boolean
	onSetRules: (rules: RowColorRule[]) => void
	onToggle: () => void
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

const COLOR_PALETTE = [
	{ value: 'rgba(239, 68, 68, 0.15)', label: 'Red' },
	{ value: 'rgba(249, 115, 22, 0.15)', label: 'Orange' },
	{ value: 'rgba(245, 158, 11, 0.15)', label: 'Yellow' },
	{ value: 'rgba(74, 222, 128, 0.15)', label: 'Green' },
	{ value: 'rgba(34, 211, 238, 0.15)', label: 'Cyan' },
	{ value: 'rgba(96, 165, 250, 0.15)', label: 'Blue' },
	{ value: 'rgba(167, 139, 250, 0.15)', label: 'Purple' },
	{ value: 'rgba(244, 114, 182, 0.15)', label: 'Pink' },
	{ value: 'rgba(148, 163, 184, 0.12)', label: 'Gray' },
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

export default function RowColoringPanel(props: RowColoringPanelProps) {
	const [colorPickerIndex, setColorPickerIndex] = createSignal<number | null>(null)

	function addRule() {
		const firstCol = props.columns[0]
		if (!firstCol) return
		const newRule: RowColorRule = {
			column: firstCol.name,
			operator: 'eq',
			value: '',
			color: COLOR_PALETTE[0].value,
		}
		props.onSetRules([...props.rules, newRule])
	}

	function updateRule(index: number, update: Partial<RowColorRule>) {
		const rules = [...props.rules]
		rules[index] = { ...rules[index], ...update }
		props.onSetRules(rules)
	}

	function removeRule(index: number) {
		props.onSetRules(props.rules.filter((_, i) => i !== index))
	}

	function handleValueKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			;(e.currentTarget as HTMLInputElement).blur()
		}
	}

	return (
		<div class="row-coloring-panel">
			<div class="row-coloring-panel__rules">
				<For each={props.rules}>
					{(rule, idx) => {
						const colDef = () => props.columns.find((c) => c.name === rule.column)
						const operators = () => {
							const col = colDef()
							return col ? getOperatorsForType(col.dataType) : ALL_OPERATORS
						}

						return (
							<div class="row-coloring-panel__rule">
								<Select
									class="row-coloring-panel__col-select"
									value={rule.column}
									onChange={(v) => {
										const col = props.columns.find((c) => c.name === v)
										const ops = col ? getOperatorsForType(col.dataType) : ALL_OPERATORS
										const op = ops.find((o) => o.value === rule.operator)
											? rule.operator
											: ops[0].value
										updateRule(idx(), { column: v, operator: op })
									}}
									options={props.columns.map((c) => ({ value: c.name, label: c.name }))}
								/>
								<Select
									class="row-coloring-panel__op-select"
									value={rule.operator}
									onChange={(v) => updateRule(idx(), { operator: v as FilterOperator })}
									options={operators().map((op) => ({ value: op.value, label: op.label }))}
								/>
								<Show when={operatorNeedsValue(rule.operator)}>
									<input
										class="row-coloring-panel__value-input"
										type="text"
										value={String(rule.value ?? '')}
										placeholder={rule.operator === 'in' ? 'val1, val2' : 'Value'}
										onBlur={(e) => {
											const raw = e.currentTarget.value.trim()
											const value = rule.operator === 'in' ? raw.split(',').map((v) => v.trim()) : raw
											updateRule(idx(), { value })
										}}
										onKeyDown={handleValueKeyDown}
									/>
								</Show>
								<div style={{ position: 'relative' }}>
									<button
										class="row-coloring-panel__color-btn"
										style={{ background: rule.color }}
										onClick={() => setColorPickerIndex(colorPickerIndex() === idx() ? null : idx())}
										title="Pick color"
									/>
									<Show when={colorPickerIndex() === idx()}>
										<div class="row-coloring-panel__color-picker">
											<For each={COLOR_PALETTE}>
												{(color) => (
													<button
														class="row-coloring-panel__color-swatch"
														classList={{ 'row-coloring-panel__color-swatch--selected': rule.color === color.value }}
														style={{ background: color.value }}
														title={color.label}
														onClick={() => {
															updateRule(idx(), { color: color.value })
															setColorPickerIndex(null)
														}}
													/>
												)}
											</For>
										</div>
									</Show>
								</div>
								<button
									class="row-coloring-panel__remove-btn"
									onClick={() => removeRule(idx())}
									title="Remove rule"
								>
									<X size={12} />
								</button>
							</div>
						)
					}}
				</For>
			</div>
			<div class="row-coloring-panel__actions">
				<button class="row-coloring-panel__add-btn" onClick={addRule}>
					<Plus size={12} /> Add Rule
				</button>
				<Show when={props.rules.length > 0}>
					<label class="row-coloring-panel__toggle-label">
						<input
							type="checkbox"
							checked={props.enabled}
							onChange={props.onToggle}
						/>
						Enabled
					</label>
				</Show>
			</div>
		</div>
	)
}
