// What the user currently has open, published for the CLI's `ui.state` (see docs/agent-cli.md).
//
// Kept free of store imports so it stays a pure, independently testable mapping — the
// publisher that reads the live stores lives in ui-snapshot-publisher.ts.

import type { UiSnapshot, UiTabSnapshot } from '@dotaz/shared/types/rpc'
import type { TabInfo } from '@dotaz/shared/types/tab'

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
