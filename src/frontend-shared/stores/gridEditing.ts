import { generateChangesPreview, generateChangeSql, serializeValueForDialect } from '@dotaz/shared/sql'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import type { DataChange } from '@dotaz/shared/types/rpc'
import type { SetStoreFunction } from 'solid-js/store'
import { reconcileCellEdit, valuesEqual } from '../lib/cell-edit-reconciliation'
import { rpc } from '../lib/rpc'
import { replaceRecordContents } from '../lib/store-records'
import { connectionsStore } from './connections'
import type { CellChange, GridStoreState, PendingChanges, TabGridState } from './grid'
import { sessionStore } from './session'

function createDefaultPendingChanges(): PendingChanges {
	return {
		cellEdits: {},
		newRows: new Set(),
		deletedRows: new Set(),
	}
}

function replaceCellEdits(
	setState: SetStoreFunction<GridStoreState>,
	tabId: string,
	cellEdits: Record<string, CellChange>,
) {
	setState(
		'tabs',
		tabId,
		'pendingChanges',
		'cellEdits',
		(edits) => replaceRecordContents(edits, cellEdits),
	)
}

function replacePendingChanges(
	setState: SetStoreFunction<GridStoreState>,
	tabId: string,
	pendingChanges: PendingChanges,
) {
	replaceCellEdits(setState, tabId, pendingChanges.cellEdits)
	setState('tabs', tabId, 'pendingChanges', 'newRows', pendingChanges.newRows)
	setState('tabs', tabId, 'pendingChanges', 'deletedRows', pendingChanges.deletedRows)
}

export { createDefaultPendingChanges, valuesEqual }

