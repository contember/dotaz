import type { GridColumnDef } from '@dotaz/shared/types/grid'
import type { SetStoreFunction } from 'solid-js/store'
import { DEFAULT_COLUMN_WIDTH } from '../lib/layout-constants'
import type { ColumnConfig, GridStoreState, TabGridState } from './grid'

export function createGridColumnActions(
	_state: GridStoreState,
	setState: SetStoreFunction<GridStoreState>,
	ensureTab: (tabId: string) => TabGridState,
) {
	function setColumnWidth(tabId: string, column: string, width: number) {
		const tab = ensureTab(tabId)
		const existing = tab.columnConfig[column]
		setState('tabs', tabId, 'columnConfig', {
			...tab.columnConfig,
			[column]: {
				visible: existing?.visible ?? true,
				width: Math.max(50, width),
				pinned: existing?.pinned,
			},
		})
	}

	function setColumnVisibility(tabId: string, column: string, visible: boolean) {
		const tab = ensureTab(tabId)
		const existing = tab.columnConfig[column]
		setState('tabs', tabId, 'columnConfig', {
			...tab.columnConfig,
			[column]: {
				visible,
				width: existing?.width,
				pinned: existing?.pinned,
			},
		})
	}

	function setColumnPinned(
		tabId: string,
		column: string,
		pinned: 'left' | 'right' | undefined,
	) {
		const tab = ensureTab(tabId)
		const existing = tab.columnConfig[column]
		setState('tabs', tabId, 'columnConfig', {
			...tab.columnConfig,
			[column]: {
				visible: existing?.visible ?? true,
				width: existing?.width,
				pinned,
			},
		})
	}

	function setColumnOrder(tabId: string, order: string[]) {
		setState('tabs', tabId, 'columnOrder', order)
	}

	function resetColumnConfig(tabId: string) {
		ensureTab(tabId)
		setState('tabs', tabId, 'columnConfig', {})
		setState('tabs', tabId, 'columnOrder', [])
	}

	return {
		setColumnWidth,
		setColumnVisibility,
		setColumnPinned,
		setColumnOrder,
		resetColumnConfig,
	}
}

/** Returns all columns in user-defined order (or natural order). Includes hidden columns. */
export function getOrderedColumns(tab: TabGridState): GridColumnDef[] {
	if (tab.columnOrder.length === 0) return tab.columns
	const orderMap = new Map(tab.columnOrder.map((name, i) => [name, i]))
	return [...tab.columns].sort((a, b) => {
		const ai = orderMap.get(a.name) ?? Number.MAX_SAFE_INTEGER
		const bi = orderMap.get(b.name) ?? Number.MAX_SAFE_INTEGER
		return ai - bi
	})
}

/** Returns visible columns ordered for rendering: left-pinned, normal, right-pinned. */
export function getVisibleColumns(tab: TabGridState): GridColumnDef[] {
	const ordered = getOrderedColumns(tab)
	const visible = ordered.filter(
		(col) => tab.columnConfig[col.name]?.visible !== false,
	)

	const left: GridColumnDef[] = []
	const normal: GridColumnDef[] = []
	const right: GridColumnDef[] = []

	for (const col of visible) {
		const pin = tab.columnConfig[col.name]?.pinned
		if (pin === 'left') left.push(col)
		else if (pin === 'right') right.push(col)
		else normal.push(col)
	}

	return [...left, ...normal, ...right]
}

/** Computes sticky position styles for pinned columns. */
export function computePinStyles(
	columns: GridColumnDef[],
	columnConfig: Record<string, ColumnConfig>,
): Map<string, Record<string, string>> {
	const styles = new Map<string, Record<string, string>>()

	// Start after the row number column (40px)
	let leftOffset = 40
	for (const col of columns) {
		if (columnConfig[col.name]?.pinned === 'left') {
			styles.set(col.name, {
				position: 'sticky',
				left: `${leftOffset}px`,
				'z-index': '3',
				background: 'var(--surface-raised)',
			})
			leftOffset += columnConfig[col.name]?.width ?? DEFAULT_COLUMN_WIDTH
		}
	}

	let rightOffset = 0
	for (let i = columns.length - 1; i >= 0; i--) {
		const col = columns[i]
		if (columnConfig[col.name]?.pinned === 'right') {
			styles.set(col.name, {
				position: 'sticky',
				right: `${rightOffset}px`,
				'z-index': '3',
				background: 'var(--surface-raised)',
			})
			rightOffset += columnConfig[col.name]?.width ?? DEFAULT_COLUMN_WIDTH
		}
	}

	return styles
}
