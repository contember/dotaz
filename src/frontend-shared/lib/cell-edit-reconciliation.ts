export interface CellEditRecord {
	rowIndex: number
	column: string
	oldValue: unknown
	newValue: unknown
}

export type CellEditReconciliation =
	| { type: 'noop' }
	| { type: 'revert' }
	| { type: 'change'; edit: CellEditRecord }

/**
 * Equality check tolerant of DB/UI representation differences.
 *
 * JSON columns come back from the DB as parsed JS values; re-parsing user input
 * creates a new instance with the same content. Missing nullable values can be
 * represented as either `null` or `undefined` depending on the query shape.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (a == null && b == null) return true
	if (a == null || b == null) return false
	if (typeof a !== 'object' || typeof b !== 'object') return false
	try {
		return JSON.stringify(a) === JSON.stringify(b)
	} catch {
		return false
	}
}

export function reconcileCellEdit(params: {
	rowIndex: number
	column: string
	currentValue: unknown
	existingEdit: CellEditRecord | undefined
	newValue: unknown
}): CellEditReconciliation {
	const { rowIndex, column, currentValue, existingEdit, newValue } = params
	if (!existingEdit && valuesEqual(currentValue, newValue)) return { type: 'noop' }

	const oldValue = existingEdit ? existingEdit.oldValue : currentValue
	if (valuesEqual(oldValue, newValue)) return { type: 'revert' }
	if (existingEdit && valuesEqual(existingEdit.newValue, newValue)) return { type: 'noop' }

	return {
		type: 'change',
		edit: {
			rowIndex,
			column,
			oldValue,
			newValue,
		},
	}
}
