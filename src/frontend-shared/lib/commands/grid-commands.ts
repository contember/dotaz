import { connectionsStore } from '../../stores/connections'
import { gridStore } from '../../stores/grid'
import { tabsStore } from '../../stores/tabs'
import type { AppCommandActions } from '../app-commands'
import { commandRegistry } from '../commands'

export function registerGridCommands(actions: AppCommandActions): void {
	commandRegistry.register({
		id: 'refresh-data',
		label: 'Refresh Data',
		shortcut: 'F5',
		category: 'Grid',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'data-grid') {
				gridStore.refreshData(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'inline-edit',
		label: 'Edit Cell',
		shortcut: 'F2',
		category: 'Grid',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type !== 'data-grid') return
			const gridTab = gridStore.getTab(tab.id)
			const focused = gridTab?.selection.focusedCell
			if (!focused) return
			const visibleCols = gridStore.getVisibleColumns(gridTab)
			const col = visibleCols[focused.col]
			if (!col) return
			if (gridStore.isRowDeleted(tab.id, focused.row)) return
			gridStore.startEditing(tab.id, focused.row, col.name)
		},
	})

	commandRegistry.register({
		id: 'delete-rows',
		label: 'Delete Selected Rows',
		shortcut: 'Delete',
		category: 'Grid',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'data-grid') {
				gridStore.deleteSelectedRows(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'export-data',
		label: 'Export Data',
		category: 'Grid',
		handler: () => {
			// Export is managed by the ExportDialog within DataGrid
		},
	})

	commandRegistry.register({
		id: 'toggle-transpose',
		label: 'Toggle Transpose View',
		shortcut: 'Ctrl+Shift+T',
		category: 'Grid',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'data-grid') {
				gridStore.toggleTranspose(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'toggle-value-editor',
		label: 'Toggle Value Editor Panel',
		shortcut: 'Ctrl+Shift+E',
		category: 'Grid',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'data-grid') {
				gridStore.toggleValueEditor(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'save-view',
		label: 'Save View',
		shortcut: 'Ctrl+S',
		category: 'Grid',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'data-grid') {
				window.dispatchEvent(
					new CustomEvent('dotaz:save-view', { detail: { tabId: tab.id } }),
				)
			}
		},
	})

	commandRegistry.register({
		id: 'undo',
		label: 'Undo',
		shortcut: 'Ctrl+Z',
		category: 'Grid',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'data-grid') {
				gridStore.undo(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'redo',
		label: 'Redo',
		shortcut: 'Ctrl+Shift+Z',
		category: 'Grid',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type === 'data-grid') {
				gridStore.redo(tab.id)
			}
		},
	})

	commandRegistry.register({
		id: 'add-new-row',
		label: 'Add New Row',
		shortcut: 'Ctrl+Enter',
		category: 'Grid',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab?.type !== 'data-grid') return
			if (connectionsStore.isReadOnly(tab.connectionId)) return
			window.dispatchEvent(
				new CustomEvent('dotaz:add-new-row', { detail: { tabId: tab.id } }),
			)
		},
	})

	commandRegistry.register({
		id: 'compare-data',
		label: 'Compare Data',
		category: 'Grid',
		handler: () => {
			const tab = tabsStore.activeTab
			const initialLeft = tab?.type === 'data-grid' && tab.schema && tab.table
				? { connectionId: tab.connectionId, schema: tab.schema, table: tab.table, database: tab.database }
				: undefined
			actions.setModal({ type: 'compare', initialLeft })
		},
	})
}
