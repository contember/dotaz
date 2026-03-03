import { createStore } from 'solid-js/store'
import type { TabInfo, TabType } from '../../shared/types/tab'
import { scheduleWorkspaceSave } from '../lib/workspace'

export interface TabState {
	openTabs: TabInfo[]
	activeTabId: string | null
}

export interface OpenTabConfig {
	type: TabType
	title: string
	connectionId: string
	schema?: string
	table?: string
	database?: string
	viewId?: string
	viewName?: string
	primaryKeys?: Record<string, unknown>
}

const [state, setState] = createStore<TabState>({
	openTabs: [],
	activeTabId: null,
})

/**
 * Optional hook called before closing a tab.
 * Returns false to prevent close. Can perform side effects (like rollback).
 */
let beforeCloseHook: ((tab: TabInfo) => boolean) | null = null

/** Callbacks invoked after a tab is closed, for state cleanup. */
const afterCloseCallbacks: ((tabId: string) => void)[] = []

/** Callbacks invoked before the active tab changes (for navigation history). */
const beforeTabChangeCallbacks: (() => void)[] = []

function onBeforeTabChange(cb: () => void) {
	beforeTabChangeCallbacks.push(cb)
}

/** Central helper for changing the active tab. Fires beforeTabChange callbacks unless silent. */
function changeActiveTab(id: string | null, silent = false) {
	if (id === state.activeTabId) return
	if (!silent && state.activeTabId !== null && id !== null) {
		for (const cb of beforeTabChangeCallbacks) cb()
	}
	setState('activeTabId', id)
}

function setBeforeCloseHook(hook: ((tab: TabInfo) => boolean) | null) {
	beforeCloseHook = hook
}

function onTabClosed(callback: (tabId: string) => void) {
	afterCloseCallbacks.push(callback)
}

function openTab(config: OpenTabConfig): string {
	const id = crypto.randomUUID()
	const tab: TabInfo = {
		id,
		type: config.type,
		title: config.title,
		connectionId: config.connectionId,
		schema: config.schema,
		table: config.table,
		database: config.database,
		dirty: false,
		viewId: config.viewId,
		viewName: config.viewName,
		primaryKeys: config.primaryKeys,
	}
	setState('openTabs', (tabs) => [...tabs, tab])
	changeActiveTab(id)
	scheduleWorkspaceSave()
	return id
}

/** Restore a tab from persisted workspace state (preserving its original ID). */
function restoreTab(tab: TabInfo): void {
	setState('openTabs', (tabs) => [...tabs, { ...tab, dirty: false }])
}

function setActiveTab(id: string) {
	const exists = state.openTabs.some((t) => t.id === id)
	if (exists) {
		changeActiveTab(id)
		scheduleWorkspaceSave()
	}
}

function closeTab(id: string) {
	const tab = state.openTabs.find((t) => t.id === id)
	if (!tab) return

	// Run before-close hook (e.g. transaction warnings)
	if (beforeCloseHook && !beforeCloseHook(tab)) {
		return
	}

	if (tab.dirty) {
		const confirmed = window.confirm(
			`"${tab.title}" has unsaved changes. Close anyway?`,
		)
		if (!confirmed) return
	}

	const idx = state.openTabs.findIndex((t) => t.id === id)
	setState('openTabs', (tabs) => tabs.filter((t) => t.id !== id))

	if (state.activeTabId === id) {
		const remaining = state.openTabs
		// Prefer the tab to the right, then to the left, then null
		const nextTab = remaining[idx] ?? remaining[idx - 1] ?? null
		changeActiveTab(nextTab?.id ?? null, true)
	}

	for (const cb of afterCloseCallbacks) cb(id)
	scheduleWorkspaceSave()
}

function closeOtherTabs(id: string) {
	const dirtyOthers = state.openTabs.filter(
		(t) => t.id !== id && t.dirty,
	)
	if (dirtyOthers.length > 0) {
		const confirmed = window.confirm(
			`${dirtyOthers.length} tab(s) have unsaved changes. Close them anyway?`,
		)
		if (!confirmed) return
	}

	const closedIds = state.openTabs.filter((t) => t.id !== id).map((t) => t.id)
	const kept = state.openTabs.find((t) => t.id === id)
	if (kept) {
		setState('openTabs', [kept])
		changeActiveTab(id, true)
	}
	for (const closedId of closedIds) {
		for (const cb of afterCloseCallbacks) cb(closedId)
	}
	scheduleWorkspaceSave()
}

