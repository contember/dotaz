import type { ComparisonColumnMapping, ComparisonSource } from '../../shared/types/comparison'

export interface ComparisonTabParams {
	left: ComparisonSource
	right: ComparisonSource
	keyColumns: ComparisonColumnMapping[]
	columnMappings: ComparisonColumnMapping[]
}

/** Module-level storage for comparison parameters per tab. */
const comparisonParams = new Map<string, ComparisonTabParams>()

export function setComparisonParams(tabId: string, params: ComparisonTabParams): void {
	comparisonParams.set(tabId, params)
}

export function getComparisonParams(tabId: string): ComparisonTabParams | undefined {
	return comparisonParams.get(tabId)
}

export function removeComparisonParams(tabId: string): void {
	comparisonParams.delete(tabId)
}
