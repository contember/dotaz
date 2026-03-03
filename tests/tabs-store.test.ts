import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock solid-js/store before importing the module
// We replicate createStore behavior for testing
let storeState: any
let setStore: any

mock.module('solid-js/store', () => ({
	createStore: (initial: any) => {
		storeState = structuredClone(initial)

		setStore = (...args: any[]) => {
			if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'function') {
				// setState("key", fn)
				storeState[args[0]] = args[1](storeState[args[0]])
			} else if (args.length === 2 && typeof args[0] === 'string') {
				// setState("key", value)
				storeState[args[0]] = args[1]
			} else if (args.length === 4) {
				// setState("openTabs", idx, "field", value)
				const [, idx, field, value] = args
				storeState.openTabs[idx][field] = value
			}
		}

		return [storeState, setStore]
	},
}))

// Must import after mock
const { tabsStore } = await import('../src/frontend-shared/stores/tabs')

// Mock window.confirm
const originalConfirm = globalThis.window?.confirm

function mockConfirm(result: boolean) {
	;(globalThis as any).window = { confirm: () => result }
}

function restoreConfirm() {
	if (originalConfirm) {
		;(globalThis as any).window = { confirm: originalConfirm }
	}
}

describe('tabs store', () => {
	beforeEach(() => {
		// Reset store state
		storeState.openTabs = []
		storeState.activeTabId = null
		restoreConfirm()
	})

	describe('openTab', () => {
		test('opens a tab and sets it as active', () => {
			const id = tabsStore.openTab({
				type: 'data-grid',
				title: 'users',
				connectionId: 'conn-1',
				schema: 'public',
				table: 'users',
			})

			expect(id).toBeTruthy()
			expect(tabsStore.openTabs).toHaveLength(1)
			expect(tabsStore.openTabs[0].id).toBe(id)
			expect(tabsStore.openTabs[0].type).toBe('data-grid')
			expect(tabsStore.openTabs[0].title).toBe('users')
			expect(tabsStore.openTabs[0].connectionId).toBe('conn-1')
			expect(tabsStore.openTabs[0].dirty).toBe(false)
			expect(tabsStore.activeTabId).toBe(id)
		})

		test('each tab gets a unique ID', () => {
			const id1 = tabsStore.openTab({
				type: 'data-grid',
				title: 'tab1',
				connectionId: 'conn-1',
			})
			const id2 = tabsStore.openTab({
				type: 'sql-console',
				title: 'tab2',
				connectionId: 'conn-1',
			})

			expect(id1).not.toBe(id2)
			expect(tabsStore.openTabs).toHaveLength(2)
		})

		test('newly opened tab becomes active', () => {
			tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			const id2 = tabsStore.openTab({ type: 'sql-console', title: 'tab2', connectionId: 'c1' })

			expect(tabsStore.activeTabId).toBe(id2)
		})
	})

	describe('setActiveTab', () => {
		test('switches active tab', () => {
			const id1 = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			tabsStore.openTab({ type: 'sql-console', title: 'tab2', connectionId: 'c1' })

			tabsStore.setActiveTab(id1)
			expect(tabsStore.activeTabId).toBe(id1)
		})

		test('ignores non-existent tab ID', () => {
			const id1 = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })

			tabsStore.setActiveTab('nonexistent')
			expect(tabsStore.activeTabId).toBe(id1)
		})
	})

	describe('closeTab', () => {
		test('closes a tab', () => {
			const id = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })

			tabsStore.closeTab(id)
			expect(tabsStore.openTabs).toHaveLength(0)
			expect(tabsStore.activeTabId).toBeNull()
		})

		test('activates adjacent tab after closing active tab', () => {
			const id1 = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			const id2 = tabsStore.openTab({ type: 'sql-console', title: 'tab2', connectionId: 'c1' })
			const id3 = tabsStore.openTab({ type: 'data-grid', title: 'tab3', connectionId: 'c1' })

			// Close middle tab (active is tab3)
			tabsStore.setActiveTab(id2)
			tabsStore.closeTab(id2)

			// Should activate tab to the right (id3) or left (id1)
			expect(tabsStore.activeTabId).not.toBeNull()
			expect(tabsStore.openTabs).toHaveLength(2)
		})

		test('does not close dirty tab without confirmation', () => {
			const id = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			tabsStore.setTabDirty(id, true)
			mockConfirm(false)

			tabsStore.closeTab(id)
			expect(tabsStore.openTabs).toHaveLength(1)
		})

		test('closes dirty tab with confirmation', () => {
			const id = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			tabsStore.setTabDirty(id, true)
			mockConfirm(true)

			tabsStore.closeTab(id)
			expect(tabsStore.openTabs).toHaveLength(0)
		})

		test('does nothing for non-existent tab', () => {
			tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })

			tabsStore.closeTab('nonexistent')
			expect(tabsStore.openTabs).toHaveLength(1)
		})
	})

	describe('closeOtherTabs', () => {
		test('closes all tabs except the specified one', () => {
			tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			const id2 = tabsStore.openTab({ type: 'sql-console', title: 'tab2', connectionId: 'c1' })
			tabsStore.openTab({ type: 'data-grid', title: 'tab3', connectionId: 'c1' })

			tabsStore.closeOtherTabs(id2)
			expect(tabsStore.openTabs).toHaveLength(1)
			expect(tabsStore.openTabs[0].id).toBe(id2)
			expect(tabsStore.activeTabId).toBe(id2)
		})

		test('prompts confirmation when dirty tabs exist', () => {
			const id1 = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			const id2 = tabsStore.openTab({ type: 'sql-console', title: 'tab2', connectionId: 'c1' })
			tabsStore.setTabDirty(id1, true)
			mockConfirm(false)

			tabsStore.closeOtherTabs(id2)
			// Should not close because user denied
			expect(tabsStore.openTabs).toHaveLength(2)
		})
	})

	describe('closeAllTabs', () => {
		test('closes all tabs', () => {
			tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			tabsStore.openTab({ type: 'sql-console', title: 'tab2', connectionId: 'c1' })

			tabsStore.closeAllTabs()
			expect(tabsStore.openTabs).toHaveLength(0)
			expect(tabsStore.activeTabId).toBeNull()
		})

		test('prompts confirmation when dirty tabs exist', () => {
			const id = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			tabsStore.setTabDirty(id, true)
			mockConfirm(false)

			tabsStore.closeAllTabs()
			expect(tabsStore.openTabs).toHaveLength(1)
		})
	})

	describe('reorderTabs', () => {
		test('moves a tab from one position to another', () => {
			const id1 = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			const id2 = tabsStore.openTab({ type: 'sql-console', title: 'tab2', connectionId: 'c1' })
			const id3 = tabsStore.openTab({ type: 'data-grid', title: 'tab3', connectionId: 'c1' })

			tabsStore.reorderTabs(0, 2)
			expect(tabsStore.openTabs[0].id).toBe(id2)
			expect(tabsStore.openTabs[1].id).toBe(id3)
			expect(tabsStore.openTabs[2].id).toBe(id1)
		})

		test('no-op for same index', () => {
			const id1 = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })

			tabsStore.reorderTabs(0, 0)
			expect(tabsStore.openTabs[0].id).toBe(id1)
		})

		test('ignores out-of-bounds indices', () => {
			tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })

			tabsStore.reorderTabs(-1, 5)
			expect(tabsStore.openTabs).toHaveLength(1)
		})
	})

	describe('renameTab', () => {
		test('renames a tab', () => {
			const id = tabsStore.openTab({ type: 'sql-console', title: 'Query 1', connectionId: 'c1' })

			tabsStore.renameTab(id, 'My Custom Query')
			expect(tabsStore.openTabs[0].title).toBe('My Custom Query')
		})

		test('ignores non-existent tab', () => {
			tabsStore.openTab({ type: 'sql-console', title: 'Query 1', connectionId: 'c1' })

			tabsStore.renameTab('nonexistent', 'New Name')
			expect(tabsStore.openTabs[0].title).toBe('Query 1')
		})
	})

	describe('setTabDirty', () => {
		test('marks tab as dirty', () => {
			const id = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })

			tabsStore.setTabDirty(id, true)
			expect(tabsStore.openTabs[0].dirty).toBe(true)
		})

		test('clears dirty flag', () => {
			const id = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })
			tabsStore.setTabDirty(id, true)

			tabsStore.setTabDirty(id, false)
			expect(tabsStore.openTabs[0].dirty).toBe(false)
		})
	})

	describe('activeTab', () => {
		test('returns the active tab object', () => {
			const id = tabsStore.openTab({ type: 'data-grid', title: 'tab1', connectionId: 'c1' })

			expect(tabsStore.activeTab).not.toBeNull()
			expect(tabsStore.activeTab?.id).toBe(id)
			expect(tabsStore.activeTab?.title).toBe('tab1')
		})

		test('returns null when no active tab', () => {
			expect(tabsStore.activeTab).toBeNull()
		})
	})
})
