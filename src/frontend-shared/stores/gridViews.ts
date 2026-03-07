import type { SetStoreFunction } from 'solid-js/store'
import type { GridColumnDef } from '../../shared/types/grid'
import type { SavedViewConfig } from '../../shared/types/rpc'
import type { CellSelection, ColumnConfig, GridStoreState, TabGridState } from './grid'

export function createGridViewActions(
	_state: GridStoreState,
	setState: SetStoreFunction<GridStoreState>,
	ensureTab: (tabId: string) => TabGridState,
	getTab: (tabId: string) => TabGridState | undefined,
	getVisibleColumns: (tab: TabGridState) => GridColumnDef[],
	createDefaultSelection: () => CellSelection,
	fetchData: (tabId: string) => Promise<void>,
) {
	function setActiveView(
		tabId: string,
		viewId: string | null,
		viewName: string | null,
	) {
		ensureTab(tabId)
		setState('tabs', tabId, 'activeViewId', viewId)
		setState('tabs', tabId, 'activeViewName', viewName)
	}

	async function applyViewConfig(tabId: string, config: SavedViewConfig) {
		const tab = ensureTab(tabId)

		setState('tabs', tabId, 'sort', config.sort ?? [])

		setState('tabs', tabId, 'filters', config.filters ?? [])
		setState('tabs', tabId, 'customFilter', config.customFilter ?? '')

		if (config.columns) {
			const visibleSet = new Set(config.columns)
			const newConfig: Record<string, ColumnConfig> = {}
			for (const col of tab.columns) {
				newConfig[col.name] = {
					visible: visibleSet.has(col.name),
					width: config.columnWidths?.[col.name],
					pinned: tab.columnConfig[col.name]?.pinned,
				}
			}
			setState('tabs', tabId, 'columnConfig', newConfig)
			setState('tabs', tabId, 'columnOrder', config.columns)
		}

		setState('tabs', tabId, 'rowColorRules', config.rowColorRules ?? [])

		setState('tabs', tabId, 'currentPage', 1)
		setState('tabs', tabId, 'selection', createDefaultSelection())
		await fetchData(tabId)
	}

	async function resetToDefault(tabId: string) {
		ensureTab(tabId)
		setState('tabs', tabId, 'sort', [])
		setState('tabs', tabId, 'filters', [])
		setState('tabs', tabId, 'customFilter', '')
		setState('tabs', tabId, 'quickSearch', '')
		setState('tabs', tabId, 'columnConfig', {})
		setState('tabs', tabId, 'columnOrder', [])
		setState('tabs', tabId, 'rowColorRules', [])
		setState('tabs', tabId, 'activeViewId', null)
		setState('tabs', tabId, 'activeViewName', null)
		setState('tabs', tabId, 'currentPage', 1)
		setState('tabs', tabId, 'selection', createDefaultSelection())
		await fetchData(tabId)
	}

	/** Compare current grid state against a saved view config. Ignores columnWidths to reduce noise. */
	function isViewModified(tabId: string, savedConfig: SavedViewConfig): boolean {
		const tab = getTab(tabId)
		if (!tab) return false

		// Compare sort
		const currentSort = tab.sort
			.map((s) => `${s.column}:${s.direction}`)
			.join(',')
		const savedSort = (savedConfig.sort ?? [])
			.map((s) => `${s.column}:${s.direction}`)
			.join(',')
		if (currentSort !== savedSort) return true

		// Compare filters
		const currentFilters = tab.filters
			.map((f) => `${f.column}:${f.operator}:${f.value}`)
			.join(',')
		const savedFilters = (savedConfig.filters ?? [])
			.map((f) => `${f.column}:${f.operator}:${f.value}`)
			.join(',')
		if (currentFilters !== savedFilters) return true

		// Compare custom filter
		if ((tab.customFilter || '') !== (savedConfig.customFilter || '')) {
			return true
		}

		// Compare visible columns (order matters)
		if (savedConfig.columns) {
			const visibleCols = getVisibleColumns(tab).map((c) => c.name)
			if (visibleCols.join(',') !== savedConfig.columns.join(',')) return true
		}

		// Compare row color rules
		const currentRules = JSON.stringify(tab.rowColorRules)
		const savedRules = JSON.stringify(savedConfig.rowColorRules ?? [])
		if (currentRules !== savedRules) return true

		return false
	}

	function captureViewConfig(tabId: string): SavedViewConfig {
		const tab = ensureTab(tabId)
		const visible = getVisibleColumns(tab)
		const columnWidths: Record<string, number> = {}
		for (const col of tab.columns) {
			if (tab.columnConfig[col.name]?.width) {
				columnWidths[col.name] = tab.columnConfig[col.name].width!
			}
		}

		return {
			columns: visible.map((c) => c.name),
			sort: [...tab.sort],
			filters: [...tab.filters],
			columnWidths: Object.keys(columnWidths).length > 0 ? columnWidths : undefined,
			customFilter: tab.customFilter || undefined,
			rowColorRules: tab.rowColorRules.length > 0 ? [...tab.rowColorRules] : undefined,
		}
	}

	return {
		setActiveView,
		applyViewConfig,
		resetToDefault,
		isViewModified,
		captureViewConfig,
	}
}
