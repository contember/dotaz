import { commandRegistry } from '../commands'
import type { AppCommandActions } from '../app-commands'
import { connectionsStore } from '../../stores/connections'

export function registerConnectionCommands(actions: AppCommandActions): void {
	commandRegistry.register({
		id: 'connect',
		label: 'Connect',
		category: 'Connection',
		handler: () => {
			const conn = connectionsStore.activeConnection
			if (conn && conn.state === 'disconnected') {
				connectionsStore.connectTo(conn.id)
			}
		},
	})

	commandRegistry.register({
		id: 'disconnect',
		label: 'Disconnect',
		category: 'Connection',
		handler: () => {
			const conn = connectionsStore.activeConnection
			if (conn && conn.state === 'connected') {
				connectionsStore.disconnectFrom(conn.id)
			}
		},
	})

	commandRegistry.register({
		id: 'reconnect',
		label: 'Reconnect',
		category: 'Connection',
		handler: async () => {
			const conn = connectionsStore.activeConnection
			if (!conn) return
			if (conn.state === 'connected') {
				await connectionsStore.disconnectFrom(conn.id)
			}
			connectionsStore.connectTo(conn.id)
		},
	})

	commandRegistry.register({
		id: 'new-connection',
		label: 'New Connection',
		category: 'Connection',
		handler: () => actions.openAddConnectionDialog(),
	})

	commandRegistry.register({
		id: 'search-database',
		label: 'Search Database',
		category: 'Connection',
		handler: () => {
			const conn = connectionsStore.activeConnection
			actions.setModal({ type: 'search', connId: conn?.id })
		},
	})
}
