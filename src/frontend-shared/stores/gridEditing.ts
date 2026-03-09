import { generateChangesPreview, generateChangeSql } from '@dotaz/shared/sql'
import type { DataChange } from '@dotaz/shared/types/rpc'
import type { SetStoreFunction } from 'solid-js/store'
import { rpc } from '../lib/rpc'
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

export { createDefaultPendingChanges }

export function createGridEditingActions(
	_state: GridStoreState,
	setState: SetStoreFunction<GridStoreState>,
	ensureTab: (tabId: string) => TabGridState,
	getTab: (tabId: string) => TabGridState | undefined,
	getVisibleColumns: (tab: TabGridState) => import('@dotaz/shared/types/grid').GridColumnDef[],
	clearSelection: (tabId: string) => void,
) {
	function startEditing(tabId: string, row: number, column: string) {
		ensureTab(tabId)
		setState('tabs', tabId, 'editingCell', { row, column })
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
	) {
		const tab = ensureTab(tabId)
		const key = `${rowIndex}:${column}`
		const existing = tab.pendingChanges.cellEdits[key]
		const oldValue = existing ? existing.oldValue : tab.rows[rowIndex]?.[column]

		// If reverting to original value, remove the edit
		if (oldValue === newValue) {
			const next = { ...tab.pendingChanges.cellEdits }
			delete next[key]
			setState('tabs', tabId, 'pendingChanges', 'cellEdits', next)
		} else {
			setState('tabs', tabId, 'pendingChanges', 'cellEdits', key, {
				rowIndex,
				column,
				oldValue,
				newValue,
			})
		}

		// Also update the actual row data for display
		setState('tabs', tabId, 'rows', rowIndex, column, newValue)
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
		setState('tabs', tabId, 'pendingChanges', 'cellEdits', newEdits)

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
				setState('tabs', tabId, 'pendingChanges', 'cellEdits', edits)

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
		setState('tabs', tabId, 'pendingChanges', 'cellEdits', edits)
	}

	/** Revert a new row (undo INSERT). */
	function revertNewRow(tabId: string, rowIndex: number) {
		const tab = ensureTab(tabId)

		// Remove cell edits for this row
		const edits = { ...tab.pendingChanges.cellEdits }
		for (const key of Object.keys(edits)) {
			if (key.startsWith(`${rowIndex}:`)) delete edits[key]
		}
		setState('tabs', tabId, 'pendingChanges', 'cellEdits', edits)

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
	 * Build DataChange array from pending changes for backend submission.
	 */
	function buildDataChanges(tabId: string): DataChange[] {
		const tab = ensureTab(tabId)
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
				primaryKeys,
				values,
			})
		}

		// Collect inserts (new rows)
		for (const rowIndex of tab.pendingChanges.newRows) {
			const row = tab.rows[rowIndex]
			if (!row) continue
			const values: Record<string, unknown> = {}
			for (const col of tab.columns) {
				if (row[col.name] !== null && row[col.name] !== undefined) {
					values[col.name] = row[col.name]
				}
			}
			changes.push({
				type: 'insert',
				schema: tab.schema,
				table: tab.table,
				values,
			})
		}

		// Collect deletes
		for (const rowIndex of tab.pendingChanges.deletedRows) {
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
				primaryKeys,
			})
		}

		return changes
	}

	async function applyChanges(tabId: string, database?: string) {
		const tab = ensureTab(tabId)
		const changes = buildDataChanges(tabId)
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

	function generateSqlPreview(tabId: string): string {
		const tab = ensureTab(tabId)
		const changes = buildDataChanges(tabId)
		if (changes.length === 0) return ''
		const dialect = connectionsStore.getDialect(tab.connectionId)
		return generateChangesPreview(changes, dialect)
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
		setState('tabs', tabId, 'pendingChanges', createDefaultPendingChanges())
		setState('tabs', tabId, 'editingCell', null)
	}

	/** Clear pending changes tracking without reverting cell values (used after successful apply). */
	function clearPendingChanges(tabId: string) {
		ensureTab(tabId)
		setState('tabs', tabId, 'pendingChanges', createDefaultPendingChanges())
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
		revertRowUpdate,
		revertNewRow,
		revertDeletedRow,
	}
}
