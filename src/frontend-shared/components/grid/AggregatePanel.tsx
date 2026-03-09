import { createMemo, For, Show } from 'solid-js'
import { isNumericType } from '@dotaz/shared/column-types'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import './AggregatePanel.css'

export interface AggregateResult {
	column: string
	count: number
	countDistinct: number
	sum?: number
	avg?: number
	min?: number | string
	max?: number | string
}

interface AggregatePanelProps {
	rows: Record<string, unknown>[]
	columns: GridColumnDef[]
	visibleColumns: GridColumnDef[]
}

function formatNumber(value: number): string {
	if (Number.isInteger(value)) {
		return value.toLocaleString()
	}
	// Up to 4 decimal places, strip trailing zeros
	return value.toLocaleString(undefined, {
		minimumFractionDigits: 0,
		maximumFractionDigits: 4,
	})
}

function computeAggregates(
	rows: Record<string, unknown>[],
	columns: GridColumnDef[],
): AggregateResult[] {
	const results: AggregateResult[] = []

	for (const col of columns) {
		const values: unknown[] = []
		for (const row of rows) {
			const v = row[col.name]
			if (v !== null && v !== undefined) {
				values.push(v)
			}
		}

		const count = values.length
		const distinct = new Set(values.map((v) => String(v))).size
		const result: AggregateResult = {
			column: col.name,
			count,
			countDistinct: distinct,
		}

		if (isNumericType(col.dataType)) {
			const nums = values.map(Number).filter((n) => !Number.isNaN(n))
			if (nums.length > 0) {
				result.sum = nums.reduce((a, b) => a + b, 0)
				result.avg = result.sum / nums.length
				result.min = Math.min(...nums)
				result.max = Math.max(...nums)
			}
		} else {
			const strings = values.map(String).sort()
			if (strings.length > 0) {
				result.min = strings[0]
				result.max = strings[strings.length - 1]
			}
		}

		results.push(result)
	}

	return results
}

function formatValue(value: number | string | undefined, maxLength?: number): string {
	if (value === undefined) return ''
	if (typeof value === 'number') return formatNumber(value)
	if (maxLength && value.length > maxLength) return `${value.slice(0, maxLength)}…`
	return value
}

export default function AggregatePanel(props: AggregatePanelProps) {
	const aggregates = createMemo(() => computeAggregates(props.rows, props.visibleColumns))

	const hasAnyData = createMemo(() => aggregates().some((a) => a.count > 0))

	const filteredAggregates = createMemo(() =>
		aggregates().filter((agg) => {
			const col = props.visibleColumns.find((c) => c.name === agg.column)
			return col && agg.count > 0
		})
	)

	const hasNumeric = createMemo(() =>
		filteredAggregates().some((agg) => {
			const col = props.visibleColumns.find((c) => c.name === agg.column)
			return col && isNumericType(col.dataType)
		})
	)

	return (
		<Show when={hasAnyData()}>
			<div class="aggregate-table">
				<div class="aggregate-table__summary">
					{props.rows.length} row{props.rows.length !== 1 ? 's' : ''} selected
				</div>
				<table class="aggregate-table__table">
					<thead>
						<tr>
							<th>Column</th>
							<th>Count</th>
							<th>Distinct</th>
							<Show when={hasNumeric()}>
								<th>Sum</th>
								<th>Avg</th>
							</Show>
							<th>Min</th>
							<th>Max</th>
						</tr>
					</thead>
					<tbody>
						<For each={filteredAggregates()}>
							{(agg) => {
								const col = props.visibleColumns.find((c) => c.name === agg.column)!
								const numeric = isNumericType(col.dataType)

								return (
									<tr>
										<td class="aggregate-table__col-name">{agg.column}</td>
										<td class="aggregate-table__num">{agg.count}</td>
										<td class="aggregate-table__num">{agg.countDistinct}</td>
										<Show when={hasNumeric()}>
											<td class="aggregate-table__num">
												{numeric ? formatValue(agg.sum) : ''}
											</td>
											<td class="aggregate-table__num">
												{numeric ? formatValue(agg.avg) : ''}
											</td>
										</Show>
										<td class="aggregate-table__val" title={typeof agg.min === 'string' ? agg.min : undefined}>{formatValue(agg.min, 30)}</td>
										<td class="aggregate-table__val" title={typeof agg.max === 'string' ? agg.max : undefined}>{formatValue(agg.max, 30)}</td>
									</tr>
								)
							}}
						</For>
					</tbody>
				</table>
			</div>
		</Show>
	)
}
