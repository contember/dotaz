import type { WorkspaceState } from '../../shared/types/workspace'
import { storage } from './storage'

const SAVE_DEBOUNCE_MS = 1000
const MAX_EDITOR_CONTENT_SIZE = 1024 * 1024 // 1 MB per tab

let saveTimer: ReturnType<typeof setTimeout> | null = null
let stateCollector: (() => WorkspaceState) | null = null

/** Register a callback that collects current workspace state from stores. */
export function setWorkspaceStateCollector(fn: () => WorkspaceState): void {
	stateCollector = fn
}

/** Schedule a debounced workspace save. Call from store mutations. */
export function scheduleWorkspaceSave(): void {
	if (saveTimer) clearTimeout(saveTimer)
	saveTimer = setTimeout(() => {
		if (!stateCollector) return
		const state = stateCollector()
		// Cap editor content to prevent oversized workspace data
		for (const tab of state.tabs) {
			if (tab.editorContent && tab.editorContent.length > MAX_EDITOR_CONTENT_SIZE) {
				tab.editorContent = tab.editorContent.slice(0, MAX_EDITOR_CONTENT_SIZE)
			}
		}
		storage.saveWorkspace(state).catch((e) => {
			console.debug('Failed to save workspace:', e)
		})
	}, SAVE_DEBOUNCE_MS)
}

/** Load persisted workspace state. Returns null if none exists or on error. */
export async function loadWorkspace(): Promise<WorkspaceState | null> {
	try {
		return await storage.loadWorkspace()
	} catch (e) {
		console.debug('Failed to load workspace:', e)
		return null
	}
}

/** Force an immediate workspace save (e.g. on beforeunload). */
export function saveWorkspaceNow(): void {
	if (saveTimer) {
		clearTimeout(saveTimer)
		saveTimer = null
	}
	if (!stateCollector) return
	const state = stateCollector()
	for (const tab of state.tabs) {
		if (tab.editorContent && tab.editorContent.length > MAX_EDITOR_CONTENT_SIZE) {
			tab.editorContent = tab.editorContent.slice(0, MAX_EDITOR_CONTENT_SIZE)
		}
	}
	// Fire-and-forget — best effort on page unload
	storage.saveWorkspace(state).catch(() => {})
}
