import type { GridColumnDef } from '@dotaz/shared/types/grid'

// ── Types ────────────────────────────────────────────────

export interface NormalizedRange {
	minRow: number
	maxRow: number
	minCol: number
	maxCol: number
}

export interface CellSelection {
	focusedCell: { row: number; col: number } | null
	ranges: NormalizedRange[]
	anchor: { row: number; col: number } | null
	selectMode: 'cells' | 'rows' | 'columns'
}

// ── Constructors / inspectors ────────────────────────────

export function createDefaultSelection(): CellSelection {
	return { focusedCell: null, ranges: [], anchor: null, selectMode: 'cells' }
}

export function normalizeRange(
	startRow: number,
	endRow: number,
	startCol: number,
	endCol: number,
): NormalizedRange {
	return {
		minRow: Math.min(startRow, endRow),
		maxRow: Math.max(startRow, endRow),
		minCol: Math.min(startCol, endCol),
		maxCol: Math.max(startCol, endCol),
	}
}

export function isCellInSelection(sel: CellSelection, row: number, col: number): boolean {
	for (const r of sel.ranges) {
		if (row >= r.minRow && row <= r.maxRow && col >= r.minCol && col <= r.maxCol) {
			return true
		}
	}
	return false
}

export function getSelectedRowIndices(sel: CellSelection): number[] {
	const rows = new Set<number>()
	for (const r of sel.ranges) {
		for (let i = r.minRow; i <= r.maxRow; i++) rows.add(i)
	}
	return [...rows].sort((a, b) => a - b)
}

export function getSelectedColIndices(sel: CellSelection): number[] {
	const cols = new Set<number>()
	for (const r of sel.ranges) {
		for (let i = r.minCol; i <= r.maxCol; i++) cols.add(i)
	}
	return [...cols].sort((a, b) => a - b)
}

export function hasFullRowSelection(sel: CellSelection, totalCols: number): boolean {
	if (sel.ranges.length === 0) return false
	return sel.ranges.some((r) => r.minCol === 0 && r.maxCol === totalCols - 1)
}

// ── Pure state transformers ──────────────────────────────
// All return a new CellSelection — no store coupling.

export function applySelectCell(row: number, col: number): CellSelection {
	const range = normalizeRange(row, row, col, col)
	return {
		focusedCell: { row, col },
		ranges: [range],
		anchor: { row, col },
		selectMode: 'cells',
	}
}

export function applyExtendSelection(sel: CellSelection, toRow: number, toCol: number): CellSelection {
	const anchor = sel.anchor ?? { row: toRow, col: toCol }
	const range = normalizeRange(anchor.row, toRow, anchor.col, toCol)
	return {
		focusedCell: { row: toRow, col: toCol },
		ranges: [range],
		anchor,
		selectMode: sel.selectMode,
	}
}

export function applyAddCellRange(sel: CellSelection, row: number, col: number): CellSelection {
	const range = normalizeRange(row, row, col, col)
	return {
		focusedCell: { row, col },
		ranges: [...sel.ranges, range],
		anchor: { row, col },
		selectMode: 'cells',
	}
}

export function applyExtendLastRange(sel: CellSelection, toRow: number, toCol: number): CellSelection {
	const anchor = sel.anchor ?? { row: toRow, col: toCol }
	const range = normalizeRange(anchor.row, toRow, anchor.col, toCol)
	const ranges = sel.ranges.length > 1 ? [...sel.ranges.slice(0, -1), range] : [range]
	return {
		focusedCell: { row: toRow, col: toCol },
		ranges,
		anchor,
		selectMode: sel.selectMode,
	}
}

export function applySelectFullRow(rowIndex: number, totalCols: number): CellSelection {
	const range = normalizeRange(rowIndex, rowIndex, 0, totalCols - 1)
	return {
		focusedCell: { row: rowIndex, col: 0 },
		ranges: [range],
		anchor: { row: rowIndex, col: 0 },
		selectMode: 'rows',
	}
}

export function applySelectFullRowRange(
	sel: CellSelection,
	from: number,
	to: number,
	totalCols: number,
): CellSelection {
	const anchor = sel.anchor ?? { row: from, col: 0 }
	const range = normalizeRange(anchor.row, to, 0, totalCols - 1)
	return {
		focusedCell: { row: to, col: 0 },
		ranges: [range],
		anchor,
		selectMode: 'rows',
	}
}

export function applyToggleFullRow(
	sel: CellSelection,
	rowIndex: number,
	totalCols: number,
): CellSelection {
	const range = normalizeRange(rowIndex, rowIndex, 0, totalCols - 1)
	const alreadySelected = sel.ranges.some(
		(r) =>
			r.minRow <= rowIndex
			&& r.maxRow >= rowIndex
			&& r.minCol === 0
			&& r.maxCol === totalCols - 1,
	)
	if (alreadySelected) {
		const filtered = sel.ranges.filter((r) => !(r.minRow === rowIndex && r.maxRow === rowIndex))
		return {
			focusedCell: filtered.length > 0 ? sel.focusedCell : null,
			ranges: filtered,
			anchor: { row: rowIndex, col: 0 },
			selectMode: 'rows',
		}
	}
	return {
		focusedCell: { row: rowIndex, col: 0 },
		ranges: [...sel.ranges, range],
		anchor: { row: rowIndex, col: 0 },
		selectMode: 'rows',
	}
}

