import type { GridColumnDef, SortColumn } from '@dotaz/shared/types/grid'
import { type JSX, Show } from 'solid-js'
import {
	applyAddCellRange,
	applyExtendLastRange,
	applyExtendSelection,
	applySelectAll,
	applySelectCell,
	applySelectFullColumn,
	applySelectFullColumnRange,
	applySelectFullRow,
	applySelectFullRowRange,
	applyToggleFullColumn,
	applyToggleFullRow,
	type CellSelection,
} from '../../lib/grid-selection'
import type { ColumnConfig, EditingCell, FkTarget, HeatmapInfo } from '../../stores/grid'
import { computePinStyles } from '../../stores/gridColumns'
import type { ContextMenuEntry } from '../common/ContextMenu'
import GridHeader from './GridHeader'
import GridShell, { useGridShell } from './GridShell'
import VirtualScroller from './VirtualScroller'
import './GridView.css'

const HEADER_HEIGHT = 34

// ── Editing adapter ──────────────────────────────────────

export interface GridViewEditing {
	editingCell: EditingCell | null
	/** Whether a given column accepts edits. Defaults to true if omitted. */
	isEditable?: (column: string) => boolean
	onStart: (rowIndex: number, column: string, initialValue?: unknown) => void
	onSave: (rowIndex: number, column: string, value: unknown) => void
	onCancel: () => void
	onMoveNext: (rowIndex: number, column: string) => void
	onMoveDown: (rowIndex: number, column: string) => void
	isCellChanged?: (rowIndex: number, column: string) => boolean
	isRowDeleted?: (rowIndex: number) => boolean
	isRowNew?: (rowIndex: number) => boolean
	onDeleteSelected?: () => void
	onPaste?: () => void
	onBrowseFk?: (rowIndex: number, column: string) => void
}

// ── Component ────────────────────────────────────────────

export interface GridViewProps {
	rows: Record<string, unknown>[]
	columns: GridColumnDef[]

	selection: CellSelection
	onSelectionChange: (sel: CellSelection) => void

	columnConfig: Record<string, ColumnConfig>
	onResizeColumn?: (column: string, width: number) => void

	sort?: SortColumn[]
	onToggleSort?: (column: string, multi: boolean) => void

	editing?: GridViewEditing

	fkColumns?: Set<string>
	fkMap?: Map<string, FkTarget>
	heatmapInfo?: Map<string, HeatmapInfo>
	getRowColor?: (rowIndex: number) => string | undefined
	onFkClick?: (rowIndex: number, column: string, anchor?: HTMLElement) => void
	onPkClick?: (rowIndex: number, column: string, anchor?: HTMLElement) => void

	/** Live mode: 0..1 highlight intensity per cell (yellow flash). */
	getLiveCellIntensity?: (rowIndex: number, column: string) => number
	/** Live mode: 0..1 highlight intensity for "row is new" (green flash). */
	getLiveRowNewIntensity?: (rowIndex: number) => number
	/**
	 * Reactive signal that ticks each time the live-change ledger updates.
	 * Components read it inside memos so Solid re-evaluates intensity.
	 */
	liveTick?: () => number

	/** Returns context menu entries for a right-clicked cell. Return null/undefined for no menu. */
	getCellContextMenu?: (ctx: { rowIndex: number; column: string }) => ContextMenuEntry[] | null
	/** Returns context menu entries for a right-clicked column header. */
	getHeaderContextMenu?: (ctx: { column: string }) => ContextMenuEntry[] | null

	/** Custom row-number click (defaults to selecting the full row). */
	onRowNumberClick?: (rowIndex: number, e: MouseEvent) => void
	/** Custom Enter behavior (defaults to no-op). */
	onActivateSelection?: () => void
	/** Custom Save view shortcut (Ctrl+S). */
	onSaveShortcut?: () => void
	/** Custom Advanced Copy shortcut (Ctrl+Shift+C). */
	onAdvancedCopyShortcut?: () => void

	emptyState?: JSX.Element
	loading?: boolean
	class?: string
}

