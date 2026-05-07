import type { ForeignKeyInfo } from '@dotaz/shared/types/database'
import type { SavedViewConfig } from '@dotaz/shared/types/rpc'
import Check from 'lucide-solid/icons/check'
import PanelRight from 'lucide-solid/icons/panel-right'
import Pencil from 'lucide-solid/icons/pencil'
import Redo2 from 'lucide-solid/icons/redo-2'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Undo2 from 'lucide-solid/icons/undo-2'
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from 'solid-js'
import { createStore } from 'solid-js/store'
import { buildFkLookup } from '../../lib/fk-utils'
import { connectionsStore } from '../../stores/connections'
import type { FkTarget } from '../../stores/grid'
import { getSelectedRowIndices, gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import { viewsStore } from '../../stores/views'
import Icon from '../common/Icon'
import FkPickerModal from '../edit/FkPickerModal'
import PendingChanges from '../edit/PendingChanges'
import ExportDialog from '../export/ExportDialog'
import ImportDialog from '../import/ImportDialog'
import SaveViewDialog from '../views/SaveViewDialog'
import AdvancedCopyDialog from './AdvancedCopyDialog'
import BatchEditDialog from './BatchEditDialog'
import { useDataGridContextMenu } from './DataGridContextMenu'
import type { DataGridSidePanelHandle } from './DataGridSidePanel'
import DataGridSidePanel from './DataGridSidePanel'
import DataGridToolbar from './DataGridToolbar'
import GridShell from './GridShell'
import GridView, { type GridViewEditing } from './GridView'
import Pagination from './Pagination'
import PastePreviewDialog from './PastePreviewDialog'
import RowColoringPanel from './RowColoringPanel'
import TransposedGrid from './TransposedGrid'
import { useDataGridCellEdit } from './useDataGridCellEdit'
import { useDataGridClipboard } from './useDataGridClipboard'
import type { DataGridModal } from './useDataGridModals'
import { useDataGridModals } from './useDataGridModals'
import './DataGrid.css'

interface DataGridProps {
	tabId: string
	connectionId: string
	schema: string
	table: string
	database?: string
}

export default function DataGrid(props: DataGridProps) {
	const [fkState, setFkState] = createStore({
		columns: new Set<string>(),
		keys: [] as ForeignKeyInfo[],
		map: new Map<string, FkTarget>(),
	})
	const [showPendingPanel, setShowPendingPanel] = createSignal(false)
	const [savingChanges, setSavingChanges] = createSignal(false)
	const [saveError, setSaveError] = createSignal<string | null>(null)
	const [savedViewConfig, setSavedViewConfig] = createSignal<SavedViewConfig | null>(null)
	const [rowColoringOpen, setRowColoringOpen] = createSignal(false)

	const [sidePanelHandle, setSidePanelHandle] = createSignal<
		DataGridSidePanelHandle | undefined
	>()

	const tab = () => gridStore.getTab(props.tabId)
	const tabInfo = () => tabsStore.openTabs.find((t) => t.id === props.tabId)
	const isReadOnly = () =>
		connectionsStore.isReadOnly(props.connectionId)
		|| (tab()?.autoJoins.length ?? 0) > 0

	const currentSchema = () => tab()?.schema ?? props.schema
	const currentTable = () => tab()?.table ?? props.table

	const hasActiveView = () => !!tab()?.activeViewId

	const visibleColumns = () => {
		const t = tab()
		return t ? gridStore.getVisibleColumns(t) : []
	}

	// ── Hooks ──────────────────────────────────────────

	const modals = useDataGridModals()

	const cellEdit = useDataGridCellEdit({
		tabId: props.tabId,
		visibleColumns,
		isReadOnly,
		fkMap: () => fkState.map,
		onOpenFkPicker: modals.openFkPicker,
	})

	const clipboard = useDataGridClipboard({
		tabId: props.tabId,
		isReadOnly,
		getFocusedCellInfo: cellEdit.getFocusedCellInfo,
		onOpenPastePreview: modals.openPastePreview,
	})

	const contextMenu = useDataGridContextMenu({
		tabId: props.tabId,
		connectionId: props.connectionId,
		currentSchema: () => tab()?.schema ?? props.schema,
		currentTable: () => tab()?.table ?? props.table,
		database: props.database,
		fkMap: () => fkState.map,
		visibleColumns,
		isReadOnly,
		onPaste: clipboard.handlePaste,
		onAdvancedCopy: () => modals.openAdvancedCopy(),
		onDuplicateRow: cellEdit.handleDuplicateRow,
		onFkClick: (rowIndex, column) => sidePanelHandle()?.handleFkClick(rowIndex, column),
		onSetSidePanelOpen: (open) => sidePanelHandle()?.setSidePanelOpen(open),
	})

	// ── Event listeners ──────────────────────────────────

	// Listen for import dialog open events from context menu
	function handleOpenImport(e: Event) {
		const detail = (e as CustomEvent).detail
		if (
			detail?.connectionId === props.connectionId
			&& detail?.schema === currentSchema()
			&& detail?.table === currentTable()
		) {
			modals.openImport()
		}
	}
	onMount(() => {
		window.addEventListener('dotaz:open-import', handleOpenImport)
	})
	onCleanup(() => {
		window.removeEventListener('dotaz:open-import', handleOpenImport)
	})

	// Sync tab dirty flag with pending changes state
	createEffect(() => {
		const dirty = gridStore.hasPendingChanges(props.tabId)
		tabsStore.setTabDirty(props.tabId, dirty)
		if (!dirty) setShowPendingPanel(false)
	})

	// Track view modification status
	createEffect(() => {
		const config = savedViewConfig()
		if (!config || !hasActiveView()) {
			tabsStore.setViewModified(props.tabId, false)
			return
		}
		const modified = gridStore.isViewModified(props.tabId, config)
		tabsStore.setViewModified(props.tabId, modified)
	})

	const heatmapInfo = createMemo(() => {
		const t = tab()
		if (!t) return new Map()
		return gridStore.computeHeatmapStats(t)
	})

	function getRowColor(rowIndex: number): string | undefined {
		const t = tab()
		if (!t || !t.rowColoringEnabled || t.rowColorRules.length === 0) return undefined
		const row = t.rows[rowIndex]
		if (!row) return undefined
		return gridStore.evaluateRowColor(row, t.rowColorRules)
	}

	// Wait for the connection to be ready AND schema to be loaded before initial data load.
	let didInitialLoad = false
	let didTriggerReconnect = false
	createEffect(() => {
		const conn = connectionsStore.connections.find(
			(c) => c.id === props.connectionId,
		)
		if (!conn || didInitialLoad) return

		if (conn.state === 'connected') {
			const schemaData = connectionsStore.getSchemaData(
				props.connectionId,
				props.database,
			)
			if (!schemaData) return

			didInitialLoad = true
			untrack(async () => {
				const existing = gridStore.getTab(props.tabId)
				if (!existing || existing.columns.length === 0) {
					await gridStore.loadTableData(
						props.tabId,
						props.connectionId,
						props.schema,
						props.table,
						props.database,
					)
				}

				const ti = tabInfo()
				if (ti?.viewId) {
					const view = viewsStore.getViewById(props.connectionId, ti.viewId)
					if (view) {
						gridStore.setActiveView(props.tabId, view.id, view.name)
						await gridStore.applyViewConfig(props.tabId, view.config)
						setSavedViewConfig(view.config)
					}
				}

				loadForeignKeys(props.schema, props.table)
			})
		} else if (!didTriggerReconnect && conn.state !== 'connecting') {
			didTriggerReconnect = true
			connectionsStore.connectTo(props.connectionId)
		}
	})

	function loadForeignKeys(schema: string, table: string) {
		const fks = connectionsStore.getForeignKeys(
			props.connectionId,
			schema,
			table,
			props.database,
		)
		const fkCols = new Set<string>()
		for (const fk of fks) {
			for (const col of fk.columns) {
				fkCols.add(col)
			}
		}
		const map = buildFkLookup(fks)

		// Include FKs from joined tables (prefixed with tableName.)
		const t = gridStore.getTab(props.tabId)
		if (t && t.autoJoins.length > 0) {
			for (const join of t.autoJoins) {
				const joinedFks = connectionsStore.getForeignKeys(
					props.connectionId,
					join.referencedSchema,
					join.referencedTable,
					props.database,
				)
				for (const fk of joinedFks) {
					if (fk.columns.length === 1) {
						const prefixedCol = `${join.referencedTable}.${fk.columns[0]}`
						fkCols.add(prefixedCol)
						map.set(prefixedCol, {
							schema: fk.referencedSchema,
							table: fk.referencedTable,
							column: fk.referencedColumns[0],
						})
					}
				}
			}
		}

		setFkState({ columns: fkCols, keys: fks, map })
	}

	// Rebuild FK map when auto-joins change
	createEffect(() => {
		const t = tab()
		const joinCount = t?.autoJoins.length ?? 0
		// Touch joinCount to track reactivity, then rebuild
		if (joinCount >= 0 && t) {
			loadForeignKeys(t.schema, t.table)
		}
	})

	// ── Sort / resize / row-number ──────────────────────

	function handleToggleSort(column: string, multi: boolean) {
		gridStore.toggleSort(props.tabId, column, multi)
	}

	function handleResizeColumn(column: string, width: number) {
		gridStore.setColumnWidth(props.tabId, column, width)
	}

	function handleRowNumberClick(index: number, e: MouseEvent) {
		const totalCols = visibleColumns().length
		if (e.shiftKey) {
			gridStore.selectFullRowRange(props.tabId, index, index, totalCols)
		} else if (e.ctrlKey || e.metaKey) {
			gridStore.toggleFullRow(props.tabId, index, totalCols)
		} else {
			gridStore.selectFullRow(props.tabId, index, totalCols)
			gridStore.closeFkPanel(props.tabId)
			sidePanelHandle()?.setSidePanelOpen(true)
		}
	}

	function handleActivateSelection() {
		sidePanelHandle()?.openForSelection()
	}

	function gridEditing(): GridViewEditing {
		return {
			editingCell: tab()?.editingCell ?? null,
			isEditable: () => !isReadOnly(),
			onStart: (rowIdx, col) => {
				if (isReadOnly()) return
				if (gridStore.isRowDeleted(props.tabId, rowIdx)) return
				gridStore.startEditing(props.tabId, rowIdx, col)
			},
			onSave: cellEdit.handleCellSave,
			onCancel: cellEdit.handleCellCancel,
			onMoveNext: cellEdit.handleCellMoveNext,
			onMoveDown: cellEdit.handleCellMoveDown,
			isCellChanged: (rowIdx, col) => cellEdit.getChangedCells(rowIdx).has(col),
			isRowDeleted: (idx) => gridStore.isRowDeleted(props.tabId, idx),
			isRowNew: (idx) => gridStore.isRowNew(props.tabId, idx),
			onDeleteSelected: cellEdit.handleDeleteSelected,
			onPaste: clipboard.handlePaste,
			onBrowseFk: cellEdit.handleBrowseFkForInline,
		}
	}

	// ── Pending changes ──────────────────────────────────

	function handleChangesApplied() {
		gridStore.refreshData(props.tabId)
	}

	async function handleImmediateSave() {
		if (!gridStore.hasPendingChanges(props.tabId)) return
		setSavingChanges(true)
		setSaveError(null)
		try {
			await gridStore.applyChanges(props.tabId, props.database)
			gridStore.clearPendingChanges(props.tabId)
			handleChangesApplied()
		} catch (err) {
			setSaveError(err instanceof Error ? err.message : String(err))
		} finally {
			setSavingChanges(false)
		}
	}

	function handleRevertAll() {
		gridStore.revertChanges(props.tabId)
		setSaveError(null)
	}

	// ── Saved views ────────────────────────────────────

	function generateAutoName(): string {
		const t = tab()
		if (!t) return ''
		const parts: string[] = []
		if (t.filters.length > 0) {
			const cols = t.filters.map((f) => f.column).join(', ')
			parts.push(`filtered by ${cols}`)
		}
		if (t.sort.length > 0) {
			const cols = t.sort.map((s) => s.column).join(', ')
			parts.push(`sorted by ${cols}`)
		}
		return parts.length > 0 ? parts.join(', ') : 'Custom view'
	}

	// ── Clipboard modal callbacks ──────────────────────

	function handlePastePreviewConfirm(treatNullText: boolean) {
		const m = modals.dgModal()
		if (m?.type !== 'paste-preview') return
		clipboard.handlePastePreviewConfirm(treatNullText, m.rows)
		modals.closeModal()
	}

	function handleFkPickerSelect(value: unknown) {
		const m = modals.dgModal()
		if (m?.type !== 'fk-picker') return
		cellEdit.handleFkPickerSelect(value, { rowIndex: m.rowIndex, column: m.column })
		modals.closeModal()
	}

	// Listen for save-view events dispatched by the command registry
	onMount(() => {
		const onSaveView = (e: Event) => {
			const detail = (e as CustomEvent).detail
			if (detail?.tabId === props.tabId) {
				// Quick save via toolbar handler
				modals.openSaveView(false)
			}
		}
		window.addEventListener('dotaz:save-view', onSaveView)
		onCleanup(() => window.removeEventListener('dotaz:save-view', onSaveView))
	})

	// Listen for add-new-row events dispatched by the command registry
	onMount(() => {
		const onAddNewRow = (e: Event) => {
			const detail = (e as CustomEvent).detail
			if (detail?.tabId === props.tabId) {
				cellEdit.handleAddNewRow()
			}
		}
		window.addEventListener('dotaz:add-new-row', onAddNewRow)
		onCleanup(() => window.removeEventListener('dotaz:add-new-row', onAddNewRow))
	})

	return (
		<div class="data-grid">
			<DataGridToolbar
				tabId={props.tabId}
				connectionId={props.connectionId}
				currentSchema={currentSchema}
				currentTable={currentTable}
				database={props.database}
				isReadOnly={isReadOnly}
				savedViewConfig={savedViewConfig}
				onSetSavedViewConfig={setSavedViewConfig}
				onSaveViewOpen={(forceNew) => modals.openSaveView(forceNew)}
				onExportOpen={() => modals.openExport()}
				onImportOpen={() => modals.openImport()}
				onAddNewRow={() => cellEdit.handleAddNewRow()}
				rowColoringOpen={rowColoringOpen()}
				onToggleRowColoring={() => setRowColoringOpen(!rowColoringOpen())}
				sidePanelToggle={
					<button
						class="data-grid__toolbar-btn"
						classList={{
							'data-grid__toolbar-btn--active': !!sidePanelHandle()?.sidePanelMode(),
						}}
						onClick={() => {
							if (sidePanelHandle()?.sidePanelMode()) {
								sidePanelHandle()!.setSidePanelOpen(false)
								gridStore.closeFkPanel(props.tabId)
							} else {
								sidePanelHandle()?.setSidePanelOpen(true)
							}
						}}
						title="Toggle side panel"
					>
						<PanelRight size={14} />
					</button>
				}
			/>

			<Show when={rowColoringOpen() && tab()}>
				<RowColoringPanel
					columns={tab()!.columns}
					rules={tab()!.rowColorRules}
					enabled={tab()!.rowColoringEnabled}
					onSetRules={(rules) => gridStore.setRowColorRules(props.tabId, rules)}
					onToggle={() => gridStore.toggleRowColoring(props.tabId)}
				/>
			</Show>

			<Show when={tab()}>
				{(_tabAccessor) => {
					const tabState = () => tab()!
					return (
						<>
							<div class="data-grid__body">
								<div class="data-grid__main">
									<Show
										when={tabState().loading && tabState().rows.length === 0}
									>
										<div class="data-grid__skeleton">
											<div class="data-grid__skeleton-header">
												<div
													class="skeleton"
													style={{ width: '80px', height: '14px' }}
												/>
												<div
													class="skeleton"
													style={{ width: '120px', height: '14px' }}
												/>
												<div
													class="skeleton"
													style={{ width: '100px', height: '14px' }}
												/>
												<div
													class="skeleton"
													style={{ width: '90px', height: '14px' }}
												/>
												<div
													class="skeleton"
													style={{ width: '110px', height: '14px' }}
												/>
											</div>
											{Array.from({ length: 8 }).map(() => (
												<div class="data-grid__skeleton-row">
													<div
														class="skeleton"
														style={{ width: '70px', height: '12px' }}
													/>
													<div
														class="skeleton"
														style={{ width: '110px', height: '12px' }}
													/>
													<div
														class="skeleton"
														style={{ width: '90px', height: '12px' }}
													/>
													<div
														class="skeleton"
														style={{ width: '80px', height: '12px' }}
													/>
													<div
														class="skeleton"
														style={{ width: '100px', height: '12px' }}
													/>
												</div>
											))}
										</div>
									</Show>

									<Show
										when={tabState().transposed}
										fallback={
											<GridView
												rows={tabState().rows}
												columns={visibleColumns()}
												selection={tabState().selection}
												onSelectionChange={(sel) => gridStore.setSelection(props.tabId, sel)}
												columnConfig={tabState().columnConfig}
												onResizeColumn={handleResizeColumn}
												sort={tabState().sort}
												onToggleSort={handleToggleSort}
												editing={gridEditing()}
												fkColumns={fkState.columns}
												fkMap={fkState.map}
												heatmapInfo={heatmapInfo()}
												getRowColor={getRowColor}
												onFkClick={(rowIndex, column, anchorEl) => sidePanelHandle()?.handleFkClick(rowIndex, column, anchorEl)}
												onPkClick={(rowIndex, column, anchorEl) => sidePanelHandle()?.handlePkClick(rowIndex, column, anchorEl)}
												onRowNumberClick={handleRowNumberClick}
												onActivateSelection={handleActivateSelection}
												onSaveShortcut={() => modals.openSaveView(false)}
												onAdvancedCopyShortcut={() => modals.openAdvancedCopy()}
												getCellContextMenu={contextMenu.getCellContextMenu}
												getHeaderContextMenu={contextMenu.getHeaderContextMenu}
												loading={tabState().loading}
												emptyState={
													<div class="empty-state" style={{ 'padding-top': '48px' }}>
														<Icon name="table" size={32} class="empty-state__icon" />
														<div class="empty-state__title">No data</div>
														<div class="empty-state__subtitle">
															{tabState().quickSearch
																? 'No rows match the current search.'
																: tabState().filters.length > 0
																? 'No rows match the current filters.'
																: 'This table is empty.'}
														</div>
													</div>
												}
											/>
										}
									>
										<GridShell
											rows={tabState().rows}
											columns={visibleColumns()}
											selection={tabState().selection}
											onSelectionChange={(sel) => gridStore.setSelection(props.tabId, sel)}
											editing={gridEditing()}
											getCellContextMenu={contextMenu.getCellContextMenu}
											getHeaderContextMenu={contextMenu.getHeaderContextMenu}
											onActivateSelection={handleActivateSelection}
											onSaveShortcut={() => modals.openSaveView(false)}
											onAdvancedCopyShortcut={() => modals.openAdvancedCopy()}
											class="data-grid__transposed-shell"
										>
											<div
												class="grid-view__scroll"
												classList={{ 'grid-view__scroll--loading': tabState().loading }}
											>
												<TransposedGrid
													rows={tabState().rows}
													columns={visibleColumns()}
													columnConfig={tabState().columnConfig}
													selection={tabState().selection}
													onRowMouseDown={(idx, e) => {
														// Selection in transposed mode is intentionally simplified.
														// Falls back to the previous direct gridStore actions.
														if (e.button !== 0) return
														const target = e.target as Element | null
														if (target?.closest('.inline-editor')) return
														const cellEl = (e.target as HTMLElement).closest<HTMLElement>('[data-column]')
														const columnName = cellEl?.dataset.column ?? null
														const cols = visibleColumns()
														const colIdx = columnName
															? cols.findIndex((c) => c.name === columnName)
															: -1
														const safeCol = colIdx >= 0 ? colIdx : 0
														if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
															gridStore.extendLastRange(props.tabId, idx, safeCol)
														} else if (e.shiftKey) {
															gridStore.extendSelection(props.tabId, idx, safeCol)
														} else if (e.ctrlKey || e.metaKey) {
															gridStore.addCellRange(props.tabId, idx, safeCol)
														} else {
															gridStore.selectCell(props.tabId, idx, safeCol)
														}
														const shellEl = (e.currentTarget as HTMLElement | null)?.closest<HTMLElement>('.grid-view')
														shellEl?.focus()
														e.preventDefault()
													}}
													onRowDblClick={cellEdit.handleRowDblClick}
													editingCell={tabState().editingCell}
													getChangedCells={cellEdit.getChangedCells}
													isRowDeleted={(idx) => gridStore.isRowDeleted(props.tabId, idx)}
													isRowNew={(idx) => gridStore.isRowNew(props.tabId, idx)}
													fkMap={fkState.map}
													heatmapInfo={heatmapInfo()}
													onCellSave={cellEdit.handleCellSave}
													onCellCancel={cellEdit.handleCellCancel}
													onCellMoveNext={cellEdit.handleCellMoveNext}
													onCellMoveDown={cellEdit.handleCellMoveDown}
													onFkClick={(rowIndex, column, anchorEl) => sidePanelHandle()?.handleFkClick(rowIndex, column, anchorEl)}
													onPkClick={(rowIndex, column, anchorEl) => sidePanelHandle()?.handlePkClick(rowIndex, column, anchorEl)}
													onCellBrowseFk={cellEdit.handleBrowseFkForInline}
												/>
											</div>
										</GridShell>
									</Show>
								</div>

								<DataGridSidePanel
									ref={(h) => {
										setSidePanelHandle(h)
									}}
									tabId={props.tabId}
									connectionId={props.connectionId}
									currentSchema={currentSchema()}
									currentTable={currentTable()}
									database={props.database}
									foreignKeys={() => fkState.keys}
									fkMap={() => fkState.map}
									visibleColumns={visibleColumns}
									isReadOnly={isReadOnly}
									onExportSelected={() => {
										if (!gridStore.getSelectionSnapshot(props.tabId)) {
											const t = tab()
											const totalCols = visibleColumns().length
											if (t && t.rows.length > 0 && totalCols > 0) {
												gridStore.selectAll(
													props.tabId,
													t.rows.length,
													totalCols,
												)
											}
										}
										modals.openExport('selected')
									}}
									onBatchEdit={() => modals.openBatchEdit()}
								/>
							</div>

							<Show when={gridStore.hasPendingChanges(props.tabId)}>
								<div class="data-grid__pending-bar">
									<div class="data-grid__pending-bar-info">
										<Pencil size={12} />
										<span>
											{gridStore.pendingChangesCount(props.tabId)} pending change
											{gridStore.pendingChangesCount(props.tabId) !== 1
												? 's'
												: ''}
										</span>
									</div>
									<Show when={saveError()}>
										<span
											class="data-grid__pending-bar-error"
											title={saveError()!}
										>
											{saveError()}
										</span>
									</Show>
									<div class="data-grid__pending-bar-actions">
										<button
											class="data-grid__pending-bar-btn"
											onClick={() => gridStore.undo(props.tabId)}
											disabled={savingChanges() || !gridStore.canUndo(props.tabId)}
											title="Undo (Ctrl+Z)"
										>
											<Undo2 size={12} />
										</button>
										<button
											class="data-grid__pending-bar-btn"
											onClick={() => gridStore.redo(props.tabId)}
											disabled={savingChanges() || !gridStore.canRedo(props.tabId)}
											title="Redo (Ctrl+Shift+Z)"
										>
											<Redo2 size={12} />
										</button>
										<button
											class="data-grid__pending-bar-btn"
											onClick={handleRevertAll}
											disabled={savingChanges()}
											title="Revert all changes"
										>
											<RotateCcw size={12} /> Revert
										</button>
										<button
											class="data-grid__pending-bar-btn"
											onClick={() => setShowPendingPanel(true)}
											title="Review changes and preview SQL"
										>
											Review
										</button>
										<button
											class="data-grid__pending-bar-btn data-grid__pending-bar-btn--save"
											onClick={handleImmediateSave}
											disabled={savingChanges()}
											title="Save all changes"
										>
											<Check size={12} /> {savingChanges() ? 'Saving...' : 'Save'}
										</button>
									</div>
								</div>
							</Show>

							<div class="data-grid__footer">
								<Pagination
									currentPage={tabState().currentPage}
									pageSize={tabState().pageSize}
									totalCount={tabState().totalCount}
									countLoading={tabState().countLoading}
									rowCount={tabState().rows.length}
									loading={tabState().loading}
									lastLoadedAt={tabState().lastLoadedAt}
									fetchDuration={tabState().fetchDuration}
									onPageChange={(page) => gridStore.setPage(props.tabId, page)}
									onPageSizeChange={(size) => gridStore.setPageSize(props.tabId, size)}
									onCountRequest={() => gridStore.fetchGridCount(props.tabId)}
								/>
							</div>

							<PendingChanges
								open={showPendingPanel() && gridStore.hasPendingChanges(props.tabId)}
								tabId={props.tabId}
								connectionId={props.connectionId}
								database={props.database}
								onClose={() => setShowPendingPanel(false)}
								onApplied={handleChangesApplied}
							/>
						</>
					)
				}}
			</Show>

			<Show when={clipboard.copyFeedback()}>
				<div class="data-grid__copy-toast">{clipboard.copyFeedback()}</div>
			</Show>
			<SaveViewDialog
				open={modals.dgModal()?.type === 'save-view'}
				tabId={props.tabId}
				connectionId={props.connectionId}
				schema={currentSchema()}
				table={currentTable()}
				initialName={hasActiveView() ? undefined : generateAutoName()}
				forceNew={(modals.dgModal() as Extract<DataGridModal, { type: 'save-view' }> | null)?.forceNew ?? false}
				onClose={() => modals.closeModal()}
				onSaved={async (viewId, viewName, config) => {
					tabsStore.setTabView(props.tabId, viewId, viewName)
					gridStore.setActiveView(props.tabId, viewId, viewName)
					setSavedViewConfig(config)
					await viewsStore.refreshViews(props.connectionId)
				}}
			/>

			<ExportDialog
				open={modals.dgModal()?.type === 'export'}
				tabId={props.tabId}
				connectionId={props.connectionId}
				schema={currentSchema()}
				table={currentTable()}
				database={props.database}
				initialScope={(modals.dgModal() as Extract<DataGridModal, { type: 'export' }> | null)?.scope}
				onClose={() => modals.closeModal()}
			/>

			<AdvancedCopyDialog
				open={modals.dgModal()?.type === 'advanced-copy'}
				tabId={props.tabId}
				visibleColumns={visibleColumns()}
				onClose={() => modals.closeModal()}
			/>

			<ImportDialog
				open={modals.dgModal()?.type === 'import'}
				connectionId={props.connectionId}
				schema={currentSchema()}
				table={currentTable()}
				database={props.database}
				onClose={() => modals.closeModal()}
				onImported={() => {
					gridStore.refreshData(props.tabId)
				}}
			/>

			<Show when={modals.dgModal()?.type === 'batch-edit'}>
				{(_) => {
					const t = tab()!
					return (
						<BatchEditDialog
							open={true}
							tabId={props.tabId}
							columns={t.columns}
							selectedRows={new Set(getSelectedRowIndices(t.selection))}
							fkMap={fkState.map}
							connectionId={props.connectionId}
							database={props.database}
							onClose={() => modals.closeModal()}
						/>
					)
				}}
			</Show>

			<Show when={modals.dgModal()?.type === 'paste-preview'}>
				{(_) => {
					const t = tab()!
					const m = modals.dgModal() as Extract<DataGridModal, { type: 'paste-preview' }>
					return (
						<PastePreviewDialog
							open={true}
							parsedRows={m.rows}
							delimiter={m.delimiter}
							columns={visibleColumns()}
							startColumn={visibleColumns()[t.selection.focusedCell?.col ?? 0]?.name ?? ''}
							startRow={t.selection.focusedCell?.row ?? 0}
							totalExistingRows={t.rows.length}
							onConfirm={handlePastePreviewConfirm}
							onClose={() => modals.closeModal()}
						/>
					)
				}}
			</Show>

			<Show when={modals.dgModal()?.type === 'fk-picker'}>
				{(_) => {
					const m = modals.dgModal() as Extract<DataGridModal, { type: 'fk-picker' }>
					return (
						<FkPickerModal
							open={true}
							onClose={() => modals.closeModal()}
							onSelect={handleFkPickerSelect}
							connectionId={props.connectionId}
							schema={m.target.schema}
							table={m.target.table}
							column={m.target.column}
							database={props.database}
						/>
					)
				}}
			</Show>
		</div>
	)
}
