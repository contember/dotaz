import type { ForeignKeyInfo } from '@dotaz/shared/types/database'

export interface FkTarget {
	schema: string
	table: string
	column: string
}

export function buildFkLookup(foreignKeys: ForeignKeyInfo[]): Map<string, FkTarget> {
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

export function buildFkInfoLookup(foreignKeys: ForeignKeyInfo[]): Map<string, ForeignKeyInfo> {
	const map = new Map<string, ForeignKeyInfo>()
	for (const fk of foreignKeys) {
		if (fk.columns.length === 1) {
			map.set(fk.columns[0], fk)
		}
	}
	return map
}
