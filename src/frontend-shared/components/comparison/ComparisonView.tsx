import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { compareData, MAX_COMPARISON_ROWS } from '@dotaz/shared/comparison'
import type { ComparisonColumnMapping, ComparisonResult, ComparisonSource, DiffRowStatus } from '@dotaz/shared/types/comparison'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import { uiStore } from '../../stores/ui'
import Icon from '../common/Icon'
import './ComparisonView.css'

interface ComparisonViewProps {
	tabId: string
	/** Initial comparison parameters — triggers comparison on mount. */
	initialParams?: {
		left: ComparisonSource
		right: ComparisonSource
		keyColumns: ComparisonColumnMapping[]
		columnMappings: ComparisonColumnMapping[]
	}
}

type StatusFilter = 'all' | DiffRowStatus

export default function ComparisonView(props: ComparisonViewProps) {
	const [result, setResult] = createSignal<ComparisonResult | null>(null)
	const [loading, setLoading] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [statusFilter, setStatusFilter] = createSignal<StatusFilter>('all')

	createEffect(() => {
		if (props.initialParams) {
			runComparison(props.initialParams)
		}
	})

	function buildSourceSql(source: ComparisonSource): string {
		if (source.type === 'query') {
			if (!source.sql) throw new Error('SQL query is required for query source')
			return source.sql
		}
		if (!source.schema || !source.table) {
			throw new Error('Schema and table are required for table source')
		}
		const dialect = connectionsStore.getDialect(source.connectionId)
		const qualified = dialect.qualifyTable(source.schema, source.table)
		return `SELECT * FROM ${qualified} LIMIT ${MAX_COMPARISON_ROWS + 1}`
	}

	async function runComparison(params: NonNullable<ComparisonViewProps['initialParams']>) {
		setLoading(true)
		setError(null)
		setResult(null)
		try {
			const leftSql = buildSourceSql(params.left)
			const rightSql = buildSourceSql(params.right)

			const [leftResults, rightResults] = await Promise.all([
				rpc.query.execute({ connectionId: params.left.connectionId, sql: leftSql, queryId: `cmp-left-${Date.now()}`, database: params.left.database }),
				rpc.query.execute({
					connectionId: params.right.connectionId,
					sql: rightSql,
					queryId: `cmp-right-${Date.now()}`,
					database: params.right.database,
				}),
			])

			const leftResult = leftResults[0]
			const rightResult = rightResults[0]

			if (leftResult.error) throw new Error(leftResult.error)
			if (rightResult.error) throw new Error(rightResult.error)

			const leftData = {
				columns: leftResult.columns.map((c) => c.name),
				rows: leftResult.rows.slice(0, MAX_COMPARISON_ROWS) as Record<string, unknown>[],
			}
			const rightData = {
				columns: rightResult.columns.map((c) => c.name),
				rows: rightResult.rows.slice(0, MAX_COMPARISON_ROWS) as Record<string, unknown>[],
			}

			const res = compareData(
				leftData,
				rightData,
				params.keyColumns,
				params.columnMappings.length > 0 ? params.columnMappings : undefined,
			)
			setResult(res)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg)
			uiStore.addToast('error', `Comparison failed: ${msg}`)
		} finally {
			setLoading(false)
		}
	}

	const filteredRows = createMemo(() => {
		const r = result()
		if (!r) return []
		const filter = statusFilter()
		if (filter === 'all') return r.rows
		return r.rows.filter((row) => row.status === filter)
	})

	function formatCellValue(value: unknown): string {
		if (value === null || value === undefined) return 'NULL'
		if (typeof value === 'object') return JSON.stringify(value)
		return String(value)
	}

	function getStatusLabel(status: DiffRowStatus): string {
		switch (status) {
			case 'matched':
				return 'Matched'
			case 'added':
				return 'Added'
			case 'removed':
				return 'Removed'
			case 'changed':
				return 'Changed'
		}
	}

	return (
		<div class="comparison-view">
			<Show when={loading()}>
				<div class="comparison-view__loading">
					<Icon name="spinner" size={20} />
					<span>Comparing data...</span>
				</div>
			</Show>

			<Show when={error()}>
				<div class="comparison-view__error">
					<Icon name="error" size={14} />
					<span>{error()}</span>
				</div>
			</Show>

			<Show when={result()}>
				{(res) => (
					<>
						<div class="comparison-view__toolbar">
							<div class="comparison-view__stats">
								<span class="comparison-view__stat comparison-view__stat--total">
									Total: {res().stats.total}
								</span>
								<button
									class="comparison-view__stat comparison-view__stat--matched"
									classList={{ 'comparison-view__stat--active': statusFilter() === 'matched' }}
									onClick={() => setStatusFilter((f) => f === 'matched' ? 'all' : 'matched')}
								>
									Matched: {res().stats.matched}
								</button>
								<button
									class="comparison-view__stat comparison-view__stat--added"
									classList={{ 'comparison-view__stat--active': statusFilter() === 'added' }}
									onClick={() => setStatusFilter((f) => f === 'added' ? 'all' : 'added')}
								>
									Added: {res().stats.added}
								</button>
								<button
									class="comparison-view__stat comparison-view__stat--removed"
									classList={{ 'comparison-view__stat--active': statusFilter() === 'removed' }}
									onClick={() => setStatusFilter((f) => f === 'removed' ? 'all' : 'removed')}
								>
									Removed: {res().stats.removed}
								</button>
								<button
									class="comparison-view__stat comparison-view__stat--changed"
									classList={{ 'comparison-view__stat--active': statusFilter() === 'changed' }}
									onClick={() => setStatusFilter((f) => f === 'changed' ? 'all' : 'changed')}
								>
									Changed: {res().stats.changed}
								</button>
							</div>
							<div class="comparison-view__info">
								{filteredRows().length} rows shown
							</div>
						</div>

						<div class="comparison-view__grid-wrapper">
							<div class="comparison-view__side">
								<div class="comparison-view__side-header">Left</div>
								<div class="comparison-view__table-wrapper">
									<table class="comparison-view__table">
										<thead>
											<tr>
												<th class="comparison-view__th comparison-view__th--status">Status</th>
												<For each={res().leftColumns}>
													{(col) => <th class="comparison-view__th">{col}</th>}
												</For>
											</tr>
										</thead>
										<tbody>
											<For each={filteredRows()}>
												{(row) => (
													<tr class={`comparison-view__row comparison-view__row--${row.status}`}>
														<td class="comparison-view__td comparison-view__td--status">
															<span class={`comparison-view__badge comparison-view__badge--${row.status}`}>
																{getStatusLabel(row.status)}
															</span>
														</td>
														<For each={res().leftColumns}>
															{(col) => {
																const isChanged = row.changedColumns.includes(col)
																return (
																	<td
																		class="comparison-view__td"
																		classList={{
																			'comparison-view__td--changed': isChanged,
																			'comparison-view__td--null': row.leftValues?.[col] === null || row.leftValues?.[col] === undefined,
																			'comparison-view__td--empty': row.status === 'added',
																		}}
																	>
																		{row.leftValues ? formatCellValue(row.leftValues[col]) : ''}
																	</td>
																)
															}}
														</For>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</div>
							</div>

							<div class="comparison-view__divider" />

							<div class="comparison-view__side">
								<div class="comparison-view__side-header">Right</div>
								<div class="comparison-view__table-wrapper">
									<table class="comparison-view__table">
										<thead>
											<tr>
												<th class="comparison-view__th comparison-view__th--status">Status</th>
												<For each={res().rightColumns}>
													{(col) => <th class="comparison-view__th">{col}</th>}
												</For>
											</tr>
										</thead>
										<tbody>
											<For each={filteredRows()}>
												{(row) => {
													const mappedChangedCols = row.changedColumns.map((lc) => {
														const mapping = res().columnMappings.find((m) => m.leftColumn === lc)
														return mapping?.rightColumn ?? lc
													})
													return (
														<tr class={`comparison-view__row comparison-view__row--${row.status}`}>
															<td class="comparison-view__td comparison-view__td--status">
																<span class={`comparison-view__badge comparison-view__badge--${row.status}`}>
																	{getStatusLabel(row.status)}
																</span>
															</td>
															<For each={res().rightColumns}>
																{(col) => {
																	const isChanged = mappedChangedCols.includes(col)
																	return (
																		<td
																			class="comparison-view__td"
																			classList={{
																				'comparison-view__td--changed': isChanged,
																				'comparison-view__td--null': row.rightValues?.[col] === null || row.rightValues?.[col] === undefined,
																				'comparison-view__td--empty': row.status === 'removed',
																			}}
																		>
																			{row.rightValues ? formatCellValue(row.rightValues[col]) : ''}
																		</td>
																	)
																}}
															</For>
														</tr>
													)
												}}
											</For>
										</tbody>
									</table>
								</div>
							</div>
						</div>
					</>
				)}
			</Show>

			<Show when={!loading() && !error() && !result()}>
				<div class="comparison-view__empty">
					No comparison data. Configure and run a comparison to see results.
				</div>
			</Show>
		</div>
	)
}
