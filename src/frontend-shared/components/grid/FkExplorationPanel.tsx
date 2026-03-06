import ChevronLeft from 'lucide-solid/icons/chevron-left'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import X from 'lucide-solid/icons/x'
import { For, Show } from 'solid-js'
import type { ForeignKeyInfo } from '../../../shared/types/database'
import type { FkPanelState } from '../../stores/grid'
import Resizer from '../layout/Resizer'
import './FkExplorationPanel.css'

interface FkExplorationPanelProps {
	panel: FkPanelState
	onClose: () => void
	onNavigate: (schema: string, table: string, column: string, value: unknown) => void
	onBack: () => void
	onResize: (delta: number) => void
	onPageChange: (page: number) => void
}

function buildFkLookup(foreignKeys: ForeignKeyInfo[]): Map<string, { schema: string; table: string; column: string }> {
	const map = new Map<string, { schema: string; table: string; column: string }>()
	for (const fk of foreignKeys) {
		if (fk.columns.length === 1) {
			map.set(fk.columns[0], {
				schema: fk.referencedSchema,
				table: fk.referencedTable,
				column: fk.referencedColumns[0],
			})
		}
	}
	return map
}

function formatDisplayValue(value: unknown): string {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'object') return JSON.stringify(value)
	const str = String(value)
	return str.length > 100 ? str.slice(0, 100) + '...' : str
}

export default function FkExplorationPanel(props: FkExplorationPanelProps) {
	const fkLookup = () => buildFkLookup(props.panel.foreignKeys)
	const hasBreadcrumbs = () => props.panel.breadcrumbs.length > 1
	const totalPages = () => Math.max(1, Math.ceil(props.panel.totalCount / props.panel.pageSize))
	const canPrev = () => props.panel.currentPage > 1
	const canNext = () => props.panel.currentPage < totalPages()

	const filterBadge = () => {
		const filters = props.panel.filters
		if (filters.length === 0) return ''
		return filters.map((f) => `${f.column} = ${f.value}`).join(', ')
	}

	function handleCellClick(colName: string, value: unknown) {
		const fk = fkLookup().get(colName)
		if (!fk || value === null || value === undefined) return
		props.onNavigate(fk.schema, fk.table, fk.column, value)
	}

	return (
		<>
			<Resizer onResize={(delta) => props.onResize(-delta)} />
			<div class="fk-panel" style={{ width: `${props.panel.width}px` }}>
				{/* Breadcrumbs */}
				<Show when={hasBreadcrumbs()}>
					<div class="fk-panel__breadcrumbs">
						<button
							class="fk-panel__breadcrumb-back"
							onClick={props.onBack}
							title="Go back"
						>
							<ChevronLeft size={12} />
						</button>
						<For each={props.panel.breadcrumbs.slice(0, -1)}>
							{(bc) => (
								<>
									<span class="fk-panel__breadcrumb-item">{bc.table}</span>
									<span class="fk-panel__breadcrumb-sep">&#8250;</span>
								</>
							)}
						</For>
						<span class="fk-panel__breadcrumb-current">{props.panel.table}</span>
					</div>
				</Show>

				{/* Header */}
				<div class="fk-panel__header">
					<div class="fk-panel__header-info">
						<span class="fk-panel__table-name">{props.panel.table}</span>
						<Show when={filterBadge()}>
							<span class="fk-panel__filter-badge">{filterBadge()}</span>
						</Show>
					</div>
					<button class="fk-panel__close-btn" onClick={props.onClose} title="Close panel">
						<X size={14} />
					</button>
				</div>

				{/* Table body */}
				<div class="fk-panel__table-wrap">
					<Show when={props.panel.loading}>
						<div class="fk-panel__loading">Loading...</div>
					</Show>
					<Show when={!props.panel.loading && props.panel.rows.length === 0}>
						<div class="fk-panel__empty">No data</div>
					</Show>
					<Show when={!props.panel.loading && props.panel.rows.length > 0}>
						<table class="fk-panel__table">
							<thead>
								<tr>
									<For each={props.panel.columns}>
										{(col) => <th>{col.name}</th>}
									</For>
								</tr>
							</thead>
							<tbody>
								<For each={props.panel.rows}>
									{(row) => (
										<tr>
											<For each={props.panel.columns}>
												{(col) => {
													const value = row[col.name]
													const isFk = fkLookup().has(col.name) && value !== null && value !== undefined
													const isNull = value === null || value === undefined
													return (
														<td
															classList={{
																'fk-panel__cell--null': isNull,
																'fk-panel__cell--fk': isFk,
															}}
															onClick={isFk ? () => handleCellClick(col.name, value) : undefined}
															title={isFk ? `Go to ${fkLookup().get(col.name)!.table}` : formatDisplayValue(value)}
														>
															{formatDisplayValue(value)}
														</td>
													)
												}}
											</For>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</Show>
				</div>

				{/* Footer / pagination */}
				<div class="fk-panel__footer">
					<div class="fk-panel__page-info">
						{props.panel.totalCount} row{props.panel.totalCount !== 1 ? 's' : ''}
					</div>
					<Show when={totalPages() > 1}>
						<div class="fk-panel__page-controls">
							<button
								class="fk-panel__page-btn"
								disabled={!canPrev()}
								onClick={() => props.onPageChange(props.panel.currentPage - 1)}
							>
								<ChevronLeft size={12} />
							</button>
							<span>{props.panel.currentPage} / {totalPages()}</span>
							<button
								class="fk-panel__page-btn"
								disabled={!canNext()}
								onClick={() => props.onPageChange(props.panel.currentPage + 1)}
							>
								<ChevronRight size={12} />
							</button>
						</div>
					</Show>
				</div>
			</div>
		</>
	)
}
