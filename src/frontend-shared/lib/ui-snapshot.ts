// What the user currently has open, published for the CLI's `ui.state` (see docs/agent-cli.md).

import type { UiSnapshot, UiTabSnapshot } from '@dotaz/shared/types/rpc'
import type { TabInfo } from '@dotaz/shared/types/tab'
import { createEffect, onCleanup } from 'solid-js'
import { connectionsStore } from '../stores/connections'
import { editorStore } from '../stores/editor'
import { tabsStore } from '../stores/tabs'
import { getCapabilities } from './capabilities'
import { rpc } from './rpc'

/** Wait this long after the last change before publishing — typing must not spam RPC. */
const PUBLISH_DEBOUNCE_MS = 400

export interface UiSnapshotSource {
	tabs: readonly TabInfo[]
	activeTabId: string | null
	activeConnectionId: string | null
	/** Current editor contents of a SQL console tab. */
	getSql: (tabId: string) => string | undefined
	now: number
}

export function buildUiSnapshot(source: UiSnapshotSource): UiSnapshot {
	const tabs: UiTabSnapshot[] = source.tabs.map((tab) => {
		const snapshot: UiTabSnapshot = {
			id: tab.id,
			type: tab.type,
			title: tab.title,
			connectionId: tab.connectionId,
		}
		if (tab.database) snapshot.database = tab.database
		if (tab.schema) snapshot.schema = tab.schema
		if (tab.table) snapshot.table = tab.table
		if (tab.type === 'sql-console') {
			const sql = source.getSql(tab.id)
			if (sql) snapshot.sql = sql
		}
		return snapshot
	})
	return {
		tabs,
		activeTabId: source.activeTabId,
		activeConnectionId: source.activeConnectionId,
		updatedAt: source.now,
	}
}

/**
 * Publish the snapshot whenever tabs, the active tab or the active connection change.
 * Only desktop has a control endpoint, so other modes would publish into the void.
 */
export function initUiSnapshotPublisher(): void {
	if (!getCapabilities().isDesktop) return

	let timer: ReturnType<typeof setTimeout> | undefined

	createEffect(() => {
		const snapshot = buildUiSnapshot({
			tabs: tabsStore.openTabs,
			activeTabId: tabsStore.activeTabId,
			activeConnectionId: connectionsStore.activeConnectionId,
			getSql: (tabId) => editorStore.getTab(tabId)?.content,
			now: Date.now(),
		})
		clearTimeout(timer)
		timer = setTimeout(() => {
			rpc.ui['snapshot.set']({ snapshot }).catch((err) => {
				console.debug('Failed to publish UI snapshot:', err)
			})
		}, PUBLISH_DEBOUNCE_MS)
	})

	onCleanup(() => clearTimeout(timer))
}
