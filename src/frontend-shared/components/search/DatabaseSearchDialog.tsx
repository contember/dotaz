import { createEffect, createSignal, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import type { SchemaData, SchemaInfo, TableInfo } from '@dotaz/shared/types/database'
import type { SearchMatch, SearchScope } from '@dotaz/shared/types/rpc'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import { gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import Dialog from '../common/Dialog'
import Select from '../common/Select'
import './DatabaseSearchDialog.css'

interface DatabaseSearchDialogProps {
	open: boolean
	onClose: () => void
	initialConnectionId?: string
	initialScope?: SearchScope
	initialSchema?: string
	initialTable?: string
	initialDatabase?: string
}

interface GroupedMatches {
	schema: string
	table: string
	matches: SearchMatch[]
}

function groupMatches(matches: SearchMatch[]): GroupedMatches[] {
	const groups = new Map<string, GroupedMatches>()
	for (const match of matches) {
		const key = `${match.schema}.${match.table}`
		let group = groups.get(key)
		if (!group) {
			group = { schema: match.schema, table: match.table, matches: [] }
			groups.set(key, group)
		}
		group.matches.push(match)
	}
	return [...groups.values()]
}

/** Render a value with the search term highlighted. */
function highlightMatch(value: string, term: string): (string | { highlight: string })[] {
	if (!term) return [value]
	const lowerVal = value.toLowerCase()
	const lowerTerm = term.toLowerCase()
	const idx = lowerVal.indexOf(lowerTerm)
	if (idx === -1) return [value]

	const parts: (string | { highlight: string })[] = []
	if (idx > 0) parts.push(value.slice(0, idx))
	parts.push({ highlight: value.slice(idx, idx + term.length) })
	if (idx + term.length < value.length) parts.push(value.slice(idx + term.length))
	return parts
}

export default function DatabaseSearchDialog(props: DatabaseSearchDialogProps) {
	const [params, setParams] = createStore({
		term: '',
		scope: 'database' as SearchScope,
		schema: '',
		tables: [] as string[],
		resultsPerTable: 50,
		connId: '',
		db: undefined as string | undefined,
	})
	const [progress, setProgress] = createStore({ table: '', searched: 0, total: 0 })

	const [schemaData, setSchemaData] = createSignal<SchemaData | null>(null)
	const [results, setResults] = createSignal<SearchMatch[]>([])
	const [searchStatus, setSearchStatus] = createSignal<'idle' | 'searching' | 'done' | 'error'>('idle')
	const [searchError, setSearchError] = createSignal<string | null>(null)
	const [searchedInfo, setSearchedInfo] = createSignal<{ tables: number; elapsed: number; total: number; cancelled: boolean } | null>(null)

	const schemas = (): SchemaInfo[] => schemaData()?.schemas ?? []
	const allTables = (): TableInfo[] => {
		const sd = schemaData()
		if (!sd) return []
		const tables: TableInfo[] = []
		for (const t of Object.values(sd.tables)) {
			tables.push(...t.filter((tb) => tb.type === 'table'))
		}
		return tables
	}

	// Load schema data when connection changes
	createEffect(() => {
		if (props.open && params.connId) {
			rpc.schema.load({ connectionId: params.connId, database: params.db }).then((data) => {
				setSchemaData(data)
			}).catch(() => {
				setSchemaData(null)
			})
		}
	})

	// Reset state when dialog opens
	createEffect(() => {
		if (props.open) {
			const connId = props.initialConnectionId || connectionsStore.connectedConnections[0]?.id || ''
			setParams(reconcile({
				term: '',
				scope: props.initialScope ?? 'database',
				schema: props.initialSchema ?? '',
				tables: props.initialTable ? [props.initialTable] : [],
				resultsPerTable: 50,
				connId,
				db: props.initialDatabase,
			}))
			if (props.initialTable) {
				setParams('scope', 'tables')
			}
			setResults([])
			setSearchStatus('idle')
			setSearchError(null)
			setSearchedInfo(null)
			setProgress(reconcile({ table: '', searched: 0, total: 0 }))
		}
	})

	async function handleSearch() {
		const term = params.term.trim()
		if (!term || !params.connId) return

		setSearchStatus('searching')
		setSearchError(null)
		setResults([])
		setSearchedInfo(null)
		setProgress(reconcile({ table: '', searched: 0, total: 0 }))

		try {
			const response = await rpc.search.searchDatabase({
				connectionId: params.connId,
				database: params.db,
				searchTerm: term,
				scope: params.scope,
				schemaName: params.scope === 'schema' ? params.schema : undefined,
				tableNames: params.scope === 'tables' ? params.tables : undefined,
				resultsPerTable: params.resultsPerTable,
			})

			setResults(response.matches)
			setSearchedInfo({
				tables: response.searchedTables,
				elapsed: response.elapsedMs,
				total: response.totalMatches,
				cancelled: response.cancelled,
			})
			setSearchStatus('done')
		} catch (err) {
			setSearchError(err instanceof Error ? err.message : String(err))
			setSearchStatus('error')
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && searchStatus() !== 'searching') {
			e.preventDefault()
			handleSearch()
		}
	}

	function handleResultClick(match: SearchMatch) {
		// Open or reuse existing tab for this table
		const existing = tabsStore.findDefaultTab(params.connId, match.schema, match.table, params.db)
		if (existing) {
			// Set quick search to help user find the row
			gridStore.setQuickSearch(existing, params.term)
		} else {
			const tabId = tabsStore.openTab({
				type: 'data-grid',
				title: match.table,
				connectionId: params.connId,
				schema: match.schema,
				table: match.table,
				database: params.db,
			})
			// Apply quick search once data loads
			gridStore.loadTableData(tabId, params.connId, match.schema, match.table, params.db).then(() => {
				gridStore.setQuickSearch(tabId, params.term)
			})
		}
		props.onClose()
	}

	function handleTableToggle(tableName: string) {
		setParams('tables', (prev) => {
			if (prev.includes(tableName)) {
				return prev.filter((t) => t !== tableName)
			}
			return [...prev, tableName]
		})
	}

	const grouped = () => groupMatches(results())

	return (
		<Dialog open={props.open} title="Search Database" onClose={props.onClose}>
			<div class="search-dialog">
				<div class="search-dialog__controls">
					<div class="search-dialog__row">
						<input
							class="search-dialog__input"
							type="text"
							placeholder="Search text..."
							value={params.term}
							onInput={(e) => setParams('term', e.currentTarget.value)}
							onKeyDown={handleKeyDown}
						/>
						<button
							class="btn btn--primary"
							onClick={handleSearch}
							disabled={searchStatus() === 'searching' || !params.term.trim()}
						>
							Search
						</button>
					</div>

					<div class="search-dialog__row">
						<span class="search-dialog__label">Connection</span>
						<Select
							class="search-dialog__select"
							value={params.connId}
							onChange={(v) => {
								setParams('connId', v)
								setParams('db', undefined)
								setResults([])
								setSearchStatus('idle')
							}}
							options={connectionsStore.connectedConnections.map((conn) => ({ value: conn.id, label: conn.name }))}
						/>

						<span class="search-dialog__label">Scope</span>
						<Select
							class="search-dialog__select"
							value={params.scope}
							onChange={(v) => setParams('scope', v as SearchScope)}
							options={[
								{ value: 'database', label: 'Entire database' },
								{ value: 'schema', label: 'Specific schema' },
								{ value: 'tables', label: 'Selected tables' },
							]}
						/>
					</div>

					<Show when={params.scope === 'schema'}>
						<div class="search-dialog__row">
							<span class="search-dialog__label">Schema</span>
							<Select
								class="search-dialog__select"
								value={params.schema}
								onChange={(v) => setParams('schema', v)}
								options={schemas().map((s) => ({ value: s.name, label: s.name }))}
							/>
						</div>
					</Show>

					<Show when={params.scope === 'tables'}>
						<div class="search-dialog__table-selector">
							<For each={allTables()}>
								{(table) => (
									<label class="search-dialog__table-option">
										<input
											type="checkbox"
											checked={params.tables.includes(table.name)}
											onChange={() => handleTableToggle(table.name)}
										/>
										<span>{table.schema !== 'main' && table.schema !== 'public' ? `${table.schema}.` : ''}{table.name}</span>
									</label>
								)}
							</For>
						</div>
					</Show>

					<div class="search-dialog__row">
						<span class="search-dialog__label">Results per table</span>
						<input
							class="search-dialog__limit-input"
							type="number"
							min="1"
							max="1000"
							value={params.resultsPerTable}
							onChange={(e) => setParams('resultsPerTable', Math.max(1, Math.min(1000, parseInt(e.currentTarget.value) || 50)))}
						/>
					</div>
				</div>

				<Show when={searchStatus() === 'searching'}>
					<div class="search-dialog__progress">
						<div class="search-dialog__progress-bar">
							<div
								class="search-dialog__progress-fill"
								style={{
									width: progress.total > 0
										? `${Math.round((progress.searched / progress.total) * 100)}%`
										: '0%',
								}}
							/>
						</div>
						<div class="search-dialog__progress-text">
							<span>
								Searching{progress.table ? `: ${progress.table}` : '...'}
								{progress.total > 0 ? ` (${progress.searched}/${progress.total})` : ''}
							</span>
						</div>
					</div>
				</Show>

				<Show when={searchError()}>
					<div class="search-dialog__error">{searchError()}</div>
				</Show>

				<Show when={searchedInfo()}>
					{(info) => (
						<div class="search-dialog__summary">
							Found {info().total} match{info().total !== 1 ? 'es' : ''} in {info().tables} table{info().tables !== 1 ? 's' : ''} ({info().elapsed}ms)
							{info().cancelled ? ' — cancelled' : ''}
						</div>
					)}
				</Show>

				<Show when={searchStatus() === 'done' && results().length === 0 && !searchError()}>
					<div class="search-dialog__empty">No matches found</div>
				</Show>

				<div class="search-dialog__results">
					<For each={grouped()}>
						{(group) => (
							<div class="search-dialog__group">
								<div class="search-dialog__group-header">
									{group.schema !== 'main' && group.schema !== 'public' ? `${group.schema}.` : ''}
									{group.table}
									<span class="search-dialog__group-count">({group.matches.length})</span>
								</div>
								<For each={group.matches}>
									{(match) => {
										const value = () => {
											const v = match.row[match.column]
											return v == null ? 'NULL' : String(v)
										}
										const parts = () => highlightMatch(value(), params.term)

										return (
											<div
												class="search-dialog__match"
												onClick={() => handleResultClick(match)}
											>
												<span class="search-dialog__match-column">{match.column}</span>
												<span class="search-dialog__match-value">
													<For each={parts()}>
														{(part) => (
															typeof part === 'string'
																? <>{part}</>
																: <span class="search-dialog__match-highlight">{part.highlight}</span>
														)}
													</For>
												</span>
											</div>
										)
									}}
								</For>
							</div>
						)}
					</For>
				</div>
			</div>
		</Dialog>
	)
}
