import { isJoinedColumn, parseJoinedColumn } from '@dotaz/shared/sql'
import type { AutoJoinDef } from '@dotaz/shared/types/grid'
import type { SetStoreFunction } from 'solid-js/store'
import { connectionsStore } from './connections'
import type { CellSelection, GridStoreState, TabGridState } from './grid'

export function createGridAutoJoinActions(
	_state: GridStoreState,
	setState: SetStoreFunction<GridStoreState>,
	ensureTab: (tabId: string) => TabGridState,
	createDefaultSelection: () => CellSelection,
	fetchData: (tabId: string) => Promise<void>,
) {
	async function addAutoJoin(tabId: string, fkColumn: string) {
		const tab = ensureTab(tabId)

		// Check not already joined
		if (tab.autoJoins.some((j) => j.fkColumn === fkColumn)) return

		let fkSchema: string
		let fkTable: string
		let fkColName: string

		if (isJoinedColumn(fkColumn)) {
			// Nested join: fkColumn is "table.column" — look up FK from the joined table
			const { table, column } = parseJoinedColumn(fkColumn)
			const parentJoin = tab.autoJoins.find((j) => j.referencedTable === table)
			if (!parentJoin) return
			fkSchema = parentJoin.referencedSchema
			fkTable = parentJoin.referencedTable
			fkColName = column
		} else {
			// Base table FK
			fkSchema = tab.schema
			fkTable = tab.table
			fkColName = fkColumn
		}

		const fks = connectionsStore.getForeignKeys(
			tab.connectionId,
			fkSchema,
			fkTable,
			tab.database,
		)
		const fk = fks.find((f) => f.columns.length === 1 && f.columns[0] === fkColName)
		if (!fk) return

		const alias = `j${tab.autoJoins.length + 1}`
		const joinDef: AutoJoinDef = {
			fkColumn,
			referencedSchema: fk.referencedSchema,
			referencedTable: fk.referencedTable,
			referencedColumn: fk.referencedColumns[0],
			alias,
		}

		setState('tabs', tabId, 'autoJoins', [...tab.autoJoins, joinDef])
		setState('tabs', tabId, 'currentPage', 1)
		setState('tabs', tabId, 'selection', createDefaultSelection())
		await fetchData(tabId)
	}

	async function removeAutoJoin(tabId: string, fkColumn: string) {
		const tab = ensureTab(tabId)
		const joinToRemove = tab.autoJoins.find((j) => j.fkColumn === fkColumn)
		if (!joinToRemove) return

		const tablePrefix = joinToRemove.referencedTable + '.'
		const newJoins = tab.autoJoins
			.filter((j) => j.fkColumn !== fkColumn)
			.map((j, i) => ({ ...j, alias: `j${i + 1}` }))

		// Clean up joined column references
		const newSort = tab.sort.filter((s) => !s.column.startsWith(tablePrefix))
		const newFilters = tab.filters.filter((f) => !f.column.startsWith(tablePrefix))
		const newColumnConfig = { ...tab.columnConfig }
		const newColumnOrder = tab.columnOrder.filter((c) => !c.startsWith(tablePrefix))
		for (const key of Object.keys(newColumnConfig)) {
			if (key.startsWith(tablePrefix)) {
				delete newColumnConfig[key]
			}
		}

		setState('tabs', tabId, {
			autoJoins: newJoins,
			sort: newSort,
			filters: newFilters,
			columnConfig: newColumnConfig,
			columnOrder: newColumnOrder,
			currentPage: 1,
			selection: createDefaultSelection(),
		})
		await fetchData(tabId)
	}

	async function removeAllAutoJoins(tabId: string) {
		const tab = ensureTab(tabId)
		if (tab.autoJoins.length === 0) return

		// Clean up all joined column references
		const newSort = tab.sort.filter((s) => !isJoinedColumn(s.column))
		const newFilters = tab.filters.filter((f) => !isJoinedColumn(f.column))
		const newColumnConfig = { ...tab.columnConfig }
		const newColumnOrder = tab.columnOrder.filter((c) => !isJoinedColumn(c))
		for (const key of Object.keys(newColumnConfig)) {
			if (isJoinedColumn(key)) {
				delete newColumnConfig[key]
			}
		}

		setState('tabs', tabId, {
			autoJoins: [],
			sort: newSort,
			filters: newFilters,
			columnConfig: newColumnConfig,
			columnOrder: newColumnOrder,
			currentPage: 1,
			selection: createDefaultSelection(),
		})
		await fetchData(tabId)
	}

	return {
		addAutoJoin,
		removeAutoJoin,
		removeAllAutoJoins,
	}
}