export default function GridView(props: GridViewProps) {
	return (
		<GridShell
			rows={props.rows}
			columns={props.columns}
			selection={props.selection}
			onSelectionChange={props.onSelectionChange}
			editing={props.editing}
			getCellContextMenu={props.getCellContextMenu}
			getHeaderContextMenu={props.getHeaderContextMenu}
			onActivateSelection={props.onActivateSelection}
			onSaveShortcut={props.onSaveShortcut}
			onAdvancedCopyShortcut={props.onAdvancedCopyShortcut}
			class={props.class}
		>
			<GridViewBody {...props} />
		</GridShell>
	)
}

function GridViewBody(props: GridViewProps) {
	let scrollRef: HTMLDivElement | undefined
	let isDragging = false
	let dragCtrl = false

	const shell = useGridShell()
	const totalRows = () => props.rows.length
	const totalCols = () => props.columns.length
	const pinStyles = () => computePinStyles(props.columns, props.columnConfig)

	function commit(sel: CellSelection) {
		props.onSelectionChange(sel)
	}

	function commitOrSkip(sel: CellSelection | null) {
		if (sel) commit(sel)
	}

	// ── Mouse handling ───────────────────────────────────

	function resolveColIndex(e: MouseEvent): number {
		const target = e.target as HTMLElement
		const cellEl = target.closest<HTMLElement>('[data-column]')
		const columnName = cellEl?.dataset.column ?? null
		if (!columnName) return 0
		const idx = props.columns.findIndex((c) => c.name === columnName)
		return idx >= 0 ? idx : 0
	}

	function resolveCellFromPoint(x: number, y: number): { row: number; col: number } | null {
		const el = document.elementFromPoint(x, y)
		if (!el) return null
		const rowEl = (el as HTMLElement).closest<HTMLElement>('[data-row-index]')
		if (!rowEl) return null
		const row = parseInt(rowEl.dataset.rowIndex!, 10)
		if (Number.isNaN(row)) return null
		const cellEl = (el as HTMLElement).closest<HTMLElement>('[data-column]')
		const columnName = cellEl?.dataset.column ?? null
		if (!columnName) return { row, col: 0 }
		const idx = props.columns.findIndex((c) => c.name === columnName)
		return { row, col: idx >= 0 ? idx : 0 }
	}

	function focusGrid(e: MouseEvent) {
		const root = (e.currentTarget as HTMLElement | null)?.closest<HTMLElement>('.grid-view')
		root?.focus()
	}

	function handleRowMouseDown(index: number, e: MouseEvent) {
		if (e.button !== 0) return
		// Don't hijack clicks inside an open inline editor.
		const target = e.target as Element | null
		if (target?.closest('.inline-editor')) return
		const colIdx = resolveColIndex(e)
		const sel = props.selection

		if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
			commit(applyExtendLastRange(sel, index, colIdx))
			e.preventDefault()
			focusGrid(e)
			return
		} else if (e.shiftKey) {
			commit(applyExtendSelection(sel, index, colIdx))
			e.preventDefault()
			focusGrid(e)
			return
		} else if (e.ctrlKey || e.metaKey) {
			commit(applyAddCellRange(sel, index, colIdx))
			dragCtrl = true
		} else {
			commit(applySelectCell(index, colIdx))
		}

		e.preventDefault()
		focusGrid(e)
		isDragging = true

		const onMouseMove = (ev: MouseEvent) => {
			if (!isDragging) return
			ev.preventDefault()
			const cell = resolveCellFromPoint(ev.clientX, ev.clientY)
			if (!cell) return
			const current = props.selection
			if (dragCtrl) {
				commit(applyExtendLastRange(current, cell.row, cell.col))
			} else {
				commit(applyExtendSelection(current, cell.row, cell.col))
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
		if (props.onRowNumberClick) {
			props.onRowNumberClick(index, e)
			return
		}
		const cols = totalCols()
		if (e.shiftKey) {
			commit(applySelectFullRowRange(props.selection, index, index, cols))
		} else if (e.ctrlKey || e.metaKey) {
			commit(applyToggleFullRow(props.selection, index, cols))
		} else {
			commit(applySelectFullRow(index, cols))
		}
	}

	function handleRowDblClick(index: number, e: MouseEvent) {
		const ed = props.editing
		if (!ed) return
		const target = e.target as HTMLElement
		const cellEl = target.closest<HTMLElement>('[data-column]')
		const columnName = cellEl?.dataset.column
		if (!columnName) return
		if (ed.isRowDeleted?.(index)) return
		if (ed.isEditable && !ed.isEditable(columnName)) return
		ed.onStart(index, columnName)
	}

	function handleSelectAll() {
		commitOrSkip(applySelectAll(totalRows(), totalCols()))
	}

	function handleColumnSelect(colIndex: number, e: MouseEvent) {
		const rows = totalRows()
		if (e.shiftKey) {
			commit(applySelectFullColumnRange(props.selection, colIndex, rows))
		} else if (e.ctrlKey || e.metaKey) {
			commit(applyToggleFullColumn(props.selection, colIndex, rows))
		} else {
			commit(applySelectFullColumn(colIndex, rows))
		}
	}

	function handleResizeColumn(column: string, width: number) {
		props.onResizeColumn?.(column, width)
	}

	return (
		<div
			ref={scrollRef}
			class="grid-view__scroll"
			classList={{ 'grid-view__scroll--loading': !!props.loading }}
		>
			<GridHeader
				columns={props.columns}
				sort={props.sort ?? []}
				columnConfig={props.columnConfig}
				pinStyles={pinStyles()}
				fkColumns={props.fkColumns ?? new Set()}
				onToggleSort={(col, multi) => props.onToggleSort?.(col, multi)}
				onResizeColumn={handleResizeColumn}
				onHeaderContextMenu={props.getHeaderContextMenu && shell
					? (e, col) => shell.openHeaderContextMenu(e, col)
					: undefined}
				onSelectAll={handleSelectAll}
				onColumnSelect={handleColumnSelect}
			/>

			<VirtualScroller
				scrollElement={() => scrollRef}
				rows={props.rows}
				columns={props.columns}
				columnConfig={props.columnConfig}
				pinStyles={pinStyles()}
				selection={props.selection}
				scrollMargin={HEADER_HEIGHT}
				onRowMouseDown={handleRowMouseDown}
				onRowDblClick={props.editing ? handleRowDblClick : undefined}
				onRowNumberClick={handleRowNumberClick}
				editingCell={props.editing?.editingCell}
				getChangedCells={props.editing?.isCellChanged
					? (rowIdx) => collectChangedCells(rowIdx, props.columns, props.editing!.isCellChanged!)
					: undefined}
				isRowDeleted={props.editing?.isRowDeleted}
				isRowNew={props.editing?.isRowNew}
				fkMap={props.fkMap}
				heatmapInfo={props.heatmapInfo}
				getRowColor={props.getRowColor}
				onCellSave={props.editing?.onSave}
				onCellCancel={props.editing?.onCancel}
				onCellMoveNext={props.editing?.onMoveNext}
				onCellMoveDown={props.editing?.onMoveDown}
				onFkClick={props.onFkClick}
				onPkClick={props.onPkClick}
				onCellBrowseFk={props.editing?.onBrowseFk}
				getLiveCellIntensity={props.getLiveCellIntensity}
				getLiveRowNewIntensity={props.getLiveRowNewIntensity}
				liveTick={props.liveTick}
			/>

			<Show when={!props.loading && props.rows.length === 0 && props.emptyState}>
				{props.emptyState}
			</Show>
		</div>
	)
}

function collectChangedCells(
	rowIdx: number,
	columns: GridColumnDef[],
	isCellChanged: (rowIndex: number, column: string) => boolean,
): Set<string> {
	const changed = new Set<string>()
	for (const col of columns) {
		if (isCellChanged(rowIdx, col.name)) changed.add(col.name)
	}
	return changed
}
