import Search from 'lucide-solid/icons/search'
import X from 'lucide-solid/icons/x'
import { createEffect, createSignal, For, on, Show } from 'solid-js'
import { buildQuickSearchClause, buildSelectQuery } from '../../../shared/sql'
import type { ColumnFilter, GridColumnDef } from '../../../shared/types/grid'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import Dialog from '../common/Dialog'
import FilterBar from '../grid/FilterBar'
import './FkPickerModal.css'

interface FkPickerModalProps {
	open: boolean
	onClose: () => void
	onSelect: (value: unknown) => void
	connectionId: string
	schema: string
	table: string
	column: string
	database?: string
}

const PAGE_SIZE = 200

export default function FkPickerModal(props: FkPickerModalProps) {
	const [rows, setRows] = createSignal<Record<string, unknown>[]>([])
	const [columns, setColumns] = createSignal<GridColumnDef[]>([])
	const [loading, setLoading] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [filters, setFilters] = createSignal<ColumnFilter[]>([])
	const [customFilter, setCustomFilter] = createSignal('')
	let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined

	async function fetchRows(opts: {
		searchTerm: string
		filters: ColumnFilter[]
		customFilter: string
	}) {
		setLoading(true)
		setError(null)
		try {
			const dialect = connectionsStore.getDialect(props.connectionId)
			const colInfos = connectionsStore.getColumns(
				props.connectionId,
				props.schema,
				props.table,
				props.database,
			)
			const colDefs: GridColumnDef[] = colInfos.map((c) => ({
				name: c.name,
				dataType: c.dataType,
				nullable: c.nullable,
				isPrimaryKey: c.isPrimaryKey,
			}))
			setColumns(colDefs)

			const quickSearch = opts.searchTerm
				? buildQuickSearchClause(colDefs, opts.searchTerm, dialect)
				: undefined

			const query = buildSelectQuery(
				props.schema,
				props.table,
				1,
				PAGE_SIZE,
				undefined,
				opts.filters.length > 0 ? opts.filters : undefined,
				dialect,
				quickSearch,
				opts.customFilter || undefined,
			)
			const results = await rpc.query.execute({
				connectionId: props.connectionId,
				sql: query.sql,
				queryId: `fk-picker-${props.schema}-${props.table}`,
				params: query.params,
				database: props.database,
			})
			setRows((results[0]?.rows ?? []) as Record<string, unknown>[])
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Query failed')
		} finally {
			setLoading(false)
		}
	}

	createEffect(on(() => props.open, (open) => {
		if (open) {
			setSearch('')
			setFilters([])
			setCustomFilter('')
			fetchRows({ searchTerm: '', filters: [], customFilter: '' })
		}
	}))

	function handleSearchInput(value: string) {
		setSearch(value)
		clearTimeout(searchDebounceTimer)
		searchDebounceTimer = setTimeout(() => {
			fetchRows({ searchTerm: value, filters: filters(), customFilter: customFilter() })
		}, 300)
	}

	function handleClearSearch() {
		setSearch('')
		clearTimeout(searchDebounceTimer)
		fetchRows({ searchTerm: '', filters: filters(), customFilter: customFilter() })
	}

	function handleAddFilter(filter: ColumnFilter) {
		const next = [...filters().filter((f) => f.column !== filter.column), filter]
		setFilters(next)
		fetchRows({ searchTerm: search(), filters: next, customFilter: customFilter() })
	}

	function handleRemoveFilter(column: string) {
		const next = filters().filter((f) => f.column !== column)
		setFilters(next)
		fetchRows({ searchTerm: search(), filters: next, customFilter: customFilter() })
	}

	function handleSetCustomFilter(value: string) {
		setCustomFilter(value)
		fetchRows({ searchTerm: search(), filters: filters(), customFilter: value })
	}

	function handleClearAllFilters() {
		setFilters([])
		setCustomFilter('')
		fetchRows({ searchTerm: search(), filters: [], customFilter: '' })
	}

	function handleSelectRow(row: Record<string, unknown>) {
		props.onSelect(row[props.column])
		props.onClose()
	}

	function formatCell(value: unknown): string {
		if (value === null || value === undefined) return 'NULL'
		if (typeof value === 'object') return JSON.stringify(value)
		return String(value)
	}

	return (
		<Dialog
			open={props.open}
			title={`Pick from ${props.schema}.${props.table}`}
			onClose={props.onClose}
			class="fk-picker-modal"
		>
			<div class="fk-picker">
				<div class="fk-picker__toolbar">
					<div class="fk-picker__search">
						<Search size={14} class="fk-picker__search-icon" />
						<input
							class="fk-picker__search-input"
							type="text"
							placeholder="Quick search..."
							value={search()}
							onInput={(e) => handleSearchInput(e.currentTarget.value)}
						/>
						<Show when={search()}>
							<button class="fk-picker__search-clear" onClick={handleClearSearch} title="Clear search">
								<X size={12} />
							</button>
						</Show>
					</div>

					<Show when={columns().length > 0}>
						<FilterBar
							columns={columns()}
							filters={filters()}
							customFilter={customFilter()}
							onAddFilter={handleAddFilter}
							onRemoveFilter={handleRemoveFilter}
							onSetCustomFilter={handleSetCustomFilter}
							onClearAll={handleClearAllFilters}
						/>
					</Show>
				</div>

				<Show when={loading()}>
					<div class="fk-picker__status">Loading...</div>
				</Show>

				<Show when={!loading() && error()}>
					<div class="fk-picker__status fk-picker__status--error">{error()}</div>
				</Show>

				<Show when={!loading() && !error()}>
					<Show
						when={rows().length > 0}
						fallback={<div class="fk-picker__status">No rows found</div>}
					>
						<div class="fk-picker__table-wrap">
							<table class="fk-picker__table">
								<thead>
									<tr>
										<For each={columns()}>
											{(col) => (
												<th
													class="fk-picker__th"
													classList={{ 'fk-picker__th--target': col.name === props.column }}
												>
													{col.name}
												</th>
											)}
										</For>
									</tr>
								</thead>
								<tbody>
									<For each={rows()}>
										{(row) => (
											<tr class="fk-picker__tr" onClick={() => handleSelectRow(row)}>
												<For each={columns()}>
													{(col) => (
														<td
															class="fk-picker__td"
															classList={{ 'fk-picker__td--target': col.name === props.column }}
														>
															{formatCell(row[col.name])}
														</td>
													)}
												</For>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</div>
					</Show>
				</Show>
			</div>
		</Dialog>
	)
}
