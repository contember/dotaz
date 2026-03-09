/**
 * Pure logic for building data change objects from pending cell edits.
 *
 * Takes editability info, pending changes, and original rows, and produces
 * DataChange objects suitable for SQL generation.
 */

import type { DataChange } from '@dotaz/shared/types/rpc.js'
import type { CellChange } from '../stores/grid.js'

export interface PendingEdits {
	cellEdits: Record<string, CellChange>
}

/**
 * Build DataChange objects from pending cell edits for a single result set.
 *
 * Groups edits by row and uses original row data for PK values.
 * Returns an empty array if there are no changes or the result is not editable.
 */
export function buildDataChanges(
	pending: PendingEdits,
	originalRows: Record<string, unknown>[],
	schema: string,
	table: string,
	pkColumns: string[],
): DataChange[] {
	const changes: DataChange[] = []

	// Group cell edits by row
	const editsByRow = new Map<number, Record<string, unknown>>()
	for (const edit of Object.values(pending.cellEdits)) {
		let rowEdits = editsByRow.get(edit.rowIndex)
		if (!rowEdits) {
			rowEdits = {}
			editsByRow.set(edit.rowIndex, rowEdits)
		}
		rowEdits[edit.column] = edit.newValue
	}

	for (const [rowIndex, values] of editsByRow) {
		const originalRow = originalRows[rowIndex]
		if (!originalRow) continue

		const primaryKeys: Record<string, unknown> = {}
		for (const pk of pkColumns) {
			// If PK was edited, use the original value
			const pkEdit = pending.cellEdits[`${rowIndex}:${pk}`]
			primaryKeys[pk] = pkEdit ? pkEdit.oldValue : originalRow[pk]
		}

		changes.push({
			type: 'update',
			schema,
			table,
			primaryKeys,
			values,
		})
	}

	return changes
}
