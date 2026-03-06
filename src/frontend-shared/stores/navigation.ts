import { createSignal } from 'solid-js'
import { tabsStore } from './tabs'

// ── Types ────────────────────────────────────────────────

interface NavigationEntry {
	tabId: string
}

// ── State ────────────────────────────────────────────────

const MAX_ENTRIES = 50

const backStack: NavigationEntry[] = []
const forwardStack: NavigationEntry[] = []
const [canGoBack, setCanGoBack] = createSignal(false)
const [canGoForward, setCanGoForward] = createSignal(false)

/** Suppresses recording during goBack/goForward execution. */
let navigating = false

/** Monotonically increasing position counter for browser history integration. */
let navPosition = 0

/** Tracks where we expect to be in browser history. */
let expectedPosition = 0

function updateSignals() {
	setCanGoBack(backStack.length > 0)
	setCanGoForward(forwardStack.length > 0)
}

function getCurrentEntry(): NavigationEntry | null {
	const tabId = tabsStore.activeTabId
	if (!tabId) return null
	return { tabId }
}

function entriesMatch(a: NavigationEntry, b: NavigationEntry): boolean {
	return a.tabId === b.tabId
}

function pushCurrent() {
	if (navigating) return
	const entry = getCurrentEntry()
	if (!entry) return

	// Deduplicate: skip if top of backStack matches
	if (backStack.length > 0 && entriesMatch(backStack[backStack.length - 1], entry)) {
		return
	}

	backStack.push(entry)
	if (backStack.length > MAX_ENTRIES) {
		backStack.shift()
	}

	// Any new navigation clears the forward stack
	forwardStack.length = 0

	// Push browser history entry so back/forward buttons trigger popstate
	navPosition++
	expectedPosition = navPosition
	history.pushState({ __dotazNav: navPosition }, '')

	updateSignals()
}

async function navigateToEntry(entry: NavigationEntry) {
	// Switch to the target tab if needed
	if (tabsStore.activeTabId !== entry.tabId) {
		tabsStore.setActiveTab(entry.tabId)
	}
}

/** Internal back navigation — called from popstate handler. */
async function doGoBack() {
	if (backStack.length === 0) return

	const current = getCurrentEntry()
	const target = backStack.pop()!

	if (current) {
		forwardStack.push(current)
	}

	navigating = true
	try {
		await navigateToEntry(target)
	} finally {
		navigating = false
	}
	updateSignals()
}

/** Internal forward navigation — called from popstate handler. */
async function doGoForward() {
	if (forwardStack.length === 0) return

	const current = getCurrentEntry()
	const target = forwardStack.pop()!

	if (current) {
		backStack.push(current)
		if (backStack.length > MAX_ENTRIES) {
			backStack.shift()
		}
	}

	navigating = true
	try {
		await navigateToEntry(target)
	} finally {
		navigating = false
	}
	updateSignals()
}

/** Triggers browser back, which fires popstate → doGoBack. */
function goBack() {
	if (backStack.length === 0) return
	history.back()
}

/** Triggers browser forward, which fires popstate → doGoForward. */
function goForward() {
	if (forwardStack.length === 0) return
	history.forward()
}

function handlePopState(e: PopStateEvent) {
	const state = e.state
	if (!state || typeof state.__dotazNav !== 'number') return

	const targetPos = state.__dotazNav
	if (targetPos < expectedPosition) {
		expectedPosition = targetPos
		doGoBack()
	} else if (targetPos > expectedPosition) {
		expectedPosition = targetPos
		doGoForward()
	}
}

function handleTabClosed(tabId: string) {
	// Remove all entries referencing the closed tab
	for (let i = backStack.length - 1; i >= 0; i--) {
		if (backStack[i].tabId === tabId) backStack.splice(i, 1)
	}
	for (let i = forwardStack.length - 1; i >= 0; i--) {
		if (forwardStack[i].tabId === tabId) forwardStack.splice(i, 1)
	}
	updateSignals()
}

// ── Register callbacks ───────────────────────────────────

tabsStore.onBeforeTabChange(() => pushCurrent())

// ── Lifecycle ────────────────────────────────────────────

let initialized = false

function init() {
	if (initialized) return
	initialized = true
	// Set base history state so we can detect direction from popstate
	history.replaceState({ __dotazNav: 0 }, '')
	window.addEventListener('popstate', handlePopState)
}

function destroy() {
	if (!initialized) return
	initialized = false
	window.removeEventListener('popstate', handlePopState)
}

// ── Export ────────────────────────────────────────────────

export const navigationStore = {
	get canGoBack() {
		return canGoBack()
	},
	get canGoForward() {
		return canGoForward()
	},
	goBack,
	goForward,
	handleTabClosed,
	init,
	destroy,
}
