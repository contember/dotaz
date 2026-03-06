import ArrowLeftRight from 'lucide-solid/icons/arrow-left-right'
import EllipsisVertical from 'lucide-solid/icons/ellipsis-vertical'
import PanelRightOpen from 'lucide-solid/icons/panel-right-open'
import Check from 'lucide-solid/icons/check'
import Pencil from 'lucide-solid/icons/pencil'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Save from 'lucide-solid/icons/save'
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from 'solid-js'
import { generateUpdate } from '../../../shared/sql'
import type { ForeignKeyInfo } from '../../../shared/types/database'
import type { ColumnFilter, GridColumnDef } from '../../../shared/types/grid'
import type { SavedViewConfig, UpdateChange } from '../../../shared/types/rpc'
import { cellValueToDbValue, parseClipboardText } from '../../lib/clipboard-paste'
import { isNumericType } from '../../lib/column-types'
import { createKeyHandler } from '../../lib/keyboard'
import { HEADER_HEIGHT } from '../../lib/layout-constants'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'
import type { FkTarget } from '../../stores/grid'
import { getSelectedRowIndices, isCellInSelection, gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import { viewsStore } from '../../stores/views'
import ContextMenu from '../common/ContextMenu'
import type { ContextMenuEntry } from '../common/ContextMenu'
import Icon from '../common/Icon'
import PendingChanges from '../edit/PendingChanges'
import RowDetailPanel from '../edit/RowDetailPanel'
import ExportDialog from '../export/ExportDialog'
import ImportDialog from '../import/ImportDialog'
import SaveViewDialog from '../views/SaveViewDialog'
import Dialog from '../common/Dialog'
import AdvancedCopyDialog from './AdvancedCopyDialog'
import AggregatePanel from './AggregatePanel'
import BatchEditDialog from './BatchEditDialog'
import ColumnManager from './ColumnManager'
import FkPeekPopover from './FkPeekPopover'
import FilterBar from './FilterBar'
import GridHeader from './GridHeader'
import Pagination from './Pagination'
import PastePreviewDialog from './PastePreviewDialog'
import TransposedGrid from './TransposedGrid'
import ValueEditorPanel from './ValueEditorPanel'
import VirtualScroller from './VirtualScroller'
import './DataGrid.css'

interface DataGridProps {
	tabId: string
	connectionId: string
	schema: string
	table: string
	database?: string
}
const COPY_FLASH_DURATION = 400

/** Build a map from source column → FK target for single-column FKs. */
function buildFkMap(foreignKeys: ForeignKeyInfo[]): Map<string, FkTarget> {
	const map = new Map<string, FkTarget>()
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

export default function DataGrid(props: DataGridProps) {
	const [fkColumns, setFkColumns] = createSignal<Set<string>>(new Set())
	const [foreignKeys, setForeignKeys] = createSignal<ForeignKeyInfo[]>([])
	const [fkMap, setFkMap] = createSignal<Map<string, FkTarget>>(new Map())
	const [copyFeedback, setCopyFeedback] = createSignal<string | null>(null)
	const [rowDetailIndex, setRowDetailIndex] = createSignal<number | null>(null)
	const [rowDetailWidth, setRowDetailWidth] = createSignal(500)
	const [showPendingPanel, setShowPendingPanel] = createSignal(false)
	const [savingChanges, setSavingChanges] = createSignal(false)
	const [saveError, setSaveError] = createSignal<string | null>(null)
	const [saveViewOpen, setSaveViewOpen] = createSignal(false)
	const [exportOpen, setExportOpen] = createSignal(false)
	const [importOpen, setImportOpen] = createSignal(false)
	const [advancedCopyOpen, setAdvancedCopyOpen] = createSignal(false)
	const [pastePreview, setPastePreview] = createSignal<
		{
			rows: string[][]
			delimiter: string
		} | null
	>(null)
	const [cellContextMenu, setCellContextMenu] = createSignal<
		{
			x: number
			y: number
			rowIndex: number
			column: string
		} | null
	>(null)
	const [headerContextMenu, setHeaderContextMenu] = createSignal<
		{
			x: number
			y: number
			column: string
		} | null
	>(null)
	const [showStatsModal, setShowStatsModal] = createSignal(false)
	const [showBatchEdit, setShowBatchEdit] = createSignal(false)
	const [exportInitialScope, setExportInitialScope] = createSignal<'selected' | undefined>(undefined)
	const [saveViewForceNew, setSaveViewForceNew] = createSignal(false)
	const [savedViewConfig, setSavedViewConfig] = createSignal<SavedViewConfig | null>(null)
	const [searchInput, setSearchInput] = createSignal('')
	const [moreMenuOpen, setMoreMenuOpen] = createSignal(false)
	let scrollRef: HTMLDivElement | undefined
	let moreMenuRef: HTMLDivElement | undefined
	let moreMenuTriggerRef: HTMLButtonElement | undefined
	let gridRef: HTMLDivElement | undefined
	let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined
	let isDragging = false
	let dragCtrl = false

	const tab = () => gridStore.getTab(props.tabId)
	const tabInfo = () => tabsStore.openTabs.find((t) => t.id === props.tabId)
	const isReadOnly = () => connectionsStore.isReadOnly(props.connectionId)

	const currentSchema = () => tab()?.schema ?? props.schema
	const currentTable = () => tab()?.table ?? props.table

	const hasActiveView = () => !!tab()?.activeViewId
	const isModified = () => {
		const config = savedViewConfig()
		if (!config) return false
		return gridStore.isViewModified(props.tabId, config)
	}

	// Listen for import dialog open events from context menu
	function handleOpenImport(e: Event) {
		const detail = (e as CustomEvent).detail
		if (
			detail?.connectionId === props.connectionId
			&& detail?.schema === currentSchema()
			&& detail?.table === currentTable()
		) {
			setImportOpen(true)
		}
	}
	onMount(() => {
		window.addEventListener('dotaz:open-import', handleOpenImport)
	})
	onCleanup(() => {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
		window.removeEventListener('dotaz:open-import', handleOpenImport)
	})

	// Close more menu on click outside
	createEffect(() => {
		if (moreMenuOpen()) {
			const handler = (e: MouseEvent) => {
				const target = e.target as HTMLElement
				if (
					moreMenuRef && !moreMenuRef.contains(target)
					&& moreMenuTriggerRef && !moreMenuTriggerRef.contains(target)
				) {
					setMoreMenuOpen(false)
				}
			}
			document.addEventListener('mousedown', handler)
			onCleanup(() => document.removeEventListener('mousedown', handler))
		}
	})

	// Sync tab dirty flag with pending changes state
	createEffect(() => {
		const dirty = gridStore.hasPendingChanges(props.tabId)
		tabsStore.setTabDirty(props.tabId, dirty)
		// Auto-hide panel when no pending changes
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

	const visibleColumns = () => {
		const t = tab()
		return t ? gridStore.getVisibleColumns(t) : []
	}

	const pinStyles = () => {
		const t = tab()
		if (!t) return new Map<string, Record<string, string>>()
		return gridStore.computePinStyles(visibleColumns(), t.columnConfig)
	}

	const heatmapInfo = createMemo(() => {
		const t = tab()
		if (!t) return new Map()
		return gridStore.computeHeatmapStats(t)
	})

	// Wait for the connection to be ready AND schema to be loaded before initial data load.
	// On workspace restore, tabs mount before connections are established —
	// this effect defers the fetch until the connection is actually available
	// and schema metadata (columns) has been cached.
	let didInitialLoad = false
	let didTriggerReconnect = false
	createEffect(() => {
		const conn = connectionsStore.connections.find((c) => c.id === props.connectionId)
		if (!conn || didInitialLoad) return

		if (conn.state === 'connected') {
			// Also wait for schema to be loaded — on workspace restore, the connection
			// may be marked 'connected' before schema data arrives from the server.
			const schemaData = connectionsStore.getSchemaData(props.connectionId, props.database)
			if (!schemaData) return

			didInitialLoad = true
			untrack(async () => {
				const existing = gridStore.getTab(props.tabId)
				if (!existing || existing.columns.length === 0) {
					await gridStore.loadTableData(props.tabId, props.connectionId, props.schema, props.table, props.database)
				}

				// Apply saved view config if this tab was opened for a specific view
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
			// Connection not active — trigger reconnect (once)
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
		setForeignKeys(fks)
		const fkCols = new Set<string>()
		for (const fk of fks) {
			for (const col of fk.columns) {
				fkCols.add(col)
			}
		}
		setFkColumns(fkCols)
		setFkMap(buildFkMap(fks))
	}

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

	function handleToggleSort(column: string, multi: boolean) {
		gridStore.toggleSort(props.tabId, column, multi)
	}

	function handleResizeColumn(column: string, width: number) {
		gridStore.setColumnWidth(props.tabId, column, width)
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

	function resolveColIndex(e: MouseEvent): number {
		const target = e.target as HTMLElement
		const cellEl = target.closest<HTMLElement>('[data-column]')
		const columnName = cellEl?.dataset.column ?? null
		if (!columnName) return 0
		const cols = visibleColumns()
		const idx = cols.findIndex((c) => c.name === columnName)
		return idx >= 0 ? idx : 0
	}

	function resolveCellFromPoint(x: number, y: number): { row: number; col: number } | null {
		const el = document.elementFromPoint(x, y)
		if (!el) return null
		const rowEl = (el as HTMLElement).closest<HTMLElement>('[data-row-index]')
		if (!rowEl) return null
		const row = parseInt(rowEl.dataset.rowIndex!, 10)
		if (isNaN(row)) return null
		const cellEl = (el as HTMLElement).closest<HTMLElement>('[data-column]')
		const columnName = cellEl?.dataset.column ?? null
		if (!columnName) return { row, col: 0 }
		const cols = visibleColumns()
		const idx = cols.findIndex((c) => c.name === columnName)
		return { row, col: idx >= 0 ? idx : 0 }
	}

	function handleRowMouseDown(index: number, e: MouseEvent) {
		// Only primary button
		if (e.button !== 0) return
		const colIdx = resolveColIndex(e)

		if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
			gridStore.extendLastRange(props.tabId, index, colIdx)
			return
		} else if (e.shiftKey) {
			gridStore.extendSelection(props.tabId, index, colIdx)
			return
		} else if (e.ctrlKey || e.metaKey) {
			gridStore.addCellRange(props.tabId, index, colIdx)
			dragCtrl = true
		} else {
			gridStore.selectCell(props.tabId, index, colIdx)
		}

		e.preventDefault()
		isDragging = true

		const onMouseMove = (ev: MouseEvent) => {
			if (!isDragging) return
			ev.preventDefault()
			const cell = resolveCellFromPoint(ev.clientX, ev.clientY)
			if (!cell) return
			if (dragCtrl) {
				gridStore.extendLastRange(props.tabId, cell.row, cell.col)
			} else {
				gridStore.extendSelection(props.tabId, cell.row, cell.col)
			}
		}

		const onMouseUp = () => {
			isDragging = false
			dragCtrl = false
			document.removeEventListener('mousemove', onMouseMove)
			document.removeEventListener('mouseup', onMouseUp)
		}

		document.addEventListener('mousemove', onMouseMove)
		document.addEventListener('mouseup', onMouseUp)
	}

	function handleRowNumberClick(index: number, e: MouseEvent) {
		const totalCols = visibleColumns().length
		if (e.shiftKey) {
			gridStore.selectFullRowRange(props.tabId, index, index, totalCols)
		} else if (e.ctrlKey || e.metaKey) {
			gridStore.toggleFullRow(props.tabId, index, totalCols)
		} else {
			gridStore.selectFullRow(props.tabId, index, totalCols)
		}
	}

	// ── Editing handlers ──────────────────────────────────

	function handleRowDblClick(index: number, e: MouseEvent) {
		if (isReadOnly()) return
		const target = e.target as HTMLElement
		const cellEl = target.closest<HTMLElement>('[data-column]')
		const columnName = cellEl?.dataset.column
		if (columnName && !gridStore.isRowDeleted(props.tabId, index)) {
			gridStore.startEditing(props.tabId, index, columnName)
		}
	}

	function getFocusedCellInfo(): { row: number; column: string } | null {
		const t = tab()
		if (!t?.selection.focusedCell) return null
		const cols = visibleColumns()
		const col = cols[t.selection.focusedCell.col]
		if (!col) return null
		return { row: t.selection.focusedCell.row, column: col.name }
	}

	function startEditingFocused() {
		if (isReadOnly()) return
		const focused = getFocusedCellInfo()
		if (!focused) return
		if (gridStore.isRowDeleted(props.tabId, focused.row)) return
		gridStore.startEditing(props.tabId, focused.row, focused.column)
	}

	function handleCellSave(rowIndex: number, column: string, value: unknown) {
		gridStore.setCellValue(props.tabId, rowIndex, column, value)
		gridStore.stopEditing(props.tabId)
	}

	function handleCellCancel() {
		gridStore.stopEditing(props.tabId)
	}

	function handleCellMoveNext(rowIndex: number, currentColumn: string) {
		const cols = visibleColumns()
		const idx = cols.findIndex((c) => c.name === currentColumn)
		if (idx < cols.length - 1) {
			const nextCol = cols[idx + 1].name
			gridStore.startEditing(props.tabId, rowIndex, nextCol)
			gridStore.selectCell(props.tabId, rowIndex, idx + 1)
		} else {
			gridStore.stopEditing(props.tabId)
		}
	}

	function handleCellMoveDown(rowIndex: number, currentColumn: string) {
		const t = tab()
		if (!t) return
		const cols = visibleColumns()
		const colIdx = cols.findIndex((c) => c.name === currentColumn)
		if (rowIndex < t.rows.length - 1) {
			gridStore.startEditing(props.tabId, rowIndex + 1, currentColumn)
			gridStore.selectCell(props.tabId, rowIndex + 1, Math.max(0, colIdx))
		} else {
			gridStore.stopEditing(props.tabId)
		}
	}

	function handleAddNewRow() {
		if (isReadOnly()) return
		const newIndex = gridStore.addNewRow(props.tabId)
		const cols = visibleColumns()
		if (cols.length > 0) {
			gridStore.startEditing(props.tabId, newIndex, cols[0].name)
			gridStore.selectCell(props.tabId, newIndex, 0)
		}
	}

	function handleDeleteSelected() {
		if (isReadOnly()) return
		gridStore.deleteSelectedRows(props.tabId)
	}

	function getChangedCells(rowIndex: number): Set<string> {
		const t = tab()
		if (!t) return new Set()
		const changed = new Set<string>()
		for (const key of Object.keys(t.pendingChanges.cellEdits)) {
			const edit = t.pendingChanges.cellEdits[key]
			if (edit.rowIndex === rowIndex) {
				changed.add(edit.column)
			}
		}
		return changed
	}

	// ── Row Detail Dialog ────────────────────────────────────

	function openRowDetail() {
		const t = tab()
		if (!t) return
		const indices = getSelectedRowIndices(t.selection)
		if (indices.length === 0) return
		gridStore.closeFkPanel(props.tabId)
		setRowDetailIndex(indices[0])
	}

	function handleRowDetailSave(changes: Record<string, unknown>) {
		const idx = rowDetailIndex()
		if (idx === null) return
		for (const [column, value] of Object.entries(changes)) {
			gridStore.setCellValue(props.tabId, idx, column, value)
		}
	}

	function handleRowDetailClose() {
		setRowDetailIndex(null)
	}

	function handleRowDetailNavigate(direction: 'prev' | 'next') {
		const idx = rowDetailIndex()
		if (idx === null) return
		const t = tab()
		if (!t) return
		const newIdx = direction === 'prev' ? idx - 1 : idx + 1
		if (newIdx < 0 || newIdx >= t.rows.length) return
		setRowDetailIndex(newIdx)
		gridStore.selectFullRow(props.tabId, newIdx, visibleColumns().length)
	}

	function rowDetailPendingColumns(): Set<string> {
		const idx = rowDetailIndex()
		if (idx === null) return new Set()
		const t = tab()
		if (!t) return new Set()
		const result = new Set<string>()
		for (const key of Object.keys(t.pendingChanges.cellEdits)) {
			const sepIdx = key.indexOf(':')
			if (sepIdx >= 0 && parseInt(key.substring(0, sepIdx)) === idx) {
				result.add(key.substring(sepIdx + 1))
			}
		}
		return result
	}

	function rowDetailOpenInTab() {
		const t = tab()
		const idx = rowDetailIndex()
		if (!t || idx === null) return
		const row = t.rows[idx]
		if (!row) return
		const pkCols = t.columns.filter((c) => c.isPrimaryKey)
		if (pkCols.length === 0) return
		const pks: Record<string, unknown> = {}
		for (const pk of pkCols) {
			if (row[pk.name] === null || row[pk.name] === undefined) return
			pks[pk.name] = row[pk.name]
		}
		tabsStore.openTab({
			type: 'row-detail',
			title: `${currentTable()} — ${Object.values(pks).join(', ')}`,
			connectionId: props.connectionId,
			schema: currentSchema(),
			table: currentTable(),
			database: props.database,
			primaryKeys: pks,
		})
		setRowDetailIndex(null)
	}

	function rowDetailSubtitle(): string {
		const idx = rowDetailIndex()
		if (idx === null) return ''
		const t = tab()
		if (!t) return ''
		const row = t.rows[idx]
		if (!row) return ''
		const pkCols = t.columns.filter((c) => c.isPrimaryKey)
		if (pkCols.length === 0) return ''
		return pkCols.map((pk) => `${pk.name}=${row[pk.name] === null ? 'NULL' : row[pk.name]}`).join(', ')
	}

	// ── FK panel handlers ────────────────────────────────────

	async function handleFkPanelSave(changes: Record<string, unknown>) {
		const t = tab()
		const panel = t?.fkPanel
		if (!panel) return
		const currentRow = panel.rows[panel.currentRowIndex]
		if (!currentRow) return
		const pkCols = panel.columns.filter((c) => c.isPrimaryKey)
		if (pkCols.length === 0) return
		const pks: Record<string, unknown> = {}
		for (const pk of pkCols) pks[pk.name] = currentRow[pk.name]

		const dialect = connectionsStore.getDialect(props.connectionId)
		const change: UpdateChange = {
			type: 'update',
			schema: panel.schema,
			table: panel.table,
			primaryKeys: pks,
			values: changes,
		}
		const stmt = generateUpdate(change, dialect)
		await rpc.query.execute({
			connectionId: props.connectionId,
			sql: '',
			queryId: `fk-panel-save-${props.tabId}`,
			database: props.database,
			statements: [{ sql: stmt.sql, params: stmt.params }],
		})
		await gridStore.refreshFkPanel(props.tabId)
	}

	function fkPanelOpenInTab() {
		const t = tab()
		const panel = t?.fkPanel
		if (!panel) return
		const currentRow = panel.rows[panel.currentRowIndex]
		if (!currentRow) return
		const pkCols = panel.columns.filter((c) => c.isPrimaryKey)
		if (pkCols.length > 0) {
			const pks: Record<string, unknown> = {}
			for (const pk of pkCols) pks[pk.name] = currentRow[pk.name]
			tabsStore.openTab({
				type: 'row-detail',
				title: `${panel.table} — ${Object.values(pks).join(', ')}`,
				connectionId: props.connectionId,
				schema: panel.schema,
				table: panel.table,
				database: props.database,
				primaryKeys: pks,
			})
		} else {
			const newTabId = tabsStore.openTab({
				type: 'data-grid',
				title: panel.table,
				connectionId: props.connectionId,
				schema: panel.schema,
				table: panel.table,
				database: props.database,
			})
			gridStore.loadTableData(newTabId, props.connectionId, panel.schema, panel.table, props.database).then(() => {
				for (const f of panel.filters) {
					gridStore.setFilter(newTabId, f)
				}
			})
		}
		gridStore.closeFkPanel(props.tabId)
	}

	function fkPanelSubtitle(): string {
		const panel = tab()?.fkPanel
		if (!panel || panel.filters.length === 0) return ''
		return panel.filters.map((f) => `${f.column} = ${f.value}`).join(', ')
	}

	function fkPanelRowLabel(): string {
		const panel = tab()?.fkPanel
		if (!panel) return ''
		const global = (panel.currentPage - 1) * panel.pageSize + panel.currentRowIndex + 1
		return `${global} / ${panel.totalCount}`
	}

	function fkPanelCanPrev(): boolean {
		const panel = tab()?.fkPanel
		if (!panel) return false
		return panel.currentRowIndex > 0 || panel.currentPage > 1
	}

	function fkPanelCanNext(): boolean {
		const panel = tab()?.fkPanel
		if (!panel) return false
		const totalPages = Math.max(1, Math.ceil(panel.totalCount / panel.pageSize))
		return panel.currentRowIndex < panel.rows.length - 1 || panel.currentPage < totalPages
	}

	function fkPanelPrev() {
		const panel = tab()?.fkPanel
		if (!panel) return
		if (panel.currentRowIndex > 0) {
			gridStore.fkPanelSetRowIndex(props.tabId, panel.currentRowIndex - 1)
		} else if (panel.currentPage > 1) {
			gridStore.fkPanelSetPage(props.tabId, panel.currentPage - 1)
		}
	}

	function fkPanelNext() {
		const panel = tab()?.fkPanel
		if (!panel) return
		if (panel.currentRowIndex < panel.rows.length - 1) {
			gridStore.fkPanelSetRowIndex(props.tabId, panel.currentRowIndex + 1)
		} else {
			const totalPages = Math.max(1, Math.ceil(panel.totalCount / panel.pageSize))
			if (panel.currentPage < totalPages) {
				gridStore.fkPanelSetPage(props.tabId, panel.currentPage + 1)
			}
		}
	}

	// ── Pending changes ──────────────────────────────────────

	function handleChangesApplied() {
		// Reload data from server after successful apply
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

	// ── Saved views ────────────────────────────────────────

	async function handleQuickSave() {
		const t = tab()
		if (!t?.activeViewId) {
			setSaveViewForceNew(false)
			setSaveViewOpen(true)
			return
		}
		try {
			const config = gridStore.captureViewConfig(props.tabId)
			const updated = await rpc.views.update({
				id: t.activeViewId,
				name: t.activeViewName!,
				config,
			})
			setSavedViewConfig(updated.config)
			tabsStore.setTabView(props.tabId, updated.id, updated.name)
			await viewsStore.refreshViews(props.connectionId)
		} catch {
			// Fall back to dialog on error
			setSaveViewOpen(true)
		}
	}

	async function handleResetView() {
		const config = savedViewConfig()
		if (!config) return
		await gridStore.applyViewConfig(props.tabId, config)
	}

	function handleSaveAsNew() {
		setSaveViewForceNew(true)
		setSaveViewOpen(true)
	}

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

	// ── FK navigation ─────────────────────────────────────

	function handleFkClick(rowIndex: number, column: string, anchorEl?: HTMLElement) {
		const t = tab()
		if (!t) return
		const target = fkMap().get(column)
		if (!target) return
		const value = t.rows[rowIndex]?.[column]
		if (value === null || value === undefined) return

		// Get anchor rect for popover positioning
		let anchorRect = { top: 200, left: 200, bottom: 220, right: 300 }
		if (anchorEl) {
			const r = anchorEl.getBoundingClientRect()
			anchorRect = { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
		}

		gridStore.openFkPeek(
			props.tabId,
			anchorRect,
			target.schema,
			target.table,
			target.column,
			value,
		)
	}

	function handlePkClick(rowIndex: number, _column: string, anchorEl?: HTMLElement) {
		let anchorRect = { top: 200, left: 200, bottom: 220, right: 300 }
		if (anchorEl) {
			const r = anchorEl.getBoundingClientRect()
			anchorRect = { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
		}
		gridStore.openPkPeek(props.tabId, rowIndex, anchorRect)
	}

	function handleDuplicateRow(rowIndex: number) {
		const t = tab()
		if (!t) return
		const sourceRow = t.rows[rowIndex]
		if (!sourceRow) return
		const newIndex = gridStore.addNewRow(props.tabId)
		for (const col of t.columns) {
			if (col.isPrimaryKey) continue
			const value = sourceRow[col.name]
			if (value !== null && value !== undefined) {
				gridStore.setCellValue(props.tabId, newIndex, col.name, value)
			}
		}
	}

	// ── Clipboard ──────────────────────────────────────────

	async function handleCopy() {
		const result = gridStore.buildClipboardTsv(props.tabId, visibleColumns())
		if (!result) return

		try {
			await navigator.clipboard.writeText(result.text)
			const msg = result.rowCount === 0
				? 'Copied cell'
				: `Copied ${result.rowCount} row${result.rowCount > 1 ? 's' : ''}`
			setCopyFeedback(msg)
			setTimeout(() => setCopyFeedback(null), COPY_FLASH_DURATION)
		} catch {
			// Clipboard API may fail in some contexts
		}
	}

	const PASTE_PREVIEW_THRESHOLD = 50

	async function handlePaste() {
		if (isReadOnly()) return
		const focused = getFocusedCellInfo()
		if (!focused) return

		let text: string
		try {
			text = await navigator.clipboard.readText()
		} catch {
			return // Clipboard API may fail
		}
		if (!text.trim()) return

		const parsed = parseClipboardText(text)
		if (parsed.rows.length === 0) return

		if (parsed.rows.length > PASTE_PREVIEW_THRESHOLD) {
			setPastePreview(parsed)
		} else {
			executePaste(parsed.rows, true)
		}
	}

	function executePaste(rows: string[][], treatNullText: boolean) {
		const focused = getFocusedCellInfo()
		if (!focused) return

		const data = rows.map((row) => row.map((cell) => cellValueToDbValue(cell, treatNullText)))
		gridStore.pasteCells(props.tabId, focused.row, focused.column, data)

		const msg = `Pasted ${rows.length} row${rows.length !== 1 ? 's' : ''}`
		setCopyFeedback(msg)
		setTimeout(() => setCopyFeedback(null), COPY_FLASH_DURATION)
	}

	function handlePastePreviewConfirm(treatNullText: boolean) {
		const preview = pastePreview()
		if (!preview) return
		executePaste(preview.rows, treatNullText)
		setPastePreview(null)
	}

	// ── Context menus ────────────────────────────────────────

	function handleGridContextMenu(e: MouseEvent) {
		const target = e.target as HTMLElement
		const cellEl = target.closest<HTMLElement>('[data-column]')
		if (!cellEl) return
		const columnName = cellEl.dataset.column
		if (!columnName) return

		const rowEl = target.closest<HTMLElement>('[data-row-index]')
		if (!rowEl) return
		const rowIndex = Number(rowEl.dataset.rowIndex)
		if (Number.isNaN(rowIndex)) return

		e.preventDefault()
		setHeaderContextMenu(null)

		// If right-clicked cell is outside selection, move selection to it
		const t = tab()
		if (t) {
			const cols = visibleColumns()
			const colIdx = cols.findIndex((c) => c.name === columnName)
			if (colIdx >= 0 && !isCellInSelection(t.selection, rowIndex, colIdx)) {
				gridStore.selectCell(props.tabId, rowIndex, colIdx)
			}
		}

		setCellContextMenu({
			x: e.clientX,
			y: e.clientY,
			rowIndex,
			column: columnName,
		})
	}

	function handleHeaderContextMenu(e: MouseEvent, column: string) {
		e.preventDefault()
		setCellContextMenu(null)
		setHeaderContextMenu({
			x: e.clientX,
			y: e.clientY,
			column,
		})
	}

	function closeContextMenus() {
		setCellContextMenu(null)
		setHeaderContextMenu(null)
	}

	// Listen for save-view events dispatched by the command registry
	onMount(() => {
		const onSaveView = (e: Event) => {
			const detail = (e as CustomEvent).detail
			if (detail?.tabId === props.tabId) {
				handleQuickSave()
			}
		}
		window.addEventListener('dotaz:save-view', onSaveView)
		onCleanup(() => window.removeEventListener('dotaz:save-view', onSaveView))
	})

	const handleKeyDown = createKeyHandler([
		{
			key: 'c',
			ctrl: true,
			shift: true,
			handler(e) {
				e.preventDefault()
				setAdvancedCopyOpen(true)
			},
		},
		{
			key: 'c',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				handleCopy()
			},
		},
		{
			key: 'v',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				handlePaste()
			},
		},
		{
			key: 'a',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.selectAll(props.tabId, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'ArrowUp',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.moveFocus(props.tabId, -1, 0, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'ArrowDown',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.moveFocus(props.tabId, 1, 0, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'ArrowLeft',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.moveFocus(props.tabId, 0, -1, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'ArrowRight',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.moveFocus(props.tabId, 0, 1, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'ArrowUp',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.extendFocus(props.tabId, -1, 0, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'ArrowDown',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.extendFocus(props.tabId, 1, 0, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'ArrowLeft',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.extendFocus(props.tabId, 0, -1, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'ArrowRight',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.extendFocus(props.tabId, 0, 1, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'Home',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					const focused = t.selection.focusedCell
					gridStore.selectCell(props.tabId, focused?.row ?? 0, 0)
				}
			},
		},
		{
			key: 'End',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					const focused = t.selection.focusedCell
					gridStore.selectCell(props.tabId, focused?.row ?? 0, visibleColumns().length - 1)
				}
			},
		},
		{
			key: 'Home',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				gridStore.selectCell(props.tabId, 0, 0)
			},
		},
		{
			key: 'End',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.selectCell(props.tabId, t.rows.length - 1, visibleColumns().length - 1)
			},
		},
		{
			key: 'Tab',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.moveFocus(props.tabId, 0, 1, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'Tab',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) gridStore.moveFocus(props.tabId, 0, -1, t.rows.length, visibleColumns().length)
			},
		},
		{
			key: 'F2',
			handler(e) {
				e.preventDefault()
				e.stopPropagation() // Prevent KeyboardManager double-fire
				startEditingFocused()
			},
		},
		{
			key: 'Insert',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				handleAddNewRow()
			},
		},
		{
			key: 'Delete',
			handler(e) {
				e.preventDefault()
				e.stopPropagation() // Prevent KeyboardManager double-fire
				handleDeleteSelected()
			},
		},
		{
			key: 'Enter',
			handler(e) {
				const t = tab()
				if (t?.editingCell) return // Don't open detail while inline editing
				if (t && t.selection.ranges.length > 0) {
					e.preventDefault()
					openRowDetail()
				}
			},
		},
		{
			key: 's',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				e.stopPropagation() // Prevent KeyboardManager double-fire
				handleQuickSave()
			},
		},
		{
			key: 'Escape',
			handler(e) {
				const t = tab()
				if (t?.editingCell) {
					e.preventDefault()
					handleCellCancel()
				}
			},
		},
	])

	const cellContextMenuItems = (): ContextMenuEntry[] => {
		const ctx = cellContextMenu()
		if (!ctx) return []
		const t = tab()
		if (!t) return []
		const { rowIndex, column } = ctx
		const row = t.rows[rowIndex]
		const value = row?.[column]
		const isDeleted = gridStore.isRowDeleted(props.tabId, rowIndex)

		const ro = isReadOnly()
		const items: ContextMenuEntry[] = [
			{
				label: 'Copy Value',
				action: async () => {
					await navigator.clipboard.writeText(
						gridStore.formatCellForClipboard(value),
					)
				},
			},
			{
				label: 'Copy Row',
				action: async () => {
					const cols = visibleColumns()
					const header = cols.map((c) => c.name).join('\t')
					const rowText = cols
						.map((c) => gridStore.formatCellForClipboard(row[c.name]))
						.join('\t')
					await navigator.clipboard.writeText(`${header}\n${rowText}`)
				},
			},
			{
				label: 'Advanced Copy...',
				action: () => setAdvancedCopyOpen(true),
			},
			{
				label: 'Paste',
				action: () => handlePaste(),
				disabled: isDeleted || ro,
			},
			'separator',
			{
				label: 'Edit Cell',
				action: () => gridStore.startEditing(props.tabId, rowIndex, column),
				disabled: isDeleted || ro,
			},
			{
				label: 'Set NULL',
				action: () => gridStore.setCellValue(props.tabId, rowIndex, column, null),
				disabled: isDeleted || ro,
			},
			'separator',
			{
				label: 'Filter by This Value',
				action: () => {
					const filterValue = value === null ? '' : String(value)
					const operator = value === null ? 'isNull' as const : 'eq' as const
					gridStore.setFilter(props.tabId, {
						column,
						operator,
						value: filterValue,
					})
				},
			},
			{
				label: 'Sort Ascending',
				action: () => gridStore.toggleSort(props.tabId, column, false),
			},
			{
				label: 'Sort Descending',
				action: () => {
					// Toggle twice: first to asc, then to desc
					const t = tab()
					const existing = t?.sort.find((s) => s.column === column)
					if (!existing || existing.direction === 'desc') {
						gridStore.toggleSort(props.tabId, column, false) // → asc
					}
					gridStore.toggleSort(props.tabId, column, false) // → desc
				},
			},
			'separator',
			{
				label: 'Row Detail',
				action: () => {
					gridStore.selectFullRow(props.tabId, rowIndex, visibleColumns().length)
					gridStore.closeFkPanel(props.tabId)
					setRowDetailIndex(rowIndex)
				},
			},
			{
				label: 'Open Row in Tab',
				action: () => {
					const pkCols = t.columns.filter((c) => c.isPrimaryKey)
					const pks: Record<string, unknown> = {}
					for (const pk of pkCols) {
						pks[pk.name] = row[pk.name]
					}
					tabsStore.openTab({
						type: 'row-detail',
						title: `${currentTable()} — ${Object.values(pks).join(', ')}`,
						connectionId: props.connectionId,
						schema: currentSchema(),
						table: currentTable(),
						database: props.database,
						primaryKeys: pks,
					})
				},
				disabled: t.columns.filter((c) => c.isPrimaryKey).length === 0 || gridStore.isRowNew(props.tabId, rowIndex),
			},
			{
				label: 'Delete Row',
				action: () => {
					gridStore.selectFullRow(props.tabId, rowIndex, visibleColumns().length)
					gridStore.deleteSelectedRows(props.tabId)
				},
				disabled: isDeleted || ro,
			},
			{
				label: 'Duplicate Row',
				action: () => handleDuplicateRow(rowIndex),
				disabled: ro,
			},
		]

		// FK-specific items
		const fkTarget = fkMap().get(column)
		if (fkTarget && value !== null && value !== undefined) {
			items.push('separator')
			items.push({
				label: 'Peek referenced row',
				action: () => handleFkClick(rowIndex, column),
			})
			items.push({
				label: `Open ${fkTarget.table} in Panel`,
				action: () => {
					setRowDetailIndex(null)
					gridStore.openFkPanel(
						props.tabId,
						fkTarget.schema,
						fkTarget.table,
						[{ column: fkTarget.column, operator: 'eq', value: String(value) }],
					)
				},
			})
			items.push({
				label: `Open ${fkTarget.table} in Tab`,
				action: () => {
					tabsStore.openTab({
						type: 'data-grid',
						title: fkTarget.table,
						connectionId: props.connectionId,
						schema: fkTarget.schema,
						table: fkTarget.table,
						database: props.database,
					})
				},
			})
		}

		return items
	}

	const headerContextMenuItems = (): ContextMenuEntry[] => {
		const ctx = headerContextMenu()
		if (!ctx) return []
		const { column } = ctx
		const t = tab()
		const pinned = t?.columnConfig[column]?.pinned
		const colDef = t?.columns.find((c: GridColumnDef) => c.name === column)
		const isNumeric = colDef ? isNumericType(colDef.dataType) : false
		const currentHeatmap = t?.heatmapColumns[column]

		const items: ContextMenuEntry[] = [
			{
				label: 'Sort Ascending',
				action: () => gridStore.toggleSort(props.tabId, column, false),
			},
			{
				label: 'Sort Descending',
				action: () => {
					const existing = t?.sort.find((s) => s.column === column)
					if (!existing || existing.direction === 'desc') {
						gridStore.toggleSort(props.tabId, column, false)
					}
					gridStore.toggleSort(props.tabId, column, false)
				},
			},
			'separator',
			{
				label: 'Hide Column',
				action: () => gridStore.setColumnVisibility(props.tabId, column, false),
			},
			'separator',
			{
				label: 'Pin Left',
				action: () => gridStore.setColumnPinned(props.tabId, column, 'left'),
				disabled: pinned === 'left',
			},
			{
				label: 'Pin Right',
				action: () => gridStore.setColumnPinned(props.tabId, column, 'right'),
				disabled: pinned === 'right',
			},
			...(pinned
				? [
					{
						label: 'Unpin',
						action: () => gridStore.setColumnPinned(props.tabId, column, undefined),
					} as ContextMenuEntry,
				]
				: []),
			'separator',
			{
				label: 'Filter by Column',
				action: () => {
					gridStore.setFilter(props.tabId, {
						column,
						operator: 'isNotNull',
						value: '',
					})
				},
			},
		]

		if (isNumeric) {
			items.push('separator')
			items.push({
				label: 'Heatmap: Sequential',
				action: () => gridStore.setHeatmap(props.tabId, column, 'sequential'),
				disabled: currentHeatmap === 'sequential',
			})
			items.push({
				label: 'Heatmap: Diverging',
				action: () => gridStore.setHeatmap(props.tabId, column, 'diverging'),
				disabled: currentHeatmap === 'diverging',
			})
			if (currentHeatmap) {
				items.push({
					label: 'Remove Heatmap',
					action: () => gridStore.removeHeatmap(props.tabId, column),
				})
			}
		}

		return items
	}

	return (
		<div
			ref={gridRef}
			class="data-grid"
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onContextMenu={handleGridContextMenu}
		>
			<div class="data-grid__toolbar">
				<Show when={tab()}>
					{(tabState) => (
						<>
							<div class="data-grid__view-actions">
								<Show
									when={hasActiveView()}
									fallback={
										<button
											class="data-grid__toolbar-btn"
											onClick={() => {
												setSaveViewForceNew(false)
												setSaveViewOpen(true)
											}}
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
												setExportInitialScope(undefined)
												setExportOpen(true)
												setMoreMenuOpen(false)
											}}
										>
											<Icon name="export" size={12} /> Export
										</button>
										<Show when={!isReadOnly()}>
											<button
												class="data-grid__more-item"
												onClick={() => {
													setImportOpen(true)
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
															schema: currentSchema(),
															table: currentTable(),
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
													title: `Schema — ${currentTable()}`,
													connectionId: props.connectionId,
													schema: currentSchema(),
													table: currentTable(),
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
											classList={{ 'data-grid__more-item--active': !!tabState().valueEditorOpen }}
											onClick={() => {
												gridStore.toggleValueEditor(props.tabId)
												setMoreMenuOpen(false)
											}}
										>
											<PanelRightOpen size={12} /> Value Editor
										</button>
									</div>
								</Show>
							</div>
						</>
					)}
				</Show>
			</div>

			<Show when={tab()}>
				{(tabState) => (
					<>
						<div class="data-grid__body">
							<div class="data-grid__main">
								<Show when={tabState().loading && tabState().rows.length === 0}>
									<div class="data-grid__skeleton">
										<div class="data-grid__skeleton-header">
											<div class="skeleton" style={{ width: '80px', height: '14px' }} />
											<div class="skeleton" style={{ width: '120px', height: '14px' }} />
											<div class="skeleton" style={{ width: '100px', height: '14px' }} />
											<div class="skeleton" style={{ width: '90px', height: '14px' }} />
											<div class="skeleton" style={{ width: '110px', height: '14px' }} />
										</div>
										{Array.from({ length: 8 }).map(() => (
											<div class="data-grid__skeleton-row">
												<div class="skeleton" style={{ width: '70px', height: '12px' }} />
												<div class="skeleton" style={{ width: '110px', height: '12px' }} />
												<div class="skeleton" style={{ width: '90px', height: '12px' }} />
												<div class="skeleton" style={{ width: '80px', height: '12px' }} />
												<div class="skeleton" style={{ width: '100px', height: '12px' }} />
											</div>
										))}
									</div>
								</Show>

								<div
									ref={scrollRef}
									class="data-grid__table-container"
									classList={{ 'data-grid__table-container--loading': tabState().loading }}
								>
									<Show
										when={tabState().transposed}
										fallback={
											<>
												<GridHeader
													columns={visibleColumns()}
													sort={tabState().sort}
													columnConfig={tabState().columnConfig}
													pinStyles={pinStyles()}
													fkColumns={fkColumns()}
													onToggleSort={handleToggleSort}
													onResizeColumn={handleResizeColumn}
													onHeaderContextMenu={handleHeaderContextMenu}
													onSelectAll={() => {
														const t = tab()
														if (t) gridStore.selectAll(props.tabId, t.rows.length, visibleColumns().length)
													}}
													onColumnSelect={(colIndex, e) => {
														const t = tab()
														if (!t) return
														if (e.shiftKey) {
															gridStore.selectFullColumnRange(props.tabId, colIndex, t.rows.length)
														} else if (e.ctrlKey || e.metaKey) {
															gridStore.toggleFullColumn(props.tabId, colIndex, t.rows.length)
														} else {
															gridStore.selectFullColumn(props.tabId, colIndex, t.rows.length)
														}
													}}
												/>

												<VirtualScroller
													scrollElement={() => scrollRef}
													rows={tabState().rows}
													columns={visibleColumns()}
													columnConfig={tabState().columnConfig}
													pinStyles={pinStyles()}
													selection={tabState().selection}
													scrollMargin={HEADER_HEIGHT}
													onRowMouseDown={handleRowMouseDown}
													onRowDblClick={handleRowDblClick}
													onRowNumberClick={handleRowNumberClick}
													editingCell={tabState().editingCell}
													getChangedCells={getChangedCells}
													isRowDeleted={(idx) => gridStore.isRowDeleted(props.tabId, idx)}
													isRowNew={(idx) => gridStore.isRowNew(props.tabId, idx)}
													fkMap={fkMap()}
													heatmapInfo={heatmapInfo()}
													onCellSave={handleCellSave}
													onCellCancel={handleCellCancel}
													onCellMoveNext={handleCellMoveNext}
													onCellMoveDown={handleCellMoveDown}
													onFkClick={handleFkClick}
													onPkClick={handlePkClick}
												/>
											</>
										}
									>
										<TransposedGrid
											rows={tabState().rows}
											columns={visibleColumns()}
											columnConfig={tabState().columnConfig}
											selection={tabState().selection}
											onRowMouseDown={handleRowMouseDown}
											onRowDblClick={handleRowDblClick}
											editingCell={tabState().editingCell}
											getChangedCells={getChangedCells}
											isRowDeleted={(idx) => gridStore.isRowDeleted(props.tabId, idx)}
											isRowNew={(idx) => gridStore.isRowNew(props.tabId, idx)}
											fkMap={fkMap()}
											heatmapInfo={heatmapInfo()}
											onCellSave={handleCellSave}
											onCellCancel={handleCellCancel}
											onCellMoveNext={handleCellMoveNext}
											onCellMoveDown={handleCellMoveDown}
											onFkClick={handleFkClick}
											onPkClick={handlePkClick}
										/>
									</Show>

									<Show when={!tabState().loading && tabState().rows.length === 0}>
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
									</Show>
								</div>
							</div>

							<Show when={tabState().valueEditorOpen && tabState().selection.focusedCell}>
								{(_) => {
									const focusedSel = () => tabState().selection.focusedCell!
									const focused = () => {
										const fc = focusedSel()
										const col = visibleColumns()[fc.col]
										return { row: fc.row, column: col?.name ?? '' }
									}
									const col = () => visibleColumns().find((c) => c.name === focused().column) ?? tabState().columns.find((c) => c.name === focused().column)
									const cellValue = () => tabState().rows[focused().row]?.[focused().column]
									return (
										<Show when={col()}>
											{(column) => (
												<ValueEditorPanel
													value={cellValue()}
													column={column()}
													rowIndex={focused().row}
													width={tabState().valueEditorWidth}
													readOnly={isReadOnly()}
													onSave={(value) => {
														gridStore.setCellValue(props.tabId, focused().row, focused().column, value)
													}}
													onResize={(delta) => {
														gridStore.setValueEditorWidth(props.tabId, tabState().valueEditorWidth + delta)
													}}
													onClose={() => gridStore.toggleValueEditor(props.tabId)}
												/>
											)}
										</Show>
									)
								}}
							</Show>

							<Show when={tabState().fkPanel}>
								{(panel) => (
									<RowDetailPanel
										connectionId={props.connectionId}
										schema={panel().schema}
										table={panel().table}
										database={props.database}
										columns={panel().columns}
										row={panel().rows[panel().currentRowIndex] ?? null}
										foreignKeys={panel().foreignKeys}
										width={panel().width}
										loading={panel().loading}
										readOnly={isReadOnly()}
										rowLabel={fkPanelRowLabel()}
										canGoPrev={fkPanelCanPrev()}
										canGoNext={fkPanelCanNext()}
										onPrev={fkPanelPrev}
										onNext={fkPanelNext}
										breadcrumbs={panel().breadcrumbs}
										onBack={() => gridStore.fkPanelBack(props.tabId)}
										onSave={handleFkPanelSave}
										onFkNavigate={(schema, table, column, value) => {
											gridStore.fkPanelNavigate(props.tabId, schema, table, column, value)
										}}
										onReferencingNavigate={(schema, table, filters) => {
											const newTabId = tabsStore.openTab({
												type: 'data-grid',
												title: table,
												connectionId: props.connectionId,
												schema,
												table,
												database: props.database,
											})
											gridStore.loadTableData(newTabId, props.connectionId, schema, table, props.database).then(() => {
												for (const f of filters) {
													gridStore.setFilter(newTabId, f)
												}
											})
										}}
										onOpenInTab={fkPanelOpenInTab}
										subtitle={fkPanelSubtitle()}
										onClose={() => gridStore.closeFkPanel(props.tabId)}
										onResize={(delta) => {
											gridStore.fkPanelResize(props.tabId, (panel().width ?? 500) + delta)
										}}
									/>
								)}
							</Show>

							<Show when={rowDetailIndex() !== null && !tabState().fkPanel}>
								{(_) => {
									const t = tab()!
									const idx = () => rowDetailIndex()!
									return (
										<RowDetailPanel
											connectionId={props.connectionId}
											schema={currentSchema()}
											table={currentTable()}
											database={props.database}
											columns={t.columns}
											row={t.rows[idx()] ?? null}
											foreignKeys={foreignKeys()}
											width={rowDetailWidth()}
											readOnly={isReadOnly()}
											rowLabel={`Row ${idx() + 1} of ${t.rows.length}`}
											canGoPrev={idx() > 0}
											canGoNext={idx() < t.rows.length - 1}
											onPrev={() => handleRowDetailNavigate('prev')}
											onNext={() => handleRowDetailNavigate('next')}
											onSave={handleRowDetailSave}
											pendingChangedColumns={rowDetailPendingColumns()}
											onReferencingNavigate={(schema, table, filters) => {
												const newTabId = tabsStore.openTab({
													type: 'data-grid',
													title: table,
													connectionId: props.connectionId,
													schema,
													table,
													database: props.database,
												})
												gridStore.loadTableData(newTabId, props.connectionId, schema, table, props.database).then(() => {
													for (const f of filters) {
														gridStore.setFilter(newTabId, f)
													}
												})
											}}
											onOpenInTab={rowDetailOpenInTab}
											subtitle={rowDetailSubtitle()}
											onClose={handleRowDetailClose}
											onResize={(delta) => {
												setRowDetailWidth((w) => Math.min(1200, Math.max(250, w + delta)))
											}}
										/>
									)
								}}
							</Show>
						</div>

						<Show when={getSelectedRowIndices(tabState().selection).length >= 2}>
							<div class="data-grid__selection-bar">
								<div class="data-grid__selection-bar-info">
									<Check size={12} />
									<span>{getSelectedRowIndices(tabState().selection).length} rows selected</span>
								</div>
								<div class="data-grid__selection-bar-actions">
									<Show when={!isReadOnly()}>
										<button
											class="data-grid__pending-bar-btn"
											onClick={() => gridStore.deleteSelectedRows(props.tabId)}
										>
											Delete
										</button>
									</Show>
									<button
										class="data-grid__pending-bar-btn"
										onClick={() => setShowStatsModal(true)}
									>
										Stats
									</button>
									<button
										class="data-grid__pending-bar-btn"
										onClick={() => {
											setExportInitialScope('selected')
											setExportOpen(true)
										}}
									>
										Export
									</button>
									<Show when={!isReadOnly()}>
										<button
											class="data-grid__pending-bar-btn"
											onClick={() => setShowBatchEdit(true)}
										>
											Batch Edit
										</button>
									</Show>
								</div>
							</div>
						</Show>

						<Show when={gridStore.hasPendingChanges(props.tabId)}>
							<div class="data-grid__pending-bar">
								<div class="data-grid__pending-bar-info">
									<Pencil size={12} />
									<span>{gridStore.pendingChangesCount(props.tabId)} pending change{gridStore.pendingChangesCount(props.tabId) !== 1 ? 's' : ''}</span>
								</div>
								<Show when={saveError()}>
									<span class="data-grid__pending-bar-error" title={saveError()!}>{saveError()}</span>
								</Show>
								<div class="data-grid__pending-bar-actions">
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
								loading={tabState().loading}
								lastLoadedAt={tabState().lastLoadedAt}
								fetchDuration={tabState().fetchDuration}
								onPageChange={(page) => gridStore.setPage(props.tabId, page)}
								onPageSizeChange={(size) => gridStore.setPageSize(props.tabId, size)}
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
				)}
			</Show>

			<Show when={copyFeedback()}>
				<div class="data-grid__copy-toast">{copyFeedback()}</div>
			</Show>

			<Show when={tab()?.fkPeek}>
				{(peek) => (
					<FkPeekPopover
						peek={peek()}
						onClose={() => gridStore.closeFkPeek(props.tabId)}
						onNavigate={(schema, table, column, value) => {
							gridStore.fkPeekNavigate(props.tabId, schema, table, column, value)
						}}
						onBack={() => gridStore.fkPeekBack(props.tabId)}
						onOpenInPanel={() => {
							const p = peek()
							const bc = p.breadcrumbs[p.breadcrumbs.length - 1]
							if (!bc) return

							// PK peek: breadcrumbs has 1 entry with empty column — open row detail
							if (p.breadcrumbs.length === 1 && !bc.column) {
								const t = tab()
								if (!t || !p.rows[0]) return
								const pkRow = p.rows[0]
								const rowIdx = t.rows.findIndex((r) =>
									t.columns.every((c) => c.isPrimaryKey ? r[c.name] === pkRow[c.name] : true),
								)
								if (rowIdx >= 0) {
									gridStore.closeFkPeek(props.tabId)
									setRowDetailIndex(rowIdx)
								}
								return
							}

							setRowDetailIndex(null)
							gridStore.openFkPanel(
								props.tabId,
								p.schema,
								p.table,
								[{ column: bc.column, operator: 'eq' as const, value: String(bc.value) }],
							)
						}}
						onOpenInTab={() => {
							const p = peek()
							const bc = p.breadcrumbs[p.breadcrumbs.length - 1]
							if (!bc) return

							// PK peek: open row-detail tab
							if (p.breadcrumbs.length === 1 && !bc.column && p.rows[0]) {
								const row = p.rows[0]
								const pkCols = p.columns.filter((c) => c.isPrimaryKey)
								if (pkCols.length > 0) {
									const pks: Record<string, unknown> = {}
									for (const pk of pkCols) {
										if (row[pk.name] === null || row[pk.name] === undefined) return
										pks[pk.name] = row[pk.name]
									}
									tabsStore.openTab({
										type: 'row-detail',
										title: `${p.table} — ${Object.values(pks).join(', ')}`,
										connectionId: props.connectionId,
										schema: p.schema,
										table: p.table,
										database: props.database,
										primaryKeys: pks,
									})
								}
								gridStore.closeFkPeek(props.tabId)
								return
							}

							const newTabId = tabsStore.openTab({
								type: 'data-grid',
								title: p.table,
								connectionId: props.connectionId,
								schema: p.schema,
								table: p.table,
								database: props.database,
							})
							gridStore.closeFkPeek(props.tabId)
							gridStore.loadTableData(
								newTabId,
								props.connectionId,
								p.schema,
								p.table,
								props.database,
							).then(() => {
								gridStore.setFilter(newTabId, { column: bc.column, operator: 'eq', value: String(bc.value) })
							})
						}}
					/>
				)}
			</Show>


			<SaveViewDialog
				open={saveViewOpen()}
				tabId={props.tabId}
				connectionId={props.connectionId}
				schema={currentSchema()}
				table={currentTable()}
				initialName={hasActiveView() ? undefined : generateAutoName()}
				forceNew={saveViewForceNew()}
				onClose={() => setSaveViewOpen(false)}
				onSaved={async (viewId, viewName, config) => {
					tabsStore.setTabView(props.tabId, viewId, viewName)
					gridStore.setActiveView(props.tabId, viewId, viewName)
					setSavedViewConfig(config)
					await viewsStore.refreshViews(props.connectionId)
				}}
			/>

			<ExportDialog
				open={exportOpen()}
				tabId={props.tabId}
				connectionId={props.connectionId}
				schema={currentSchema()}
				table={currentTable()}
				database={props.database}
				initialScope={exportInitialScope()}
				onClose={() => setExportOpen(false)}
			/>

			<AdvancedCopyDialog
				open={advancedCopyOpen()}
				tabId={props.tabId}
				visibleColumns={visibleColumns()}
				onClose={() => setAdvancedCopyOpen(false)}
			/>

			<ImportDialog
				open={importOpen()}
				connectionId={props.connectionId}
				schema={currentSchema()}
				table={currentTable()}
				database={props.database}
				onClose={() => setImportOpen(false)}
				onImported={() => {
					gridStore.refreshData(props.tabId)
				}}
			/>

			<Show when={showStatsModal()}>
				{(_) => {
					const cellData = () => gridStore.getSelectedCellData(props.tabId)
					return (
						<Show when={cellData()}>
							{(data) => (
								<Dialog
									open={true}
									title="Selection Statistics"
									onClose={() => setShowStatsModal(false)}
								>
									<AggregatePanel
										rows={data().rows}
										columns={data().columns}
										visibleColumns={visibleColumns()}
									/>
								</Dialog>
							)}
						</Show>
					)
				}}
			</Show>

			<Show when={showBatchEdit()}>
				{(_) => {
					const t = tab()!
					return (
						<BatchEditDialog
							open={true}
							tabId={props.tabId}
							columns={t.columns}
							selectedRows={new Set(getSelectedRowIndices(t.selection))}
							onClose={() => setShowBatchEdit(false)}
						/>
					)
				}}
			</Show>

			<Show when={pastePreview()}>
				{(preview) => {
					const t = tab()!
					return (
						<PastePreviewDialog
							open={true}
							parsedRows={preview().rows}
							delimiter={preview().delimiter}
							columns={visibleColumns()}
							startColumn={visibleColumns()[t.selection.focusedCell?.col ?? 0]?.name ?? ''}
							startRow={t.selection.focusedCell?.row ?? 0}
							totalExistingRows={t.rows.length}
							onConfirm={handlePastePreviewConfirm}
							onClose={() => setPastePreview(null)}
						/>
					)
				}}
			</Show>

			<Show when={cellContextMenu()}>
				{(ctx) => (
					<ContextMenu
						x={ctx().x}
						y={ctx().y}
						items={cellContextMenuItems()}
						onClose={closeContextMenus}
					/>
				)}
			</Show>

			<Show when={headerContextMenu()}>
				{(ctx) => (
					<ContextMenu
						x={ctx().x}
						y={ctx().y}
						items={headerContextMenuItems()}
						onClose={closeContextMenus}
					/>
				)}
			</Show>
		</div>
	)
}
