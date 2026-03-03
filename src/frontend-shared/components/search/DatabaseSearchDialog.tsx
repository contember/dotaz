import { createEffect, createSignal, For, Show } from 'solid-js'
import type { SchemaData, SchemaInfo, TableInfo } from '../../../shared/types/database'
import type { SearchMatch, SearchScope } from '../../../shared/types/rpc'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import { gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import Dialog from '../common/Dialog'
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
	const [searchTerm, setSearchTerm] = createSignal('')
	const [scope, setScope] = createSignal<SearchScope>('database')
	const [schemaName, setSchemaName] = createSignal<string>('')
	const [selectedTables, setSelectedTables] = createSignal<string[]>([])
	const [resultsPerTable, setResultsPerTable] = createSignal(50)
	const [connectionId, setConnectionId] = createSignal('')
	const [database, setDatabase] = createSignal<string | undefined>(undefined)

	const [schemaData, setSchemaData] = createSignal<SchemaData | null>(null)
	const [results, setResults] = createSignal<SearchMatch[]>([])
	const [searching, setSearching] = createSignal(false)
	const [progressTable, setProgressTable] = createSignal('')
	const [progressSearched, setProgressSearched] = createSignal(0)
	const [progressTotal, setProgressTotal] = createSignal(0)
	const [hasSearched, setHasSearched] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [searchedInfo, setSearchedInfo] = createSignal<{ tables: number; elapsed: number; total: number; cancelled: boolean } | null>(null)

	// Connected connections for the connection picker
	const connectedConnections = () => connectionsStore.connections.filter((c) => c.state === 'connected')

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
		if (props.open && connectionId()) {
			rpc.schema.load({ connectionId: connectionId(), database: database() }).then((data) => {
				setSchemaData(data)
			}).catch(() => {
				setSchemaData(null)
			})
		}
	})

	// Reset state when dialog opens
	createEffect(() => {
		if (props.open) {
			const connId = props.initialConnectionId || connectedConnections()[0]?.id || ''
			setConnectionId(connId)
			setDatabase(props.initialDatabase)
			setSearchTerm('')
			setResults([])
			setHasSearched(false)
			setError(null)
			setSearchedInfo(null)
			setSearching(false)
			setProgressTable('')

			if (props.initialScope) {
				setScope(props.initialScope)
			} else {
				setScope('database')
			}
			if (props.initialSchema) {
				setSchemaName(props.initialSchema)
			}
			if (props.initialTable) {
				setScope('tables')
				setSelectedTables([props.initialTable])
			} else {
				setSelectedTables([])
			}
		}
	})

	async function handleSearch() {
		const term = searchTerm().trim()
		if (!term || !connectionId()) return

		setSearching(true)
		setError(null)
		setResults([])
		setSearchedInfo(null)
		setHasSearched(true)
		setProgressSearched(0)
		setProgressTotal(0)

		try {
			const response = await rpc.search.searchDatabase({
				connectionId: connectionId(),
				database: database(),
				searchTerm: term,
				scope: scope(),
				schemaName: scope() === 'schema' ? schemaName() : undefined,
				tableNames: scope() === 'tables' ? selectedTables() : undefined,
				resultsPerTable: resultsPerTable(),
			})

			setResults(response.matches)
			setSearchedInfo({
				tables: response.searchedTables,
				elapsed: response.elapsedMs,
				total: response.totalMatches,
				cancelled: response.cancelled,
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setSearching(false)
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !searching()) {
			e.preventDefault()
			handleSearch()
		}
	}

	function handleResultClick(match: SearchMatch) {
		// Open or reuse existing tab for this table
		const existing = tabsStore.findDefaultTab(connectionId(), match.schema, match.table, database())
		if (existing) {
			// Set quick search to help user find the row
			gridStore.setQuickSearch(existing, searchTerm())
		} else {
			const tabId = tabsStore.openTab({
				type: 'data-grid',
				title: match.table,
				connectionId: connectionId(),
				schema: match.schema,
				table: match.table,
				database: database(),
			})
			// Apply quick search once data loads
			gridStore.loadTableData(tabId, connectionId(), match.schema, match.table, database()).then(() => {
				gridStore.setQuickSearch(tabId, searchTerm())
			})
		}
		props.onClose()
	}

	function handleTableToggle(tableName: string) {
		setSelectedTables((prev) => {
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
							value={searchTerm()}
							onInput={(e) => setSearchTerm(e.currentTarget.value)}
							onKeyDown={handleKeyDown}
						/>
						<button
							class="btn btn--primary"
							onClick={handleSearch}
							disabled={searching() || !searchTerm().trim()}
						>
							Search
						</button>
					</div>

					<div class="search-dialog__row">
						<span class="search-dialog__label">Connection</span>
						<select
							class="search-dialog__select"
							value={connectionId()}
							onChange={(e) => {
								setConnectionId(e.currentTarget.value)
								setDatabase(undefined)
								setResults([])
								setHasSearched(false)
							}}
						>
							<For each={connectedConnections()}>
								{(conn) => <option value={conn.id}>{conn.name}</option>}
							</For>
						</select>

						<span class="search-dialog__label">Scope</span>
						<select
							class="search-dialog__select"
							value={scope()}
							onChange={(e) => setScope(e.currentTarget.value as SearchScope)}
						>
							<option value="database">Entire database</option>
							<option value="schema">Specific schema</option>
							<option value="tables">Selected tables</option>
						</select>
					</div>

					<Show when={scope() === 'schema'}>
						<div class="search-dialog__row">
							<span class="search-dialog__label">Schema</span>
							<select
								class="search-dialog__select"
								value={schemaName()}
								onChange={(e) => setSchemaName(e.currentTarget.value)}
							>
								<For each={schemas()}>
									{(s) => <option value={s.name}>{s.name}</option>}
								</For>
							</select>
						</div>
					</Show>

					<Show when={scope() === 'tables'}>
						<div class="search-dialog__table-selector">
							<For each={allTables()}>
								{(table) => (
									<label class="search-dialog__table-option">
										<input
											type="checkbox"
											checked={selectedTables().includes(table.name)}
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
							value={resultsPerTable()}
							onChange={(e) => setResultsPerTable(Math.max(1, Math.min(1000, parseInt(e.currentTarget.value) || 50)))}
						/>
					</div>
				</div>

				<Show when={searching()}>
					<div class="search-dialog__progress">
						<div class="search-dialog__progress-bar">
							<div
								class="search-dialog__progress-fill"
								style={{
									width: progressTotal() > 0
										? `${Math.round((progressSearched() / progressTotal()) * 100)}%`
										: '0%',
								}}
							/>
						</div>
						<div class="search-dialog__progress-text">
							<span>
								Searching{progressTable() ? `: ${progressTable()}` : '...'}
								{progressTotal() > 0 ? ` (${progressSearched()}/${progressTotal()})` : ''}
							</span>
						</div>
					</div>
				</Show>

				<Show when={error()}>
					<div class="search-dialog__error">{error()}</div>
				</Show>

				<Show when={searchedInfo()}>
					{(info) => (
						<div class="search-dialog__summary">
							Found {info().total} match{info().total !== 1 ? 'es' : ''} in {info().tables} table{info().tables !== 1 ? 's' : ''} ({info().elapsed}ms)
							{info().cancelled ? ' — cancelled' : ''}
						</div>
					)}
				</Show>

				<Show when={hasSearched() && !searching() && results().length === 0 && !error()}>
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
										const parts = () => highlightMatch(value(), searchTerm())

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
