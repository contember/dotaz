import type { GridColumnDef } from '@dotaz/shared/types/grid'
import type { Accessor } from 'solid-js'
import type { FkTarget } from '../../stores/grid'
import { gridStore } from '../../stores/grid'

interface UseDataGridCellEditParams {
	tabId: string
	visibleColumns: Accessor<GridColumnDef[]>
	isReadOnly: Accessor<boolean>
	fkMap: Accessor<Map<string, FkTarget>>
	onOpenFkPicker: (rowIndex: number, column: string, target: FkTarget) => void
}

export function useDataGridCellEdit(params: UseDataGridCellEditParams) {
	function getFocusedCellInfo(): { row: number; column: string } | null {
		const t = gridStore.getTab(params.tabId)
		if (!t?.selection.focusedCell) return null
		const cols = params.visibleColumns()
		const col = cols[t.selection.focusedCell.col]
		if (!col) return null
		return { row: t.selection.focusedCell.row, column: col.name }
	}

	function startEditingFocused() {
		if (params.isReadOnly()) return
		const focused = getFocusedCellInfo()
		if (!focused) return
		if (gridStore.isRowDeleted(params.tabId, focused.row)) return
		gridStore.startEditing(params.tabId, focused.row, focused.column)
	}

	function handleCellSave(rowIndex: number, column: string, value: unknown) {
		gridStore.setCellValue(params.tabId, rowIndex, column, value)
		gridStore.stopEditing(params.tabId)
	}

	function handleCellCancel() {
		gridStore.stopEditing(params.tabId)
	}

	function handleCellMoveNext(rowIndex: number, currentColumn: string) {
		const cols = params.visibleColumns()
		const idx = cols.findIndex((c) => c.name === currentColumn)
		if (idx < cols.length - 1) {
			const nextCol = cols[idx + 1].name
			gridStore.startEditing(params.tabId, rowIndex, nextCol)
			gridStore.selectCell(params.tabId, rowIndex, idx + 1)
		} else {
			gridStore.stopEditing(params.tabId)
		}
	}

	function handleCellMoveDown(rowIndex: number, currentColumn: string) {
		const t = gridStore.getTab(params.tabId)
		if (!t) return
		const cols = params.visibleColumns()
		const colIdx = cols.findIndex((c) => c.name === currentColumn)
		if (rowIndex < t.rows.length - 1) {
			gridStore.startEditing(params.tabId, rowIndex + 1, currentColumn)
			gridStore.selectCell(params.tabId, rowIndex + 1, Math.max(0, colIdx))
		} else {
			gridStore.stopEditing(params.tabId)
		}
	}

	function handleBrowseFkForInline(rowIndex: number, column: string) {
		const target = params.fkMap().get(column)
		if (!target) return
		gridStore.stopEditing(params.tabId)
		params.onOpenFkPicker(rowIndex, column, target)
	}

	function handleRowDblClick(index: number, e: MouseEvent) {
		if (params.isReadOnly()) return
		const target = e.target as HTMLElement
		const cellEl = target.closest<HTMLElement>('[data-column]')
		const columnName = cellEl?.dataset.column
		if (columnName && !gridStore.isRowDeleted(params.tabId, index)) {
			gridStore.startEditing(params.tabId, index, columnName)
		}
	}

	function handleAddNewRow() {
		if (params.isReadOnly()) return
		const newIndex = gridStore.addNewRow(params.tabId)
		const cols = params.visibleColumns()
		if (cols.length > 0) {
			gridStore.startEditing(params.tabId, newIndex, cols[0].name)
			gridStore.selectCell(params.tabId, newIndex, 0)
		}
	}

	function handleDeleteSelected() {
		if (params.isReadOnly()) return
		gridStore.deleteSelectedRows(params.tabId)
	}

	function handleDuplicateRow(rowIndex: number) {
		gridStore.withUndoGroup(params.tabId, () => {
			const t = gridStore.getTab(params.tabId)
			if (!t) return
			const sourceRow = t.rows[rowIndex]
			if (!sourceRow) return
			const newIndex = gridStore.addNewRow(params.tabId)
			for (const col of t.columns) {
				if (col.isPrimaryKey) continue
				const value = sourceRow[col.name]
				if (value !== null && value !== undefined) {
					gridStore.setCellValue(params.tabId, newIndex, col.name, value)
				}
			}
		})
	}

	function getChangedCells(rowIndex: number): Set<string> {
		const t = gridStore.getTab(params.tabId)
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

	function handleFkPickerSelect(value: unknown, modal: { rowIndex: number; column: string } | null) {
		if (!modal) return
		gridStore.setCellValue(params.tabId, modal.rowIndex, modal.column, value)
	}

	return {
		getFocusedCellInfo,
		startEditingFocused,
		handleCellSave,
		handleCellCancel,
		handleCellMoveNext,
		handleCellMoveDown,
		handleBrowseFkForInline,
		handleRowDblClick,
		handleAddNewRow,
		handleDeleteSelected,
		handleDuplicateRow,
		getChangedCells,
		handleFkPickerSelect,
	}
}
