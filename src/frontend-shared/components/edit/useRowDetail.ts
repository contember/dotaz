import { type Accessor, createEffect, createMemo, createSignal, on } from 'solid-js'
import { buildCountQuery } from '@dotaz/shared/sql'
import type { ForeignKeyInfo, ReferencingForeignKeyInfo } from '@dotaz/shared/types/database'
import type { ColumnFilter, GridColumnDef } from '@dotaz/shared/types/grid'
import { buildFkLookup } from '../../lib/fk-utils'
import { rpc } from '../../lib/rpc'
import { connectionsStore } from '../../stores/connections'

export { buildFkLookup } from '../../lib/fk-utils'

export interface UseRowDetailParams {
	connectionId: string
	schema: string
	table: string
	database?: string
	columns: GridColumnDef[]
	row: Record<string, unknown> | null
	foreignKeys: ForeignKeyInfo[]
	onSave?: (changes: Record<string, unknown>) => void | Promise<void>
}

export interface UseRowDetailReturn {
	localEdits: Accessor<Record<string, unknown>>
	hasEdits: Accessor<boolean>
	fkLookup: Accessor<Map<string, { schema: string; table: string; column: string }>>
	pkColumns: Accessor<Set<string>>
	referencingFks: Accessor<ReferencingForeignKeyInfo[]>
	referencingCounts: Accessor<Record<string, number | null>>
	countingFks: Accessor<Set<string>>
	setFieldValue: (column: string, value: unknown) => void
	resetEdits: () => void
	getValue: (column: string) => unknown
	isFieldChanged: (column: string) => boolean
	fetchReferencingCount: (fk: ReferencingForeignKeyInfo) => Promise<void>
	buildReferencingFilters: (fk: ReferencingForeignKeyInfo) => ColumnFilter[] | null
}

export function useRowDetail(params: UseRowDetailParams): UseRowDetailReturn {
	const [localEdits, setLocalEdits] = createSignal<Record<string, unknown>>({})
	const [referencingCounts, setReferencingCounts] = createSignal<Record<string, number | null>>({})
	const [countingFks, setCountingFks] = createSignal<Set<string>>(new Set())

	const fkLookup = createMemo(() => buildFkLookup(params.foreignKeys))
	const pkColumns = createMemo(() => new Set(params.columns.filter((c) => c.isPrimaryKey).map((c) => c.name)))
	const hasEdits = createMemo(() => Object.keys(localEdits()).length > 0)

	const referencingFks = createMemo(() =>
		connectionsStore.getReferencingForeignKeys(
			params.connectionId,
			params.schema,
			params.table,
			params.database,
		)
	)

	// Reset edits when row data changes
	createEffect(on(() => params.row, () => {
		setLocalEdits({})
	}))

	// Reset referencing counts when the row or FK list changes
	createEffect(on([referencingFks, () => params.row], () => {
		setReferencingCounts({})
		setCountingFks(new Set<string>())
	}))

	function setFieldValue(column: string, value: unknown) {
		setLocalEdits((prev) => ({ ...prev, [column]: value }))
	}

	function resetEdits() {
		setLocalEdits({})
	}

	function getValue(column: string): unknown {
		const edits = localEdits()
		if (column in edits) return edits[column]
		return params.row ? params.row[column] : null
	}

	function isFieldChanged(column: string): boolean {
		return column in localEdits()
	}

	function buildReferencingFilters(fk: ReferencingForeignKeyInfo): ColumnFilter[] | null {
		const row = params.row
		if (!row) return null

		const filters: ColumnFilter[] = fk.referencedColumns.map((refCol, i) => ({
			column: fk.referencingColumns[i],
			operator: 'eq' as const,
			value: row[refCol],
		}))

		return filters
	}

	async function fetchReferencingCount(fk: ReferencingForeignKeyInfo) {
		const row = params.row
		if (!row) return

		const filters: ColumnFilter[] = fk.referencedColumns.map((refCol, i) => ({
			column: fk.referencingColumns[i],
			operator: 'eq' as const,
			value: row[refCol],
		}))

		if (filters.some((f) => f.value === null || f.value === undefined)) {
			setReferencingCounts((prev) => ({ ...prev, [fk.constraintName]: 0 }))
			return
		}

		setCountingFks((prev) => new Set([...prev, fk.constraintName]))
		try {
			const dialect = connectionsStore.getDialect(params.connectionId)
			const countQuery = buildCountQuery(fk.referencingSchema, fk.referencingTable, filters, dialect)
			const results = await rpc.query.execute({
				connectionId: params.connectionId,
				sql: countQuery.sql,
				queryId: `ref-count-${fk.constraintName}`,
				params: countQuery.params,
				database: params.database,
			})
			setReferencingCounts((prev) => ({ ...prev, [fk.constraintName]: Number(results[0]?.rows[0]?.count ?? 0) }))
		} catch {
			setReferencingCounts((prev) => ({ ...prev, [fk.constraintName]: -1 }))
		} finally {
			setCountingFks((prev) => {
				const next = new Set(prev)
				next.delete(fk.constraintName)
				return next
			})
		}
	}

	return {
		localEdits,
		hasEdits,
		fkLookup,
		pkColumns,
		referencingFks,
		referencingCounts,
		countingFks,
		setFieldValue,
		resetEdits,
		getValue,
		isFieldChanged,
		fetchReferencingCount,
		buildReferencingFilters,
	}
}
