import ArrowLeftRight from 'lucide-solid/icons/arrow-left-right'
import EllipsisVertical from 'lucide-solid/icons/ellipsis-vertical'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Save from 'lucide-solid/icons/save'
import { createSignal, type JSX, onCleanup, Show } from 'solid-js'
import type { ColumnFilter } from '@dotaz/shared/types/grid'
import type { SavedViewConfig } from '@dotaz/shared/types/rpc'
import { useClickOutside } from '../../lib/hooks'
import { rpc } from '../../lib/rpc'
import { editorStore } from '../../stores/editor'
import { gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import { uiStore } from '../../stores/ui'
import { viewsStore } from '../../stores/views'
import Icon from '../common/Icon'
import ColumnManager from './ColumnManager'
import FilterBar from './FilterBar'

export interface DataGridToolbarProps {
	tabId: string
	connectionId: string
	currentSchema: () => string
	currentTable: () => string
	database?: string
	isReadOnly: () => boolean
	savedViewConfig: () => SavedViewConfig | null
	onSetSavedViewConfig: (config: SavedViewConfig | null) => void
	onSaveViewOpen: (forceNew: boolean) => void
	onExportOpen: () => void
	onImportOpen: () => void
	sidePanelToggle: JSX.Element
	rowColoringOpen: boolean
	onToggleRowColoring: () => void
}

export default function DataGridToolbar(props: DataGridToolbarProps) {
	const [searchInput, setSearchInput] = createSignal('')
	const [moreMenuOpen, setMoreMenuOpen] = createSignal(false)
	let moreMenuRef: HTMLDivElement | undefined
	let moreMenuTriggerRef: HTMLButtonElement | undefined
	let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined

	const tab = () => gridStore.getTab(props.tabId)

	const hasActiveView = () => !!tab()?.activeViewId
	const isModified = () => {
		const config = props.savedViewConfig()
		if (!config) return false
		return gridStore.isViewModified(props.tabId, config)
	}

	onCleanup(() => {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
	})

	// Close more menu on click outside
	useClickOutside(() => moreMenuOpen(), () => [moreMenuRef, moreMenuTriggerRef], () => setMoreMenuOpen(false))

	function handleQuickSearchInput(value: string) {
		setSearchInput(value)
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
		searchDebounceTimer = setTimeout(() => {
			gridStore.setQuickSearch(props.tabId, value)
		}, 300)
	}

	function handleClearQuickSearch() {
		setSearchInput('')
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
		gridStore.setQuickSearch(props.tabId, '')
	}

	function handleRefresh() {
		gridStore.refreshData(props.tabId)
	}

	function handleAddFilter(filter: ColumnFilter) {
		gridStore.setFilter(props.tabId, filter)
	}

	function handleRemoveFilter(column: string) {
		gridStore.removeFilter(props.tabId, column)
	}

	function handleClearFilters() {
		gridStore.clearFilters(props.tabId)
	}

	async function handleQuickSave() {
		const t = tab()
		if (!t?.activeViewId) {
			props.onSaveViewOpen(false)
			return
		}
		try {
			const config = gridStore.captureViewConfig(props.tabId)
			const updated = await rpc.views.update({
				id: t.activeViewId,
				name: t.activeViewName!,
				config,
			})
			props.onSetSavedViewConfig(updated.config)
			tabsStore.setTabView(props.tabId, updated.id, updated.name)
			await viewsStore.refreshViews(props.connectionId)
		} catch {
			props.onSaveViewOpen(false)
		}
	}

	async function handleResetView() {
		const config = props.savedViewConfig()
		if (!config) return
		await gridStore.applyViewConfig(props.tabId, config)
	}

	function handleSaveAsNew() {
		props.onSaveViewOpen(true)
	}

	return (
		<div class="data-grid__toolbar">
			<Show when={tab()}>
				{(_tabAccessor) => {
					const tabState = () => tab()!
					return (
						<>
							<div class="data-grid__view-actions">
								<Show
									when={hasActiveView()}
									fallback={
										<button
											class="data-grid__toolbar-btn"
											onClick={() => props.onSaveViewOpen(false)}
											title="Save current view"
										>
											<Icon name="save" size={12} /> Save View
										</button>
									}
								>
									<button
										class="data-grid__toolbar-btn"
										onClick={handleQuickSave}
										title="Save view (Ctrl+S)"
									>
										<Icon name="save" size={12} /> Save
									</button>
									<Show when={isModified()}>
										<button
											class="data-grid__toolbar-btn"
											onClick={handleResetView}
											title="Reset to saved state"
										>
											<RotateCcw size={12} /> Reset
										</button>
										<button
											class="data-grid__toolbar-btn"
											onClick={handleSaveAsNew}
											title="Save as new view"
										>
											<Save size={12} /> Save As...
										</button>
									</Show>
								</Show>
							</div>
							<div
								class="data-grid__quick-search"
								classList={{ 'data-grid__quick-search--active': searchInput().length > 0 }}
							>
								<Icon name="search" size={12} />
								<input
									type="text"
									class="data-grid__quick-search-input"
									placeholder="Search..."
									value={searchInput()}
									onInput={(e) => handleQuickSearchInput(e.currentTarget.value)}
									onKeyDown={(e) => {
										if (e.key === 'Escape' && searchInput()) {
											e.preventDefault()
											e.stopPropagation()
											handleClearQuickSearch()
										}
									}}
								/>
								<Show when={searchInput()}>
									<button
										class="data-grid__quick-search-clear"
										onClick={handleClearQuickSearch}
										title="Clear search"
									>
										<Icon name="close" size={10} />
									</button>
								</Show>
							</div>
							<FilterBar
								columns={tabState().columns}
								filters={tabState().filters}
								customFilter={tabState().customFilter}
								onAddFilter={handleAddFilter}
								onUpdateFilter={(oldCol, filter) => {
									gridStore.removeFilter(props.tabId, oldCol)
									gridStore.setFilter(props.tabId, filter)
								}}
								onRemoveFilter={handleRemoveFilter}
								onSetCustomFilter={(v) => gridStore.setCustomFilter(props.tabId, v)}
								onClearAll={handleClearFilters}
							/>
							<ColumnManager
								columns={tabState().columns}
								columnConfig={tabState().columnConfig}
								columnOrder={tabState().columnOrder}
								onToggleVisibility={(col, visible) => gridStore.setColumnVisibility(props.tabId, col, visible)}
								onTogglePin={(col, pinned) => gridStore.setColumnPinned(props.tabId, col, pinned)}
								onReorder={(order) => gridStore.setColumnOrder(props.tabId, order)}
								onReset={() => gridStore.resetColumnConfig(props.tabId)}
							/>
							<Show when={tabState().autoJoins.length > 0}>
								<button
									class="data-grid__toolbar-btn data-grid__toolbar-btn--badge"
									onClick={() => gridStore.removeAllAutoJoins(props.tabId)}
									title={`${tabState().autoJoins.length} active join(s) — click to remove all`}
								>
									<Icon name="link" size={12} /> {tabState().autoJoins.length} Join{tabState().autoJoins.length > 1 ? 's' : ''}
								</button>
							</Show>
							<button
								class="data-grid__toolbar-btn"
								onClick={handleRefresh}
								disabled={tabState().loading}
								title="Refresh data (F5)"
							>
								<Icon name={tabState().loading ? 'spinner' : 'refresh'} size={12} /> Refresh
							</button>
							<div class="data-grid__more-menu">
								<button
									ref={moreMenuTriggerRef}
									class="data-grid__toolbar-btn"
									classList={{ 'data-grid__toolbar-btn--active': moreMenuOpen() }}
									onClick={() => setMoreMenuOpen(!moreMenuOpen())}
									title="More actions"
								>
									<EllipsisVertical size={14} />
								</button>
								<Show when={moreMenuOpen()}>
									<div ref={moreMenuRef} class="data-grid__more-panel">
										<button
											class="data-grid__more-item"
											onClick={() => {
												props.onExportOpen()
												setMoreMenuOpen(false)
											}}
										>
											<Icon name="export" size={12} /> Export
										</button>
										<Show when={!props.isReadOnly()}>
											<button
												class="data-grid__more-item"
												onClick={() => {
													props.onImportOpen()
													setMoreMenuOpen(false)
												}}
											>
												<Icon name="import" size={12} /> Import
											</button>
										</Show>
										<button
											class="data-grid__more-item"
											onClick={() => {
												window.dispatchEvent(
													new CustomEvent('dotaz:open-compare', {
														detail: {
															connectionId: props.connectionId,
															schema: props.currentSchema(),
															table: props.currentTable(),
															database: props.database,
														},
													}),
												)
												setMoreMenuOpen(false)
											}}
										>
											<Icon name="compare" size={12} /> Compare
										</button>
										<button
											class="data-grid__more-item"
											onClick={() => {
												tabsStore.openTab({
													type: 'schema-viewer',
													title: `Schema — ${props.currentTable()}`,
													connectionId: props.connectionId,
													schema: props.currentSchema(),
													table: props.currentTable(),
													database: props.database,
												})
												setMoreMenuOpen(false)
											}}
										>
											<Icon name="schema" size={12} /> Schema
										</button>
										<div class="data-grid__more-separator" />
										<button
											class="data-grid__more-item"
											onClick={async () => {
												const sql = gridStore.getCurrentSql(props.tabId)
												if (sql) {
													await navigator.clipboard.writeText(sql)
													uiStore.addToast('info', 'SQL copied to clipboard')
												}
												setMoreMenuOpen(false)
											}}
										>
											<Icon name="copy" size={12} /> Copy SQL
										</button>
										<button
											class="data-grid__more-item"
											onClick={() => {
												const sql = gridStore.getCurrentSql(props.tabId)
												if (sql) {
													const consoleTabId = tabsStore.openTab({
														type: 'sql-console',
														title: `SQL — ${props.currentTable()}`,
														connectionId: props.connectionId,
														database: props.database,
													})
													editorStore.initTab(consoleTabId, props.connectionId, props.database)
													editorStore.setContent(consoleTabId, sql)
												}
												setMoreMenuOpen(false)
											}}
										>
											<Icon name="sql-console" size={12} /> Open in Console
										</button>
										<div class="data-grid__more-separator" />
										<button
											class="data-grid__more-item"
											classList={{ 'data-grid__more-item--active': !!tabState().transposed }}
											onClick={() => {
												gridStore.toggleTranspose(props.tabId)
												setMoreMenuOpen(false)
											}}
										>
											<ArrowLeftRight size={12} /> Transpose
										</button>
										<button
											class="data-grid__more-item"
											classList={{ 'data-grid__more-item--active': props.rowColoringOpen }}
											onClick={() => {
												props.onToggleRowColoring()
												setMoreMenuOpen(false)
											}}
										>
											<Icon name="palette" size={12} /> Row Colors
										</button>
									</div>
								</Show>
							</div>
							{props.sidePanelToggle}
						</>
					)
				}}
			</Show>
		</div>
	)
}
