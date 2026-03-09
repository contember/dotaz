import { isNumericType } from '@dotaz/shared/column-types'
import type { SetStoreFunction } from 'solid-js/store'
import type { GridStoreState, HeatmapInfo, HeatmapMode, TabGridState } from './grid'

export function createGridHeatmapActions(
	_state: GridStoreState,
	setState: SetStoreFunction<GridStoreState>,
	ensureTab: (tabId: string) => TabGridState,
) {
	function setHeatmap(tabId: string, column: string, mode: HeatmapMode) {
		const tab = ensureTab(tabId)
		// Only allow heatmaps on numeric columns
		const col = tab.columns.find((c) => c.name === column)
		if (!col || !isNumericType(col.dataType)) return
		setState('tabs', tabId, 'heatmapColumns', {
			...tab.heatmapColumns,
			[column]: mode,
		})
	}

	function removeHeatmap(tabId: string, column: string) {
		const tab = ensureTab(tabId)
		const next = { ...tab.heatmapColumns }
		delete next[column]
		setState('tabs', tabId, 'heatmapColumns', next)
	}

	return { setHeatmap, removeHeatmap }
}

/** Compute min/max stats for all heatmap columns from currently displayed rows. */
export function computeHeatmapStats(tab: TabGridState): Map<string, HeatmapInfo> {
	const result = new Map<string, HeatmapInfo>()
	const columns = Object.keys(tab.heatmapColumns)
	if (columns.length === 0) return result

	for (const colName of columns) {
		const mode = tab.heatmapColumns[colName]
		let min = Infinity
		let max = -Infinity
		for (const row of tab.rows) {
			const val = row[colName]
			if (val === null || val === undefined) continue
			const num = Number(val)
			if (Number.isNaN(num)) continue
			if (num < min) min = num
			if (num > max) max = num
		}
		if (min <= max) {
			result.set(colName, { min, max, mode })
		}
	}
	return result
}

/** Compute a CSS background color for a heatmap cell. */
export function computeHeatmapColor(
	value: unknown,
	info: HeatmapInfo,
): string | undefined {
	if (value === null || value === undefined) return undefined
	const num = Number(value)
	if (Number.isNaN(num)) return undefined

	const range = info.max - info.min
	const t = range === 0 ? 0.5 : (num - info.min) / range // 0..1

	if (info.mode === 'sequential') {
		// Blue scale: low opacity → high opacity
		const alpha = 0.08 + t * 0.47 // 0.08..0.55
		return `rgba(59, 130, 246, ${alpha.toFixed(3)})`
	}
	// Diverging: blue (0) → transparent (0.5) → red (1)
	if (t < 0.5) {
		const alpha = (1 - t * 2) * 0.5 // 0.5→0
		return `rgba(59, 130, 246, ${alpha.toFixed(3)})`
	}
	const alpha = (t * 2 - 1) * 0.5 // 0→0.5
	return `rgba(239, 68, 68, ${alpha.toFixed(3)})`
}
