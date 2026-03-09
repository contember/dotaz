import type { GridColumnDef } from '@dotaz/shared/types/grid'
import type { QueryEditability, QueryResult, QueryResultColumn } from '@dotaz/shared/types/query'

export function toGridColumn(col: QueryResultColumn, editability?: QueryEditability): GridColumnDef {
	return {
		name: col.name,
		dataType: col.dataType,
		nullable: false,
		isPrimaryKey: editability?.primaryKeys?.includes(col.name) ?? false,
	}
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms} ms`
	return `${(ms / 1000).toFixed(1)} s`
}

export function getResultLabel(result: QueryResult, index: number): string {
	if (result.error) return `Error`
	if (result.columns.length > 0) return `Result ${index + 1}`
	return `Statement ${index + 1}`
}

export function getReadOnlyReason(editability: QueryEditability): string {
	switch (editability.reason) {
		case 'not_select':
			return 'Not a SELECT query'
		case 'aggregation':
			return 'Aggregation query (GROUP BY / aggregate functions)'
		case 'union':
			return 'UNION / INTERSECT / EXCEPT query'
		case 'subquery':
			return 'Contains subqueries'
		case 'multi_table':
			return 'Multi-table query (JOIN / multiple tables)'
		case 'no_pk':
			return 'Primary key columns not in result set'
		case 'unknown_table':
			return 'Could not identify source table'
		default:
			return 'Read-only result'
	}
}