export function applySelectFullColumn(colIndex: number, totalRows: number): CellSelection {
	const range = normalizeRange(0, totalRows - 1, colIndex, colIndex)
	return {
		focusedCell: { row: 0, col: colIndex },
		ranges: [range],
		anchor: { row: 0, col: colIndex },
		selectMode: 'columns',
	}
}

export function applySelectFullColumnRange(
	sel: CellSelection,
	toColIndex: number,
	totalRows: number,
): CellSelection {
	const anchor = sel.anchor ?? { row: 0, col: toColIndex }
	const range = normalizeRange(0, totalRows - 1, anchor.col, toColIndex)
	return {
		focusedCell: { row: 0, col: toColIndex },
		ranges: [range],
		anchor,
		selectMode: 'columns',
	}
}

export function applyToggleFullColumn(
	sel: CellSelection,
	colIndex: number,
	totalRows: number,
): CellSelection {
	const range = normalizeRange(0, totalRows - 1, colIndex, colIndex)
	const alreadySelected = sel.ranges.some(
		(r) =>
			r.minCol <= colIndex
			&& r.maxCol >= colIndex
			&& r.minRow === 0
			&& r.maxRow === totalRows - 1,
	)
	if (alreadySelected) {
		const filtered = sel.ranges.filter((r) => !(r.minCol === colIndex && r.maxCol === colIndex))
		return {
			focusedCell: filtered.length > 0 ? sel.focusedCell : null,
			ranges: filtered,
			anchor: { row: 0, col: colIndex },
			selectMode: 'columns',
		}
	}
	return {
		focusedCell: { row: 0, col: colIndex },
		ranges: [...sel.ranges, range],
		anchor: { row: 0, col: colIndex },
		selectMode: 'columns',
	}
}

export function applySelectAll(totalRows: number, totalCols: number): CellSelection | null {
	if (totalRows === 0 || totalCols === 0) return null
	const range = normalizeRange(0, totalRows - 1, 0, totalCols - 1)
	return {
		focusedCell: { row: 0, col: 0 },
		ranges: [range],
		anchor: { row: 0, col: 0 },
		selectMode: 'rows',
	}
}

export function applyMoveFocus(
	sel: CellSelection,
	dRow: number,
	dCol: number,
	totalRows: number,
	totalCols: number,
): CellSelection {
	const current = sel.focusedCell ?? { row: 0, col: 0 }
	const row = Math.max(0, Math.min(totalRows - 1, current.row + dRow))
	const col = Math.max(0, Math.min(totalCols - 1, current.col + dCol))
	return applySelectCell(row, col)
}

export function applyExtendFocus(
	sel: CellSelection,
	dRow: number,
	dCol: number,
	totalRows: number,
	totalCols: number,
): CellSelection {
	const current = sel.focusedCell ?? { row: 0, col: 0 }
	const row = Math.max(0, Math.min(totalRows - 1, current.row + dRow))
	const col = Math.max(0, Math.min(totalCols - 1, current.col + dCol))
	return applyExtendSelection(sel, row, col)
}

// ── Selection snapshot (for export, aggregations, …) ─────

export interface SelectionSnapshot {
	rowIndices: number[]
	colIndices: number[]
	rowCount: number
	cellCount: number
	columns: GridColumnDef[]
	rows: Record<string, unknown>[]
	hasExplicitSelection: boolean
	fallbackToAll: boolean
}

function projectRowToColumns(
	row: Record<string, unknown>,
	columns: GridColumnDef[],
): Record<string, unknown> {
	const projected: Record<string, unknown> = {}
	for (const column of columns) {
		projected[column.name] = row[column.name]
	}
	return projected
}

export function buildSelectionSnapshot(
	rows: Record<string, unknown>[],
	visibleColumns: GridColumnDef[],
	selection: CellSelection,
	fallbackToAll = false,
): SelectionSnapshot | null {
	if (selection.ranges.length === 0) {
		if (!fallbackToAll || visibleColumns.length === 0) return null
		const rowIndices = rows.map((_, index) => index).filter((index) => rows[index] != null)
		return {
			rowIndices,
			colIndices: visibleColumns.map((_, index) => index),
			rowCount: rowIndices.length,
			cellCount: rowIndices.length * visibleColumns.length,
			columns: visibleColumns,
			rows: rowIndices.map((index) => projectRowToColumns(rows[index], visibleColumns)),
			hasExplicitSelection: false,
			fallbackToAll: true,
		}
	}

	const colIndices = getSelectedColIndices(selection).filter((index) => visibleColumns[index] != null)
	if (colIndices.length === 0) return null

	const rowIndices = getSelectedRowIndices(selection).filter((index) => rows[index] != null)
	const columns = colIndices.map((index) => visibleColumns[index])
	let cellCount = 0

	const projectedRows = rowIndices.map((rowIndex) => {
		const row = rows[rowIndex]
		const projected: Record<string, unknown> = {}
		for (const colIndex of colIndices) {
			if (!isCellInSelection(selection, rowIndex, colIndex)) continue
			const column = visibleColumns[colIndex]
			projected[column.name] = row[column.name]
			cellCount++
		}
		return projected
	})

	return {
		rowIndices,
		colIndices,
		rowCount: rowIndices.length,
		cellCount,
		columns,
		rows: projectedRows,
		hasExplicitSelection: true,
		fallbackToAll: false,
	}
}