function closeAllTabs() {
	const dirtyTabs = state.openTabs.filter((t) => t.dirty)
	if (dirtyTabs.length > 0) {
		const confirmed = window.confirm(
			`${dirtyTabs.length} tab(s) have unsaved changes. Close all anyway?`,
		)
		if (!confirmed) return
	}

	const closedIds = state.openTabs.map((t) => t.id)
	setState('openTabs', [])
	changeActiveTab(null, true)
	for (const id of closedIds) {
		for (const cb of afterCloseCallbacks) cb(id)
	}
	scheduleWorkspaceSave()
}

function reorderTabs(fromIndex: number, toIndex: number) {
	if (fromIndex === toIndex) return
	const tabs = [...state.openTabs]
	if (fromIndex < 0 || fromIndex >= tabs.length) return
	if (toIndex < 0 || toIndex >= tabs.length) return

	const [moved] = tabs.splice(fromIndex, 1)
	tabs.splice(toIndex, 0, moved)
	setState('openTabs', tabs)
	scheduleWorkspaceSave()
}

function renameTab(id: string, title: string) {
	const idx = state.openTabs.findIndex((t) => t.id === id)
	if (idx !== -1) {
		setState('openTabs', idx, 'title', title)
	}
}

function setTabDirty(id: string, dirty: boolean) {
	const idx = state.openTabs.findIndex((t) => t.id === id)
	if (idx !== -1) {
		setState('openTabs', idx, 'dirty', dirty)
	}
}

function activateNextTab() {
	const tabs = state.openTabs
	if (tabs.length <= 1) return
	const idx = tabs.findIndex((t) => t.id === state.activeTabId)
	if (idx === -1) return
	const next = (idx + 1) % tabs.length
	changeActiveTab(tabs[next].id)
}

function activatePrevTab() {
	const tabs = state.openTabs
	if (tabs.length <= 1) return
	const idx = tabs.findIndex((t) => t.id === state.activeTabId)
	if (idx === -1) return
	const prev = (idx - 1 + tabs.length) % tabs.length
	changeActiveTab(tabs[prev].id)
}

/** Find an open default (no viewId) data-grid tab for the given table and focus it. Returns tab ID or null. */
function findDefaultTab(connectionId: string, schema: string, table: string, database?: string): string | null {
	const found = state.openTabs.find(
		(t) =>
			t.type === 'data-grid' && t.connectionId === connectionId && t.schema === schema && t.table === table && t.database === database && !t.viewId,
	)
	if (found) {
		changeActiveTab(found.id)
		return found.id
	}
	return null
}

/** Find an open tab for the given saved view and focus it. Returns tab ID or null. */
function findViewTab(viewId: string): string | null {
	const found = state.openTabs.find((t) => t.viewId === viewId)
	if (found) {
		changeActiveTab(found.id)
		return found.id
	}
	return null
}

/** Associate a tab with a saved view. */
function setTabView(tabId: string, viewId: string, viewName: string) {
	const idx = state.openTabs.findIndex((t) => t.id === tabId)
	if (idx !== -1) {
		setState('openTabs', idx, 'viewId', viewId)
		setState('openTabs', idx, 'viewName', viewName)
		setState('openTabs', idx, 'viewModified', false)
	}
}

/** Clear the view association from a tab (revert to default tab). */
function clearTabView(tabId: string) {
	const idx = state.openTabs.findIndex((t) => t.id === tabId)
	if (idx !== -1) {
		setState('openTabs', idx, 'viewId', undefined)
		setState('openTabs', idx, 'viewName', undefined)
		setState('openTabs', idx, 'viewModified', false)
	}
}

/** Set the viewModified flag on a tab. */
function setViewModified(tabId: string, modified: boolean) {
	const idx = state.openTabs.findIndex((t) => t.id === tabId)
	if (idx !== -1) {
		setState('openTabs', idx, 'viewModified', modified)
	}
}

export const tabsStore = {
	get openTabs() {
		return state.openTabs
	},
	get activeTabId() {
		return state.activeTabId
	},
	get activeTab() {
		return state.openTabs.find((t) => t.id === state.activeTabId) ?? null
	},
	openTab,
	restoreTab,
	setActiveTab,
	closeTab,
	closeOtherTabs,
	closeAllTabs,
	reorderTabs,
	renameTab,
	setTabDirty,
	activateNextTab,
	activatePrevTab,
	findDefaultTab,
	findViewTab,
	setTabView,
	clearTabView,
	setViewModified,
	setBeforeCloseHook,
	onTabClosed,
	onBeforeTabChange,
}
