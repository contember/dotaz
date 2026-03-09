import { buildCountQuery, buildSelectQuery } from '@dotaz/shared/sql'
import type { GridColumnDef } from '@dotaz/shared/types/grid'
import type { ColumnFilter } from '@dotaz/shared/types/grid'
import type { SetStoreFunction } from 'solid-js/store'
import { rpc } from '../lib/rpc'
import { connectionsStore } from './connections'
import type { FkBreadcrumb, GridStoreState, TabGridState } from './grid'
import { settingsStore } from './settings'

export function createGridFkActions(
	state: GridStoreState,
	setState: SetStoreFunction<GridStoreState>,
	ensureTab: (tabId: string) => TabGridState,
	getTab: (tabId: string) => TabGridState | undefined,
) {
	async function fetchFkRowData(
		connectionId: string,
		schema: string,
		table: string,
		column: string,
		value: unknown,
		database?: string,
	): Promise<{
		rows: Record<string, unknown>[]
		columns: GridColumnDef[]
		foreignKeys: import('@dotaz/shared/types/database').ForeignKeyInfo[]
	}> {
		const dialect = connectionsStore.getDialect(connectionId)
		const filters: ColumnFilter[] = [
			{ column, operator: 'eq', value: String(value) },
		]

		const cachedColumns = connectionsStore.getColumns(
			connectionId,
			schema,
			table,
			database,
		)
		const gridColumns: GridColumnDef[] = cachedColumns.map((c) => ({
			name: c.name,
			dataType: c.dataType,
			nullable: c.nullable,
			isPrimaryKey: c.isPrimaryKey,
		}))

		const selectQuery = buildSelectQuery(
			schema,
			table,
			1,
			50,
			undefined,
			filters,
			dialect,
		)
		const results = await rpc.query.execute({
			connectionId,
			sql: selectQuery.sql,
			queryId: `fk-peek-${schema}-${table}-${column}`,
			params: selectQuery.params,
			database,
		})

		const foreignKeys = connectionsStore.getForeignKeys(
			connectionId,
			schema,
			table,
			database,
		)

		return {
			rows: results[0]?.rows ?? [],
			columns: gridColumns,
			foreignKeys,
		}
	}

	async function openFkPeek(
		tabId: string,
		anchorRect: { top: number; left: number; bottom: number; right: number },
		schema: string,
		table: string,
		column: string,
		value: unknown,
	) {
		const tab = ensureTab(tabId)

		setState('tabs', tabId, 'fkPeek', {
			anchorRect,
			rows: [],
			columns: [],
			breadcrumbs: [],
			foreignKeys: [],
			schema,
			table,
			loading: true,
		})

		try {
			const data = await fetchFkRowData(
				tab.connectionId,
				schema,
				table,
				column,
				value,
				tab.database,
			)
			// Check peek is still open (user might have closed it)
			if (!state.tabs[tabId]?.fkPeek) return
			setState('tabs', tabId, 'fkPeek', {
				anchorRect,
				rows: data.rows,
				columns: data.columns,
				breadcrumbs: [{ schema, table, column, value }],
				foreignKeys: data.foreignKeys,
				schema,
				table,
				loading: false,
			})
		} catch {
			setState('tabs', tabId, 'fkPeek', null)
		}
	}

	function openPkPeek(
		tabId: string,
		rowIndex: number,
		anchorRect: { top: number; left: number; bottom: number; right: number },
	) {
		const tab = ensureTab(tabId)
		const row = tab.rows[rowIndex]
		if (!row) return

		const foreignKeys = connectionsStore.getForeignKeys(
			tab.connectionId,
			tab.schema,
			tab.table,
			tab.database,
		)

		setState('tabs', tabId, 'fkPeek', {
			anchorRect,
			rows: [row],
			columns: tab.columns,
			breadcrumbs: [
				{ schema: tab.schema, table: tab.table, column: '', value: null },
			],
			foreignKeys,
			schema: tab.schema,
			table: tab.table,
			loading: false,
		})
	}

	function closeFkPeek(tabId: string) {
		ensureTab(tabId)
		setState('tabs', tabId, 'fkPeek', null)
	}

	async function fkPeekNavigate(
		tabId: string,
		schema: string,
		table: string,
		column: string,
		value: unknown,
	) {
		const tab = ensureTab(tabId)
		const peek = tab.fkPeek
		if (!peek) return

		const newBreadcrumbs = [
			...peek.breadcrumbs,
			{ schema, table, column, value },
		]
		setState('tabs', tabId, 'fkPeek', {
			...peek,
			loading: true,
			breadcrumbs: newBreadcrumbs,
		})

		try {
			const data = await fetchFkRowData(
				tab.connectionId,
				schema,
				table,
				column,
				value,
				tab.database,
			)
			if (!state.tabs[tabId]?.fkPeek) return
			setState('tabs', tabId, 'fkPeek', {
				anchorRect: peek.anchorRect,
				rows: data.rows,
				columns: data.columns,
				breadcrumbs: newBreadcrumbs,
				foreignKeys: data.foreignKeys,
				schema,
				table,
				loading: false,
			})
		} catch {
			setState('tabs', tabId, 'fkPeek', null)
		}
	}

	function fkPeekBack(tabId: string) {
		const tab = ensureTab(tabId)
		const peek = tab.fkPeek
		if (!peek || peek.breadcrumbs.length <= 1) return

		const prevBreadcrumbs = peek.breadcrumbs.slice(0, -1)
		const prev = prevBreadcrumbs[prevBreadcrumbs.length - 1]

		// Re-fetch the previous breadcrumb's data
		setState('tabs', tabId, 'fkPeek', {
			...peek,
			loading: true,
			breadcrumbs: prevBreadcrumbs,
		})

		fetchFkRowData(
			tab.connectionId,
			prev.schema,
			prev.table,
			prev.column,
			prev.value,
			tab.database,
		)
			.then((data) => {
				if (!state.tabs[tabId]?.fkPeek) return
				setState('tabs', tabId, 'fkPeek', {
					anchorRect: peek.anchorRect,
					rows: data.rows,
					columns: data.columns,
					breadcrumbs: prevBreadcrumbs,
					foreignKeys: data.foreignKeys,
					schema: prev.schema,
					table: prev.table,
					loading: false,
				})
			})
			.catch(() => {
				setState('tabs', tabId, 'fkPeek', null)
			})
	}

	// ── FK Exploration panel actions ──────────────────────────

	async function openFkPanel(
		tabId: string,
		schema: string,
		table: string,
		filters: ColumnFilter[],
	) {
		const tab = ensureTab(tabId)

		// Close value editor if open (mutually exclusive)
		if (tab.valueEditorOpen) {
			setState('tabs', tabId, 'valueEditorOpen', false)
		}
		// Close peek if open
		setState('tabs', tabId, 'fkPeek', null)

		const breadcrumb: FkBreadcrumb = {
			schema,
			table,
			column: filters[0]?.column ?? '',
			value: filters[0]?.value,
		}

		setState('tabs', tabId, 'fkPanel', {
			width: tab.fkPanel?.width ?? 500,
			schema,
			table,
			filters,
			rows: [],
			columns: [],
			breadcrumbs: [breadcrumb],
			foreignKeys: [],
			totalCount: null,
			countLoading: false,
			currentPage: 1,
			currentRowIndex: 0,
			pageSize: 100,
			loading: true,
		})

		await fetchFkPanelData(tabId)
	}

	async function fetchFkPanelData(tabId: string) {
		const tab = ensureTab(tabId)
		const panel = tab.fkPanel
		if (!panel) return

		try {
			const dialect = connectionsStore.getDialect(tab.connectionId)
			const cachedColumns = connectionsStore.getColumns(
				tab.connectionId,
				panel.schema,
				panel.table,
				tab.database,
			)
			const gridColumns: GridColumnDef[] = cachedColumns.map((c) => ({
				name: c.name,
				dataType: c.dataType,
				nullable: c.nullable,
				isPrimaryKey: c.isPrimaryKey,
			}))

			const filters = panel.filters.length > 0 ? panel.filters : undefined
			const selectQuery = buildSelectQuery(
				panel.schema,
				panel.table,
				panel.currentPage,
				panel.pageSize,
				undefined,
				filters,
				dialect,
			)

			let dataResults: Awaited<ReturnType<typeof rpc.query.execute>>
			let totalCount: number | null = null

			if (settingsStore.gridConfig.autoCount) {
				const countQuery = buildCountQuery(panel.schema, panel.table, filters, dialect)
				const [dr, cr] = await Promise.all([
					rpc.query.execute({
						connectionId: tab.connectionId,
						sql: selectQuery.sql,
						queryId: `fk-panel-${tabId}`,
						params: selectQuery.params,
						database: tab.database,
					}),
					rpc.query.execute({
						connectionId: tab.connectionId,
						sql: countQuery.sql,
						queryId: `fk-panel-count-${tabId}`,
						params: countQuery.params,
						database: tab.database,
					}),
				])
				dataResults = dr
				totalCount = Number(cr[0]?.rows[0]?.count ?? 0)
			} else {
				dataResults = await rpc.query.execute({
					connectionId: tab.connectionId,
					sql: selectQuery.sql,
					queryId: `fk-panel-${tabId}`,
					params: selectQuery.params,
					database: tab.database,
				})
			}

			if (!state.tabs[tabId]?.fkPanel) return
			const foreignKeys = connectionsStore.getForeignKeys(
				tab.connectionId,
				panel.schema,
				panel.table,
				tab.database,
			)

			setState('tabs', tabId, 'fkPanel', {
				...panel,
				rows: dataResults[0]?.rows ?? [],
				columns: gridColumns,
				totalCount,
				countLoading: false,
				foreignKeys,
				loading: false,
			})
		} catch {
			setState('tabs', tabId, 'fkPanel', null)
		}
	}

	async function fetchFkPanelCount(tabId: string) {
		const tab = getTab(tabId)
		if (!tab?.fkPanel) return
		setState('tabs', tabId, 'fkPanel', 'countLoading', true)
		try {
			const dialect = connectionsStore.getDialect(tab.connectionId)
			const panel = tab.fkPanel
			const filters = panel.filters.length > 0 ? panel.filters : undefined
			const countQuery = buildCountQuery(panel.schema, panel.table, filters, dialect)
			const results = await rpc.query.execute({
				connectionId: tab.connectionId,
				sql: countQuery.sql,
				queryId: `fk-panel-count-${tabId}`,
				params: countQuery.params,
				database: tab.database,
			})
			if (!state.tabs[tabId]?.fkPanel) return
			setState('tabs', tabId, 'fkPanel', 'totalCount', Number(results[0]?.rows[0]?.count ?? 0))
		} catch {
			// Silently ignore
		} finally {
			if (state.tabs[tabId]?.fkPanel) {
				setState('tabs', tabId, 'fkPanel', 'countLoading', false)
			}
		}
	}

	async function refreshFkPanel(tabId: string) {
		const tab = ensureTab(tabId)
		if (!tab.fkPanel) return
		setState('tabs', tabId, 'fkPanel', 'loading', true)
		await fetchFkPanelData(tabId)
	}

	function closeFkPanel(tabId: string) {
		ensureTab(tabId)
		setState('tabs', tabId, 'fkPanel', null)
	}

	async function fkPanelNavigate(
		tabId: string,
		schema: string,
		table: string,
		column: string,
		value: unknown,
	) {
		const tab = ensureTab(tabId)
		const panel = tab.fkPanel
		if (!panel) return

		const newFilters: ColumnFilter[] = [
			{ column, operator: 'eq', value: String(value) },
		]
		const newBreadcrumbs = [
			...panel.breadcrumbs,
			{ schema, table, column, value },
		]

		setState('tabs', tabId, 'fkPanel', {
			...panel,
			schema,
			table,
			filters: newFilters,
			breadcrumbs: newBreadcrumbs,
			totalCount: null,
			countLoading: false,
			currentPage: 1,
			currentRowIndex: 0,
			loading: true,
		})

		await fetchFkPanelData(tabId)
	}

	async function fkPanelBack(tabId: string) {
		const tab = ensureTab(tabId)
		const panel = tab.fkPanel
		if (!panel || panel.breadcrumbs.length <= 1) return

		const prevBreadcrumbs = panel.breadcrumbs.slice(0, -1)
		const prev = prevBreadcrumbs[prevBreadcrumbs.length - 1]

		setState('tabs', tabId, 'fkPanel', {
			...panel,
			schema: prev.schema,
			table: prev.table,
			filters: [
				{ column: prev.column, operator: 'eq', value: String(prev.value) },
			],
			breadcrumbs: prevBreadcrumbs,
			totalCount: null,
			countLoading: false,
			currentPage: 1,
			currentRowIndex: 0,
			loading: true,
		})

		await fetchFkPanelData(tabId)
	}

	function fkPanelResize(tabId: string, width: number) {
		const tab = ensureTab(tabId)
		if (!tab.fkPanel) return
		setState(
			'tabs',
			tabId,
			'fkPanel',
			'width',
			Math.min(1200, Math.max(250, width)),
		)
	}

	async function fkPanelSetPage(tabId: string, page: number) {
		const tab = ensureTab(tabId)
		if (!tab.fkPanel) return
		setState('tabs', tabId, 'fkPanel', 'currentPage', page)
		setState('tabs', tabId, 'fkPanel', 'currentRowIndex', 0)
		setState('tabs', tabId, 'fkPanel', 'loading', true)
		await fetchFkPanelData(tabId)
	}

	function fkPanelSetRowIndex(tabId: string, index: number) {
		const tab = ensureTab(tabId)
		if (!tab.fkPanel) return
		const maxIndex = Math.max(0, tab.fkPanel.rows.length - 1)
		setState(
			'tabs',
			tabId,
			'fkPanel',
			'currentRowIndex',
			Math.min(Math.max(0, index), maxIndex),
		)
	}

	return {
		openFkPeek,
		openPkPeek,
		closeFkPeek,
		fkPeekNavigate,
		fkPeekBack,
		openFkPanel,
		closeFkPanel,
		refreshFkPanel,
		fetchFkPanelCount,
		fkPanelNavigate,
		fkPanelBack,
		fkPanelResize,
		fkPanelSetPage,
		fkPanelSetRowIndex,
	}
}
