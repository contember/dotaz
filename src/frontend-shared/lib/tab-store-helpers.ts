/**
 * Creates getTab/ensureTab helpers for stores that manage per-tab state
 * in a Record<string, T>.
 */
export function createTabHelpers<T>(
	getTabs: () => Record<string, T>,
	storeName: string,
) {
	function getTab(tabId: string): T | undefined {
		return getTabs()[tabId]
	}

	function ensureTab(tabId: string): T {
		const tab = getTab(tabId)
		if (!tab) {
			throw new Error(`${storeName} state not found for tab ${tabId}`)
		}
		return tab
	}

	return { getTab, ensureTab }
}
