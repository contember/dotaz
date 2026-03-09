import type { GridColumnDef } from '@dotaz/shared/types/grid'
import type { SetStoreFunction } from 'solid-js/store'
import type { CellSelection, FocusedCell, GridStoreState, NormalizedRange, TabGridState } from './grid'

export function createGridSelectionActions(
	setState: SetStoreFunction<GridStoreState>,
	ensureTab: (tabId: string) => TabGridState,
	normalizeRange: (startRow: number, endRow: number, startCol: number, endCol: number) => NormalizedRange,
	createDefaultSelection: () => CellSelection,
) {
	function selectCell(tabId: string, row: number, col: number) {
		ensureTab(tabId)
		const range = normalizeRange(row, row, col, col)
		setState('tabs', tabId, 'selection', {
			focusedCell: { row, col },
			ranges: [range],
			anchor: { row, col },
			selectMode: 'cells',
		})
	}

	function extendSelection(tabId: string, toRow: number, toCol: number) {
		const tab = ensureTab(tabId)
		const anchor = tab.selection.anchor ?? { row: toRow, col: toCol }
		const range = normalizeRange(anchor.row, toRow, anchor.col, toCol)
		setState('tabs', tabId, 'selection', {
			focusedCell: { row: toRow, col: toCol },
			ranges: [range],
			anchor,
			selectMode: tab.selection.selectMode,
		})
	}

	function addCellRange(tabId: string, row: number, col: number) {
		const tab = ensureTab(tabId)
		const range = normalizeRange(row, row, col, col)
		setState('tabs', tabId, 'selection', {
			focusedCell: { row, col },
			ranges: [...tab.selection.ranges, range],
			anchor: { row, col },
			selectMode: 'cells',
		})
	}

	function extendLastRange(tabId: string, toRow: number, toCol: number) {
		const tab = ensureTab(tabId)
		const anchor = tab.selection.anchor ?? { row: toRow, col: toCol }
		const range = normalizeRange(anchor.row, toRow, anchor.col, toCol)
		const ranges = tab.selection.ranges.length > 1
			? [...tab.selection.ranges.slice(0, -1), range]
			: [range]
		setState('tabs', tabId, 'selection', {
			focusedCell: { row: toRow, col: toCol },
			ranges,
			anchor,
			selectMode: tab.selection.selectMode,
		})
	}

	function selectFullRow(tabId: string, rowIndex: number, totalCols: number) {
		ensureTab(tabId)
		const range = normalizeRange(rowIndex, rowIndex, 0, totalCols - 1)
		setState('tabs', tabId, 'selection', {
			focusedCell: { row: rowIndex, col: 0 },
			ranges: [range],
			anchor: { row: rowIndex, col: 0 },
			selectMode: 'rows',
		})
	}

	function selectFullRowRange(
		tabId: string,
		from: number,
		to: number,
		totalCols: number,
	) {
		const tab = ensureTab(tabId)
		const anchor = tab.selection.anchor ?? { row: from, col: 0 }
		const range = normalizeRange(anchor.row, to, 0, totalCols - 1)
		setState('tabs', tabId, 'selection', {
			focusedCell: { row: to, col: 0 },
			ranges: [range],
			anchor,
			selectMode: 'rows',
		})
	}

	function toggleFullRow(tabId: string, rowIndex: number, totalCols: number) {
		const tab = ensureTab(tabId)
		const range = normalizeRange(rowIndex, rowIndex, 0, totalCols - 1)
		// Check if this row is already fully selected
		const alreadySelected = tab.selection.ranges.some(
			(r) =>
				r.minRow <= rowIndex
				&& r.maxRow >= rowIndex
				&& r.minCol === 0
				&& r.maxCol === totalCols - 1,
		)
		if (alreadySelected) {
			// Remove ranges that fully cover this row
			const filtered = tab.selection.ranges.filter(
				(r) => !(r.minRow === rowIndex && r.maxRow === rowIndex),
			)
			setState('tabs', tabId, 'selection', {
				focusedCell: filtered.length > 0 ? tab.selection.focusedCell : null,
				ranges: filtered,
				anchor: { row: rowIndex, col: 0 },
				selectMode: 'rows',
			})
		} else {
			setState('tabs', tabId, 'selection', {
				focusedCell: { row: rowIndex, col: 0 },
				ranges: [...tab.selection.ranges, range],
				anchor: { row: rowIndex, col: 0 },
				selectMode: 'rows',
			})
		}
	}

	function selectFullColumn(tabId: string, colIndex: number, totalRows: number) {
		ensureTab(tabId)
		const range = normalizeRange(0, totalRows - 1, colIndex, colIndex)
		setState('tabs', tabId, 'selection', {
			focusedCell: { row: 0, col: colIndex },
			ranges: [range],
			anchor: { row: 0, col: colIndex },
			selectMode: 'columns',
		})
	}

	function selectFullColumnRange(
		tabId: string,
		toColIndex: number,
		totalRows: number,
	) {
		const tab = ensureTab(tabId)
		const anchor = tab.selection.anchor ?? { row: 0, col: toColIndex }
		const range = normalizeRange(0, totalRows - 1, anchor.col, toColIndex)
		setState('tabs', tabId, 'selection', {
			focusedCell: { row: 0, col: toColIndex },
			ranges: [range],
			anchor,
			selectMode: 'columns',
		})
	}

	function toggleFullColumn(tabId: string, colIndex: number, totalRows: number) {
		const tab = ensureTab(tabId)
		const range = normalizeRange(0, totalRows - 1, colIndex, colIndex)
		const alreadySelected = tab.selection.ranges.some(
			(r) =>
				r.minCol <= colIndex
				&& r.maxCol >= colIndex
				&& r.minRow === 0
				&& r.maxRow === totalRows - 1,
		)
		if (alreadySelected) {
			const filtered = tab.selection.ranges.filter(
				(r) => !(r.minCol === colIndex && r.maxCol === colIndex),
			)
			setState('tabs', tabId, 'selection', {
				focusedCell: filtered.length > 0 ? tab.selection.focusedCell : null,
				ranges: filtered,
				anchor: { row: 0, col: colIndex },
				selectMode: 'columns',
			})
		} else {
			setState('tabs', tabId, 'selection', {
				focusedCell: { row: 0, col: colIndex },
				ranges: [...tab.selection.ranges, range],
				anchor: { row: 0, col: colIndex },
				selectMode: 'columns',
			})
		}
	}

	function selectAll(tabId: string, totalRows: number, totalCols: number) {
		ensureTab(tabId)
		if (totalRows === 0 || totalCols === 0) return
		const range = normalizeRange(0, totalRows - 1, 0, totalCols - 1)
		setState('tabs', tabId, 'selection', {
			focusedCell: { row: 0, col: 0 },
			ranges: [range],
			anchor: { row: 0, col: 0 },
			selectMode: 'rows',
		})
	}

	function moveFocus(
		tabId: string,
		dRow: number,
		dCol: number,
		totalRows: number,
		totalCols: number,
	) {
		const tab = ensureTab(tabId)
		const current = tab.selection.focusedCell ?? { row: 0, col: 0 }
		const row = Math.max(0, Math.min(totalRows - 1, current.row + dRow))
		const col = Math.max(0, Math.min(totalCols - 1, current.col + dCol))
		selectCell(tabId, row, col)
	}

	function extendFocus(
		tabId: string,
		dRow: number,
		dCol: number,
		totalRows: number,
		totalCols: number,
	) {
		const tab = ensureTab(tabId)
		const current = tab.selection.focusedCell ?? { row: 0, col: 0 }
		const row = Math.max(0, Math.min(totalRows - 1, current.row + dRow))
		const col = Math.max(0, Math.min(totalCols - 1, current.col + dCol))
		extendSelection(tabId, row, col)
	}

	function clearSelection(tabId: string) {
		ensureTab(tabId)
		setState('tabs', tabId, 'selection', createDefaultSelection())
	}

	/** Legacy compatibility: set focused cell by column name */
	function setFocusedCell(
		tabId: string,
		cell: FocusedCell | null,
		visibleColumns?: GridColumnDef[],
	) {
		const tab = ensureTab(tabId)
		if (!cell) {
			setState('tabs', tabId, 'selection', {
				...tab.selection,
				focusedCell: null,
			})
			return
		}
		const colIdx = visibleColumns
			? visibleColumns.findIndex((c) => c.name === cell.column)
			: 0
		selectCell(tabId, cell.row, Math.max(0, colIdx))
	}

	return {
		selectCell,
		extendSelection,
		addCellRange,
		extendLastRange,
		selectFullRow,
		selectFullRowRange,
		toggleFullRow,
		selectFullColumn,
		selectFullColumnRange,
		toggleFullColumn,
		selectAll,
		moveFocus,
		extendFocus,
		clearSelection,
		setFocusedCell,
	}
}
