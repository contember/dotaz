import type { ComparisonColumnMapping, ComparisonSource } from '@dotaz/shared/types/comparison'
import { createStore } from 'solid-js/store'
import { tabsStore } from './tabs'

export interface ComparisonTabParams {
	left: ComparisonSource
	right: ComparisonSource
	keyColumns: ComparisonColumnMapping[]
	columnMappings: ComparisonColumnMapping[]
}

/**
 * Reactive store for comparison parameters keyed by tab ID.
 *
 * Uses Solid.js createStore so that reads inside JSX (e.g. accessing params
 * for a newly opened comparison tab) are properly tracked and will trigger
 * re-renders if the value changes.
 */
const [params, setParams] = createStore<Record<string, ComparisonTabParams>>({})

tabsStore.onTabClosed((tabId) => {
	if (params[tabId]) {
		setParams(tabId, undefined!)
	}
})

function setComparisonParams(tabId: string, value: ComparisonTabParams): void {
	setParams(tabId, value)
}

function getComparisonParams(tabId: string): ComparisonTabParams | undefined {
	return params[tabId]
}

function removeComparisonParams(tabId: string): void {
	setParams(tabId, undefined!)
}

export { getComparisonParams, removeComparisonParams, setComparisonParams }