export function createGridEditingActions(
	_state: GridStoreState,
	setState: SetStoreFunction<GridStoreState>,
	ensureTab: (tabId: string) => TabGridState,
	getTab: (tabId: string) => TabGridState | undefined,
	getVisibleColumns: (tab: TabGridState) => import('@dotaz/shared/types/grid').GridColumnDef[],
	clearSelection: (tabId: string) => void,
) {
	function startEditing(tabId: string, row: number, column: string, initialValue?: unknown) {
		ensureTab(tabId)
		setState('tabs', tabId, 'editingCell', initialValue === undefined ? { row, column } : { row, column, initialValue })
	}

	function stopEditing(tabId: string) {
		ensureTab(tabId)
		setState('tabs', tabId, 'editingCell', null)
	}

	function setCellValue(
		tabId: string,
		rowIndex: number,
		column: string,
		newValue: unknown,
	): boolean {
		const tab = ensureTab(tabId)
		if (tab.columns.find((candidate) => candidate.name === column)?.sourceTable) return false
		const key = `${rowIndex}:${column}`
		const existing = tab.pendingChanges.cellEdits[key]
		const result = reconcileCellEdit({
			rowIndex,
			column,
			currentValue: tab.rows[rowIndex]?.[column],
			existingEdit: existing,
			newValue,
		})

		if (result.type === 'noop') return false

		if (result.type === 'revert') {
			const next = { ...tab.pendingChanges.cellEdits }
			delete next[key]
			replaceCellEdits(setState, tabId, next)
		} else {
			setState('tabs', tabId, 'pendingChanges', 'cellEdits', key, result.edit)
		}

		// Also update the actual row data for display
		setState('tabs', tabId, 'rows', rowIndex, column, newValue)
		return true
	}

	function addNewRow(tabId: string): number {
		const tab = ensureTab(tabId)
		const emptyRow: Record<string, unknown> = {}
		for (const col of tab.columns) {
			emptyRow[col.name] = null
		}
		const newIndex = tab.rows.length
		setState('tabs', tabId, 'rows', [...tab.rows, emptyRow])
		const next = new Set(tab.pendingChanges.newRows)
		next.add(newIndex)
		setState('tabs', tabId, 'pendingChanges', 'newRows', next)
		return newIndex
	}

	/**
	 * Paste parsed clipboard data into the grid starting at the given cell.
	 * Overwrites existing rows and creates new INSERT rows when pasting beyond the last row.
	 * Each pasted cell becomes a pending change (same as inline editing).
	 */
	function pasteCells(
		tabId: string,
		startRow: number,
		startColumn: string,
		data: unknown[][],
	) {
		const tab = ensureTab(tabId)
		const visibleCols = getVisibleColumns(tab)
		const colNames = visibleCols.map((c) => c.name)
		const startColIdx = colNames.indexOf(startColumn)
		if (startColIdx < 0) return

		for (let r = 0; r < data.length; r++) {
			const rowIndex = startRow + r
			// Create new row if we're past the end
			if (rowIndex >= tab.rows.length) {
				addNewRow(tabId)
			}
			const pasteRow = data[r]
			for (let c = 0; c < pasteRow.length; c++) {
				const colIdx = startColIdx + c
				if (colIdx >= colNames.length) break // skip columns beyond visible range
				const colName = colNames[colIdx]
				setCellValue(tabId, rowIndex, colName, pasteRow[c])
			}
		}
	}

	/** Adjust all pending change indices after a row removal. */
	function adjustIndicesAfterRemoval(tabId: string, removedIndex: number) {
		const tab = ensureTab(tabId)

		// Adjust cellEdits keys
		const oldEdits = tab.pendingChanges.cellEdits
		const newEdits: Record<string, CellChange> = {}
		for (const [, edit] of Object.entries(oldEdits)) {
			if (edit.rowIndex > removedIndex) {
				const adjusted = { ...edit, rowIndex: edit.rowIndex - 1 }
				newEdits[`${adjusted.rowIndex}:${adjusted.column}`] = adjusted
			} else {
				newEdits[`${edit.rowIndex}:${edit.column}`] = edit
			}
		}
		replaceCellEdits(setState, tabId, newEdits)

		// Adjust newRows
		const newNewRows = new Set<number>()
		for (const idx of tab.pendingChanges.newRows) {
			newNewRows.add(idx > removedIndex ? idx - 1 : idx)
		}
		setState('tabs', tabId, 'pendingChanges', 'newRows', newNewRows)

		// Adjust deletedRows
		const newDeletedRows = new Set<number>()
		for (const idx of tab.pendingChanges.deletedRows) {
			newDeletedRows.add(idx > removedIndex ? idx - 1 : idx)
		}
		setState('tabs', tabId, 'pendingChanges', 'deletedRows', newDeletedRows)
	}

	function deleteSelectedRows(tabId: string, selectedIndices: number[]) {
		const tab = ensureTab(tabId)
		if (selectedIndices.length === 0) return
		const next = new Set(tab.pendingChanges.deletedRows)

		// Collect new-row indices to remove from the rows array
		const newRowIndicesToRemove: number[] = []

		for (const idx of selectedIndices) {
			if (tab.pendingChanges.newRows.has(idx)) {
				newRowIndicesToRemove.push(idx)
			} else {
				next.add(idx)
			}
		}

		// Remove new rows from rows array (process in reverse to preserve indices)
		if (newRowIndicesToRemove.length > 0) {
			newRowIndicesToRemove.sort((a, b) => b - a)
			for (const idx of newRowIndicesToRemove) {
				// Remove cell edits for this row
				const edits = { ...tab.pendingChanges.cellEdits }
				for (const key of Object.keys(edits)) {
					if (key.startsWith(`${idx}:`)) delete edits[key]
				}
				replaceCellEdits(setState, tabId, edits)

				// Remove from newRows
				const nextNew = new Set(tab.pendingChanges.newRows)
				nextNew.delete(idx)
				setState('tabs', tabId, 'pendingChanges', 'newRows', nextNew)

				// Remove row from array
				const filteredRows = tab.rows.filter((_, i) => i !== idx)
				setState('tabs', tabId, 'rows', filteredRows)

				// Adjust indices for remaining pending changes
				adjustIndicesAfterRemoval(tabId, idx)
			}
		}

		setState('tabs', tabId, 'pendingChanges', 'deletedRows', next)
		clearSelection(tabId)
	}

	function hasPendingChanges(tabId: string): boolean {
		const tab = getTab(tabId)
		if (!tab) return false
		return (
			Object.keys(tab.pendingChanges.cellEdits).length > 0
			|| tab.pendingChanges.newRows.size > 0
			|| tab.pendingChanges.deletedRows.size > 0
		)
	}

	/** Count total number of distinct changes (grouped by type: update rows, inserts, deletes). */
	function pendingChangesCount(tabId: string): number {
		const tab = getTab(tabId)
		if (!tab) return 0

		// Count distinct rows with cell edits (excluding new/deleted rows)
		const editedRows = new Set<number>()
		for (const edit of Object.values(tab.pendingChanges.cellEdits)) {
			if (
				!tab.pendingChanges.newRows.has(edit.rowIndex)
				&& !tab.pendingChanges.deletedRows.has(edit.rowIndex)
			) {
				editedRows.add(edit.rowIndex)
			}
		}

		return (
			editedRows.size
			+ tab.pendingChanges.newRows.size
			+ tab.pendingChanges.deletedRows.size
		)
	}

	/** Revert all cell edits for a specific existing row (undo UPDATE). */
	function revertRowUpdate(tabId: string, rowIndex: number) {
		const tab = ensureTab(tabId)
		const edits = { ...tab.pendingChanges.cellEdits }
		for (const [key, edit] of Object.entries(edits)) {
			if (edit.rowIndex === rowIndex) {
				setState('tabs', tabId, 'rows', rowIndex, edit.column, edit.oldValue)
				delete edits[key]
			}
		}
		replaceCellEdits(setState, tabId, edits)
	}

	/** Revert a new row (undo INSERT). */
	function revertNewRow(tabId: string, rowIndex: number) {
		const tab = ensureTab(tabId)

		// Remove cell edits for this row
		const edits = { ...tab.pendingChanges.cellEdits }
		for (const key of Object.keys(edits)) {
			if (key.startsWith(`${rowIndex}:`)) delete edits[key]
		}
		replaceCellEdits(setState, tabId, edits)

		// Remove from newRows
		const nextNew = new Set(tab.pendingChanges.newRows)
		nextNew.delete(rowIndex)
		setState('tabs', tabId, 'pendingChanges', 'newRows', nextNew)

		// Remove the row from rows array and adjust indices in pendingChanges
		const filteredRows = tab.rows.filter((_, i) => i !== rowIndex)
		setState('tabs', tabId, 'rows', filteredRows)

		// Adjust indices for all pending changes that reference rows after the removed one
		adjustIndicesAfterRemoval(tabId, rowIndex)
	}

	/** Revert a deleted row (undo DELETE). */
	function revertDeletedRow(tabId: string, rowIndex: number) {
		const tab = ensureTab(tabId)
		const next = new Set(tab.pendingChanges.deletedRows)
		next.delete(rowIndex)
		setState('tabs', tabId, 'pendingChanges', 'deletedRows', next)
	}

	function isCellChanged(
		tabId: string,
		rowIndex: number,
		column: string,
	): boolean {
		const tab = getTab(tabId)
		if (!tab) return false
		return `${rowIndex}:${column}` in tab.pendingChanges.cellEdits
	}

	function isRowNew(tabId: string, rowIndex: number): boolean {
		const tab = getTab(tabId)
		if (!tab) return false
		return tab.pendingChanges.newRows.has(rowIndex)
	}

	function isRowDeleted(tabId: string, rowIndex: number): boolean {
		const tab = getTab(tabId)
		if (!tab) return false
		return tab.pendingChanges.deletedRows.has(rowIndex)
	}

	/**
	 * Build DataChange array from pending changes for backend submission. Values
	 * are serialised through the connection's dialect — JS arrays become PG
	 * array literals so the params are wire-ready (Bun.SQL would otherwise
	 * stringify them as `"a,b"` and PG rejects that as a malformed array).
	 *
	 * If `selected` is provided, only changes whose key (`update:N` / `insert:N`
	 * / `delete:N`) is in the set are included — used by the partial-commit
	 * flow in the pending-changes dialog.
	 */
	function buildDataChanges(tabId: string, selected?: ReadonlySet<string>): DataChange[] {
		const tab = ensureTab(tabId)
		const dialect = connectionsStore.getDialect(tab.connectionId)
		const colByName = new Map(tab.columns.map((c) => [c.name, c] as const))
		const serialiseRow = (values: Record<string, unknown>): Record<string, unknown> => {
			const out: Record<string, unknown> = {}
			for (const [k, v] of Object.entries(values)) {
				const col: GridColumnDef | undefined = colByName.get(k)
				out[k] = col ? serializeValueForDialect(v, col.dataType, dialect) : v
			}
			return out
		}
		const changes: DataChange[] = []
		const pkColumns = tab.columns
			.filter((c) => c.isPrimaryKey)
			.map((c) => c.name)

		// Collect updates: group cell edits by row
		const editsByRow = new Map<number, Record<string, unknown>>()
		for (const edit of Object.values(tab.pendingChanges.cellEdits)) {
			if (tab.pendingChanges.newRows.has(edit.rowIndex)) continue // new rows handled separately
			if (tab.pendingChanges.deletedRows.has(edit.rowIndex)) continue // deleted rows handled separately
			let rowEdits = editsByRow.get(edit.rowIndex)
			if (!rowEdits) {
				rowEdits = {}
				editsByRow.set(edit.rowIndex, rowEdits)
			}
			rowEdits[edit.column] = edit.newValue
		}

		for (const [rowIndex, values] of editsByRow) {
			if (selected && !selected.has(`update:${rowIndex}`)) continue
			const row = tab.rows[rowIndex]
			const primaryKeys: Record<string, unknown> = {}
			for (const pk of pkColumns) {
				// Use original value if the PK was edited, otherwise current value
				const cellEdit = tab.pendingChanges.cellEdits[`${rowIndex}:${pk}`]
				primaryKeys[pk] = cellEdit ? cellEdit.oldValue : row[pk]
			}
			changes.push({
				type: 'update',
				schema: tab.schema,
				table: tab.table,
				primaryKeys: serialiseRow(primaryKeys),
				values: serialiseRow(values),
			})
		}

		// Collect inserts (new rows)
		for (const rowIndex of tab.pendingChanges.newRows) {
			if (selected && !selected.has(`insert:${rowIndex}`)) continue
			const row = tab.rows[rowIndex]
			if (!row) continue
			const values: Record<string, unknown> = {}
			for (const col of tab.columns) {
				if (col.sourceTable) continue
				if (row[col.name] !== null && row[col.name] !== undefined) {
					values[col.name] = row[col.name]
				}
			}
			changes.push({
				type: 'insert',
				schema: tab.schema,
				table: tab.table,
				values: serialiseRow(values),
			})
		}

		// Collect deletes
		for (const rowIndex of tab.pendingChanges.deletedRows) {
			if (selected && !selected.has(`delete:${rowIndex}`)) continue
			const row = tab.rows[rowIndex]
			if (!row) continue
			const primaryKeys: Record<string, unknown> = {}
			for (const pk of pkColumns) {
				primaryKeys[pk] = row[pk]
			}
			changes.push({
				type: 'delete',
				schema: tab.schema,
				table: tab.table,
				primaryKeys: serialiseRow(primaryKeys),
			})
		}

		return changes
	}

	async function applyChanges(tabId: string, database?: string, selected?: ReadonlySet<string>) {
		const tab = ensureTab(tabId)
		const changes = buildDataChanges(tabId, selected)
		if (changes.length === 0) return

		const dialect = connectionsStore.getDialect(tab.connectionId)
		const statements = changes.map((change) => generateChangeSql(change, dialect))
		const sessionId = sessionStore.getSessionForTab(tabId)
		await rpc.query.execute({
			connectionId: tab.connectionId,
			sql: '',
			queryId: '',
			statements,
			database,
			sessionId,
		})
	}

	function generateSqlPreview(tabId: string, selected?: ReadonlySet<string>): string {
		const tab = ensureTab(tabId)
		const changes = buildDataChanges(tabId, selected)
		if (changes.length === 0) return ''
		const dialect = connectionsStore.getDialect(tab.connectionId)
		return generateChangesPreview(changes, dialect)
	}

	/**
	 * Drop tracking for the changes named in `applied` (keyed `update:N` /
	 * `insert:N` / `delete:N`). When deletes are applied the underlying rows
	 * are spliced out of the grid and any surviving pending entries are
	 * renumbered so their indices remain consistent.
	 */
	function clearAppliedChanges(tabId: string, applied: ReadonlySet<string>) {
		const tab = ensureTab(tabId)
		const pending = tab.pendingChanges

		const appliedDeletes = new Set<number>()
		for (const ri of pending.deletedRows) {
			if (applied.has(`delete:${ri}`)) appliedDeletes.add(ri)
		}

		// Drop applied entries (no renumbering yet). Applied UPDATE cells are baked
		// into the base rows below so committed values survive without a refetch
		// (a refetch is blocked while other edits stay pending).
		const remainingCellEdits: Record<string, CellChange> = {}
		const appliedUpdateEdits: CellChange[] = []
		for (const [key, edit] of Object.entries(pending.cellEdits)) {
			const isAppliedUpdate = applied.has(`update:${edit.rowIndex}`) && !pending.newRows.has(edit.rowIndex)
				&& !pending.deletedRows.has(edit.rowIndex)
			const isAppliedInsert = applied.has(`insert:${edit.rowIndex}`) && pending.newRows.has(edit.rowIndex)
			if (isAppliedUpdate) {
				appliedUpdateEdits.push(edit)
				continue
			}
			if (isAppliedInsert) continue
			remainingCellEdits[key] = edit
		}

		// Materialise committed UPDATE values into the base rows before any delete
		// splice, so the indices still line up with tab.rows. Applied INSERT rows are
		// already materialised in tab.rows and are intentionally left in place.
		for (const edit of appliedUpdateEdits) {
			setState('tabs', tabId, 'rows', edit.rowIndex, edit.column, edit.newValue)
		}

		const remainingNewRows = new Set<number>()
		for (const ri of pending.newRows) {
			if (!applied.has(`insert:${ri}`)) remainingNewRows.add(ri)
		}

		const remainingDeletedRows = new Set<number>()
		for (const ri of pending.deletedRows) {
			if (!applied.has(`delete:${ri}`)) remainingDeletedRows.add(ri)
		}

		if (appliedDeletes.size === 0) {
			replacePendingChanges(setState, tabId, {
				cellEdits: remainingCellEdits,
				newRows: remainingNewRows,
				deletedRows: remainingDeletedRows,
			})
			return
		}

		// Splice deleted rows + renumber every surviving rowIndex
		const newRows = tab.rows.filter((_, i) => !appliedDeletes.has(i))
		const indexMap = new Map<number, number>()
		let nextIdx = 0
		for (let oldIdx = 0; oldIdx < tab.rows.length; oldIdx++) {
			if (appliedDeletes.has(oldIdx)) continue
			indexMap.set(oldIdx, nextIdx++)
		}

		const remappedCellEdits: Record<string, CellChange> = {}
		for (const edit of Object.values(remainingCellEdits)) {
			const newRowIdx = indexMap.get(edit.rowIndex)
			if (newRowIdx == null) continue
			remappedCellEdits[`${newRowIdx}:${edit.column}`] = { ...edit, rowIndex: newRowIdx }
		}

		const remappedNewRows = new Set<number>()
		for (const ri of remainingNewRows) {
			const mapped = indexMap.get(ri)
			if (mapped != null) remappedNewRows.add(mapped)
		}

		const remappedDeletedRows = new Set<number>()
		for (const ri of remainingDeletedRows) {
			const mapped = indexMap.get(ri)
			if (mapped != null) remappedDeletedRows.add(mapped)
		}

		setState('tabs', tabId, 'rows', newRows)
		replacePendingChanges(setState, tabId, {
			cellEdits: remappedCellEdits,
			newRows: remappedNewRows,
			deletedRows: remappedDeletedRows,
		})
	}

	function revertChanges(tabId: string) {
		const tab = ensureTab(tabId)

		// Revert cell edits to original values
		for (const edit of Object.values(tab.pendingChanges.cellEdits)) {
			if (!tab.pendingChanges.newRows.has(edit.rowIndex)) {
				setState(
					'tabs',
					tabId,
					'rows',
					edit.rowIndex,
					edit.column,
					edit.oldValue,
				)
			}
		}

		// Remove new rows from end
		const newRowIndices = [...tab.pendingChanges.newRows].sort((a, b) => b - a)
		if (newRowIndices.length > 0) {
			const filteredRows = tab.rows.filter(
				(_, i) => !tab.pendingChanges.newRows.has(i),
			)
			setState('tabs', tabId, 'rows', filteredRows)
		}

		// Clear all pending changes
		replacePendingChanges(setState, tabId, createDefaultPendingChanges())
		setState('tabs', tabId, 'editingCell', null)
	}

	/** Clear pending changes tracking without reverting cell values (used after successful apply). */
	function clearPendingChanges(tabId: string) {
		ensureTab(tabId)
		replacePendingChanges(setState, tabId, createDefaultPendingChanges())
		setState('tabs', tabId, 'editingCell', null)
	}

	return {
		startEditing,
		stopEditing,
		setCellValue,
		addNewRow,
		pasteCells,
		deleteSelectedRows,
		hasPendingChanges,
		pendingChangesCount,
		isCellChanged,
		isRowNew,
		isRowDeleted,
		buildDataChanges,
		applyChanges,
		generateSqlPreview,
		revertChanges,
		clearPendingChanges,
		clearAppliedChanges,
		revertRowUpdate,
		revertNewRow,
		revertDeletedRow,
	}
}
