import { createStore } from 'solid-js/store'
import type { SavedView } from '@dotaz/shared/types/rpc'
import { storage } from '../lib/storage'

interface ViewsState {
	viewsByConnection: Record<string, SavedView[]>
}

const [state, setState] = createStore<ViewsState>({
	viewsByConnection: {},
})

async function loadViewsForConnection(connectionId: string) {
	try {
		const views = await storage.listViewsByConnection(connectionId)
		setState('viewsByConnection', connectionId, views)
	} catch {
		// Non-critical — sidebar still works without views
	}
}

function getViewsForTable(connectionId: string, schema: string, table: string): SavedView[] {
	const views = state.viewsByConnection[connectionId]
	if (!views) return []
	return views.filter((v) => v.schemaName === schema && v.tableName === table)
}

function getViewById(connectionId: string, viewId: string): SavedView | undefined {
	const views = state.viewsByConnection[connectionId]
	if (!views) return undefined
	return views.find((v) => v.id === viewId)
}

async function refreshViews(connectionId: string) {
	await loadViewsForConnection(connectionId)
}

function clearViews(connectionId: string) {
	setState('viewsByConnection', connectionId, undefined!)
}

export const viewsStore = {
	get viewsByConnection() {
		return state.viewsByConnection
	},
	loadViewsForConnection,
	getViewsForTable,
	getViewById,
	refreshViews,
	clearViews,
}
