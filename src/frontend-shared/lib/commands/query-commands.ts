import { commandRegistry } from '../commands'
import { platformShortcut } from '../keyboard'
import type { AppCommandActions } from '../app-commands'
import { connectionsStore } from '../../stores/connections'
import { editorStore } from '../../stores/editor'
import { tabsStore } from '../../stores/tabs'

export function registerQueryCommands(actions: AppCommandActions): void {
	commandRegistry.register({
		id: 'new-sql-console',
		label: 'New SQL Console',
		shortcut: platformShortcut('new-sql-console'),
		category: 'Query',
		handler: () => {
			const conn = connectionsStore.activeConnection
			if (!conn) return
			const activeTab = tabsStore.activeTab
			const database = activeTab?.connectionId === conn.id ? activeTab?.database : undefined
			const label = database ?? conn.name
			const tabId = tabsStore.openTab({
				type: 'sql-console',
				title: `SQL — ${label}`,
				connectionId: conn.id,
				database,
			})
			editorStore.initTab(tabId, conn.id, database)
		},
	})

	commandRegistry.register({
		id: 'format-sql',
		label: 'Format SQL',
		shortcut: 'Ctrl+Shift+F',
		category: 'Query',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'sql-console') {
				editorStore.formatSql(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'run-query',
		label: 'Run Query',
		shortcut: 'Ctrl+Enter',
		category: 'Query',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'sql-console') {
				editorStore.executeQuery(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'cancel-query',
		label: 'Cancel Query',
		shortcut: 'Escape',
		category: 'Query',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'sql-console') {
				editorStore.cancelQuery(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'commit-transaction',
		label: 'Commit Transaction',
		shortcut: 'Ctrl+Shift+Enter',
		category: 'Query',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'sql-console') {
				editorStore.commitTransaction(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'rollback-transaction',
		label: 'Rollback Transaction',
		shortcut: 'Ctrl+Shift+R',
		category: 'Query',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'sql-console') {
				editorStore.rollbackTransaction(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'bookmark-query',
		label: 'Bookmark Query',
		shortcut: 'Ctrl+D',
		category: 'Query',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'sql-console') {
				const editorTab = editorStore.getTab(tab.id)
				const sql = editorTab?.content.trim()
				actions.setModal({ type: 'bookmarks', sql: sql || undefined, connId: tab.connectionId, db: tab.database })
			}
		},
	})

	commandRegistry.register({
		id: 'open-bookmarks',
		label: 'Open Bookmarks',
		category: 'Query',
		handler: () => {
			const tab = tabsStore.activeTab
			actions.setModal({
				type: 'bookmarks',
				connId: tab?.connectionId,
				db: tab?.type === 'sql-console' ? tab.database : undefined,
			})
		},
	})

	commandRegistry.register({
		id: 'ai-generate-sql',
		label: 'Generate SQL with AI',
		shortcut: 'Ctrl+G',
		category: 'Query',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'sql-console') {
				editorStore.toggleAiPrompt(tab.id)
			}
		},
	})
}
