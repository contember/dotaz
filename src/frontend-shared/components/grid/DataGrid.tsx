import Check from 'lucide-solid/icons/check'
import PanelRight from 'lucide-solid/icons/panel-right'
import Pencil from 'lucide-solid/icons/pencil'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from 'solid-js'
import type { ForeignKeyInfo } from '../../../shared/types/database'
import type { SavedViewConfig } from '../../../shared/types/rpc'
import { cellValueToDbValue, parseClipboardText } from '../../lib/clipboard-paste'
import { createKeyHandler } from '../../lib/keyboard'
import { HEADER_HEIGHT } from '../../lib/layout-constants'
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
import type { DataGridContextMenuHandle } from './DataGridContextMenu'
import DataGridContextMenu from './DataGridContextMenu'
import type { DataGridSidePanelHandle } from './DataGridSidePanel'
import DataGridSidePanel from './DataGridSidePanel'
import DataGridToolbar from './DataGridToolbar'
import GridHeader from './GridHeader'
import Pagination from './Pagination'
import PastePreviewDialog from './PastePreviewDialog'
import TransposedGrid from './TransposedGrid'
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
	const [showBatchEdit, setShowBatchEdit] = createSignal(false)
	const [fkPickerOpen, setFkPickerOpen] = createSignal(false)
	const [fkPickerContext, setFkPickerContext] = createSignal<
		{
			rowIndex: number
			column: string
			target: FkTarget
		} | null
	>(null)
	const [exportInitialScope, setExportInitialScope] = createSignal<
		'selected' | undefined
	>(undefined)
	const [saveViewForceNew, setSaveViewForceNew] = createSignal(false)
	const [savedViewConfig, setSavedViewConfig] = createSignal<SavedViewConfig | null>(null)

	let scrollRef: HTMLDivElement | undefined
	let gridRef: HTMLDivElement | undefined
	let isDragging = false
	let dragCtrl = false

	const [sidePanelHandle, setSidePanelHandle] = createSignal<
		DataGridSidePanelHandle | undefined
	>()
	let contextMenuHandle: DataGridContextMenuHandle | undefined

	const tab = () => gridStore.getTab(props.tabId)
	const tabInfo = () => tabsStore.openTabs.find((t) => t.id === props.tabId)
	const isReadOnly = () => connectionsStore.isReadOnly(props.connectionId)

	const currentSchema = () => tab()?.schema ?? props.schema
	const currentTable = () => tab()?.table ?? props.table

	const hasActiveView = () => !!tab()?.activeViewId

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

	// ── Mouse handling ──────────────────────────────────

	function handleToggleSort(column: string, multi: boolean) {
		gridStore.toggleSort(props.tabId, column, multi)
	}

	function handleResizeColumn(column: string, width: number) {
		gridStore.setColumnWidth(props.tabId, column, width)
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

	function resolveCellFromPoint(
		x: number,
		y: number,
	): { row: number; col: number } | null {
		const el = document.elementFromPoint(x, y)
		if (!el) return null
		const rowEl = (el as HTMLElement).closest<HTMLElement>('[data-row-index]')
		if (!rowEl) return null
		const row = parseInt(rowEl.dataset.rowIndex!, 10)
		if (Number.isNaN(row)) return null
		const cellEl = (el as HTMLElement).closest<HTMLElement>('[data-column]')
		const columnName = cellEl?.dataset.column ?? null
		if (!columnName) return { row, col: 0 }
		const cols = visibleColumns()
		const idx = cols.findIndex((c) => c.name === columnName)
		return { row, col: idx >= 0 ? idx : 0 }
	}

	function handleRowMouseDown(index: number, e: MouseEvent) {
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
			gridStore.closeFkPanel(props.tabId)
			sidePanelHandle()?.setSidePanelOpen(true)
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

	function handleBrowseFkForInline(rowIndex: number, column: string) {
		const target = fkMap().get(column)
		if (!target) return
		gridStore.stopEditing(props.tabId)
		setFkPickerContext({ rowIndex, column, target })
		setFkPickerOpen(true)
	}

	function handleFkPickerSelect(value: unknown) {
		const ctx = fkPickerContext()
		if (!ctx) return
		gridStore.setCellValue(props.tabId, ctx.rowIndex, ctx.column, value)
		setFkPickerOpen(false)
		setFkPickerContext(null)
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

	// ── Clipboard ──────────────────────────────────────

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
			return
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

	// Listen for save-view events dispatched by the command registry
	onMount(() => {
		const onSaveView = (e: Event) => {
			const detail = (e as CustomEvent).detail
			if (detail?.tabId === props.tabId) {
				// Quick save via toolbar handler
				setSaveViewForceNew(false)
				setSaveViewOpen(true)
			}
		}
		window.addEventListener('dotaz:save-view', onSaveView)
		onCleanup(() => window.removeEventListener('dotaz:save-view', onSaveView))
	})

	// ── Keyboard shortcuts ────────────────────────────

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
				if (t) {
					gridStore.selectAll(
						props.tabId,
						t.rows.length,
						visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowUp',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						props.tabId,
						-1,
						0,
						t.rows.length,
						visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowDown',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						props.tabId,
						1,
						0,
						t.rows.length,
						visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowLeft',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						props.tabId,
						0,
						-1,
						t.rows.length,
						visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowRight',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						props.tabId,
						0,
						1,
						t.rows.length,
						visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowUp',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.extendFocus(
						props.tabId,
						-1,
						0,
						t.rows.length,
						visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowDown',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.extendFocus(
						props.tabId,
						1,
						0,
						t.rows.length,
						visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowLeft',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.extendFocus(
						props.tabId,
						0,
						-1,
						t.rows.length,
						visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'ArrowRight',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.extendFocus(
						props.tabId,
						0,
						1,
						t.rows.length,
						visibleColumns().length,
					)
				}
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
					gridStore.selectCell(
						props.tabId,
						focused?.row ?? 0,
						visibleColumns().length - 1,
					)
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
				if (t) {
					gridStore.selectCell(
						props.tabId,
						t.rows.length - 1,
						visibleColumns().length - 1,
					)
				}
			},
		},
		{
			key: 'Tab',
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						props.tabId,
						0,
						1,
						t.rows.length,
						visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'Tab',
			shift: true,
			handler(e) {
				e.preventDefault()
				const t = tab()
				if (t) {
					gridStore.moveFocus(
						props.tabId,
						0,
						-1,
						t.rows.length,
						visibleColumns().length,
					)
				}
			},
		},
		{
			key: 'F2',
			handler(e) {
				e.preventDefault()
				e.stopPropagation()
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
				e.stopPropagation()
				handleDeleteSelected()
			},
		},
		{
			key: 'Enter',
			handler(e) {
				const t = tab()
				if (t?.editingCell) return
				if (t && t.selection.ranges.length > 0) {
					e.preventDefault()
					sidePanelHandle()?.openForSelection()
				}
			},
		},
		{
			key: 's',
			ctrl: true,
			handler(e) {
				e.preventDefault()
				e.stopPropagation()
				setSaveViewForceNew(false)
				setSaveViewOpen(true)
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

	return (
		<div
			ref={gridRef}
			class="data-grid"
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onContextMenu={(e) => contextMenuHandle?.handleGridContextMenu(e)}
		>
			<DataGridToolbar
				tabId={props.tabId}
				connectionId={props.connectionId}
				currentSchema={currentSchema}
				currentTable={currentTable}
				database={props.database}
				isReadOnly={isReadOnly}
				savedViewConfig={savedViewConfig}
				onSetSavedViewConfig={setSavedViewConfig}
				onSaveViewOpen={(forceNew) => {
					setSaveViewForceNew(forceNew)
					setSaveViewOpen(true)
				}}
				onExportOpen={() => {
					setExportInitialScope(undefined)
					setExportOpen(true)
				}}
				onImportOpen={() => setImportOpen(true)}
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

									<div
										ref={scrollRef}
										class="data-grid__table-container"
										classList={{
											'data-grid__table-container--loading': tabState().loading,
										}}
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
														onHeaderContextMenu={(e, col) => contextMenuHandle?.handleHeaderContextMenu(e, col)}
														onSelectAll={() => {
															const t = tab()
															if (t) {
																gridStore.selectAll(
																	props.tabId,
																	t.rows.length,
																	visibleColumns().length,
																)
															}
														}}
														onColumnSelect={(colIndex, e) => {
															const t = tab()
															if (!t) return
															if (e.shiftKey) {
																gridStore.selectFullColumnRange(
																	props.tabId,
																	colIndex,
																	t.rows.length,
																)
															} else if (e.ctrlKey || e.metaKey) {
																gridStore.toggleFullColumn(
																	props.tabId,
																	colIndex,
																	t.rows.length,
																)
															} else {
																gridStore.selectFullColumn(
																	props.tabId,
																	colIndex,
																	t.rows.length,
																)
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
														onFkClick={(rowIndex, column, anchorEl) =>
															sidePanelHandle()?.handleFkClick(
																rowIndex,
																column,
																anchorEl,
															)}
														onPkClick={(rowIndex, column, anchorEl) =>
															sidePanelHandle()?.handlePkClick(
																rowIndex,
																column,
																anchorEl,
															)}
														onCellBrowseFk={handleBrowseFkForInline}
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
												onFkClick={(rowIndex, column, anchorEl) =>
													sidePanelHandle()?.handleFkClick(
														rowIndex,
														column,
														anchorEl,
													)}
												onPkClick={(rowIndex, column, anchorEl) =>
													sidePanelHandle()?.handlePkClick(
														rowIndex,
														column,
														anchorEl,
													)}
												onCellBrowseFk={handleBrowseFkForInline}
											/>
										</Show>

										<Show
											when={!tabState().loading && tabState().rows.length === 0}
										>
											<div
												class="empty-state"
												style={{ 'padding-top': '48px' }}
											>
												<Icon
													name="table"
													size={32}
													class="empty-state__icon"
												/>
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

								<DataGridSidePanel
									ref={(h) => {
										setSidePanelHandle(h)
									}}
									tabId={props.tabId}
									connectionId={props.connectionId}
									currentSchema={currentSchema()}
									currentTable={currentTable()}
									database={props.database}
									foreignKeys={foreignKeys}
									fkMap={fkMap}
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
										setExportInitialScope('selected')
										setExportOpen(true)
									}}
									onBatchEdit={() => setShowBatchEdit(true)}
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

			<Show when={copyFeedback()}>
				<div class="data-grid__copy-toast">{copyFeedback()}</div>
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

			<Show when={showBatchEdit()}>
				{(_) => {
					const t = tab()!
					return (
						<BatchEditDialog
							open={true}
							tabId={props.tabId}
							columns={t.columns}
							selectedRows={new Set(getSelectedRowIndices(t.selection))}
							fkMap={fkMap()}
							connectionId={props.connectionId}
							database={props.database}
							onClose={() => setShowBatchEdit(false)}
						/>
					)
				}}
			</Show>

			<Show when={pastePreview()}>
				{(_) => {
					const t = tab()!
					const p = pastePreview()!
					return (
						<PastePreviewDialog
							open={true}
							parsedRows={p.rows}
							delimiter={p.delimiter}
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

			<DataGridContextMenu
				ref={(h) => {
					contextMenuHandle = h
				}}
				tabId={props.tabId}
				connectionId={props.connectionId}
				currentSchema={currentSchema}
				currentTable={currentTable}
				database={props.database}
				fkMap={fkMap}
				visibleColumns={visibleColumns}
				isReadOnly={isReadOnly}
				onPaste={handlePaste}
				onAdvancedCopy={() => setAdvancedCopyOpen(true)}
				onDuplicateRow={handleDuplicateRow}
				onFkClick={(rowIndex, column) => sidePanelHandle()?.handleFkClick(rowIndex, column)}
				onSetSidePanelOpen={(open) => sidePanelHandle()?.setSidePanelOpen(open)}
			/>

			<Show when={fkPickerOpen() && fkPickerContext()}>
				{(_) => {
					const ctx = fkPickerContext()!
					return (
						<FkPickerModal
							open={true}
							onClose={() => {
								setFkPickerOpen(false)
								setFkPickerContext(null)
							}}
							onSelect={handleFkPickerSelect}
							connectionId={props.connectionId}
							schema={ctx.target.schema}
							table={ctx.target.table}
							column={ctx.target.column}
							database={props.database}
						/>
					)
				}}
			</Show>
		</div>
	)
}
