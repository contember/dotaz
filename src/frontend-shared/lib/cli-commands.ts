// Handles `cli.command` — UI actions the CLI asks the app to perform (see docs/agent-cli.md).

import type { UiCommandPayload } from '@dotaz/shared/types/rpc'
import { connectionsStore } from '../stores/connections'
import { editorStore } from '../stores/editor'
import { gridStore } from '../stores/grid'
import { tabsStore } from '../stores/tabs'
import { uiStore } from '../stores/ui'
import { commandRegistry } from './commands'

function connectionName(connectionId: string): string | null {
	return connectionsStore.connections.find((c) => c.id === connectionId)?.name ?? null
}

async function openTable(command: Extract<UiCommandPayload, { kind: 'open-table' }>) {
	const conn = connectionsStore.connections.find((c) => c.id === command.connectionId)
	if (!conn) {
		uiStore.addToast('warning', 'The CLI asked to open a table on a connection that no longer exists.')
		return
	}

	const existing = tabsStore.findDefaultTab(command.connectionId, command.schema, command.table, command.database)
	const tabId = existing ?? tabsStore.openTab({
		type: 'data-grid',
		title: command.table,
		connectionId: command.connectionId,
		schema: command.schema,
		table: command.table,
		database: command.database,
	})

	// DataGrid connects and loads on its own, and racing that load would drop the filter.
	if (conn.state !== 'connected') {
		if (command.where || command.limit) {
			uiStore.addToast('warning', `${conn.name} is not connected yet — the requested filter was not applied.`)
		}
		connectionsStore.connectTo(conn.id)
		return
	}

	if (!existing) {
		await gridStore.loadTableData(tabId, command.connectionId, command.schema, command.table, command.database)
	}
	if (command.limit) {
		await gridStore.setPageSize(tabId, command.limit)
	}
	if (command.where) {
		await gridStore.setCustomFilter(tabId, command.where)
	}
}

function openConsole(command: Extract<UiCommandPayload, { kind: 'open-console' }>) {
	const name = connectionName(command.connectionId)
	if (!name) {
		uiStore.addToast('warning', 'The CLI asked to open a console on a connection that no longer exists.')
		return
	}

	const label = command.database ?? name
	const tabId = tabsStore.openTab({
		type: 'sql-console',
		title: `SQL — ${label}`,
		connectionId: command.connectionId,
		database: command.database,
	})
	editorStore.initTab(tabId, command.connectionId, command.database)
	if (command.sql) {
		editorStore.setContent(tabId, command.sql)
	}
	// Only an explicit `run` executes — a prefilled console never runs by itself.
	if (command.run && command.sql) {
		editorStore.executeQuery(tabId).catch((err) => {
			uiStore.addToast('error', `Failed to run the requested SQL: ${err instanceof Error ? err.message : String(err)}`)
		})
	}
}

export function handleUiCommand(command: UiCommandPayload): void {
	switch (command.kind) {
		case 'open-table':
			openTable(command).catch((err) => {
				uiStore.addToast('error', `Failed to open ${command.table}: ${err instanceof Error ? err.message : String(err)}`)
			})
			return
		case 'open-console':
			openConsole(command)
			return
		case 'run-command': {
			if (!commandRegistry.getById(command.commandId)) {
				console.warn(`CLI requested an unknown command: ${command.commandId}`)
				uiStore.addToast('warning', `Unknown command: ${command.commandId}`)
				return
			}
			commandRegistry.execute(command.commandId)
			return
		}
	}
}
