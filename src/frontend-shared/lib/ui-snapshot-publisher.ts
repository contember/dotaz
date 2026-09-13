// Publishes the UI snapshot the CLI reads through `ui.state` (see docs/agent-cli.md).

import { createEffect, onCleanup } from 'solid-js'
import { connectionsStore } from '../stores/connections'
import { editorStore } from '../stores/editor'
import { tabsStore } from '../stores/tabs'
import { getCapabilities } from './capabilities'
import { rpc } from './rpc'
import { buildUiSnapshot } from './ui-snapshot'

/** Wait this long after the last change before publishing — typing must not spam RPC. */
const PUBLISH_DEBOUNCE_MS = 400

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
