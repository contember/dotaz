import { isBooleanType, isDateType, isStructuredType, isTextType } from '@dotaz/shared/column-types'
import { SQL_DEFAULT } from '@dotaz/shared/types/database'
import type { GridColumnDef } from '@dotaz/shared/types/grid'

export type PrintableEditAction =
	| { type: 'start'; initialValue: string }
	| { type: 'save'; value: unknown }
	| { type: 'ignore' }

/**
 * Resolve the first printable key pressed on a focused grid cell.
 *
 * Free-form editors (text/JSON/array) should receive the typed character.
 * Typed quick-value shortcuts for structured controls are handled before the
 * editor opens, otherwise the initial character can be misinterpreted as text.
 */
export function resolvePrintableEditAction(key: string, column: GridColumnDef): PrintableEditAction {
	const lower = key.toLowerCase()
	const freeform = isTextType(column.dataType) || isStructuredType(column.dataType)

	if (!freeform) {
		if (lower === 'n' && column.nullable) return { type: 'save', value: null }
		if (lower === 'd') return { type: 'save', value: SQL_DEFAULT }
	}

	if (isBooleanType(column.dataType)) {
		if (lower === 't') return { type: 'save', value: true }
		if (lower === 'f') return { type: 'save', value: false }
		return { type: 'ignore' }
	}

	if (isDateType(column.dataType)) return { type: 'ignore' }

	return { type: 'start', initialValue: key }
}
