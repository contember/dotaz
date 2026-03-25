import { onCleanup, onMount } from 'solid-js'
import AppShell from './components/layout/AppShell'
import { connectionsStore, initConnectionsListener } from './stores/connections'
import { editorStore } from './stores/editor'

export default function App() {
	let cleanup: (() => void) | undefined

	onMount(() => {
		cleanup = initConnectionsListener()
		connectionsStore.setOnTransactionLost((connectionId) => {
			editorStore.resetTransactionStateForConnection(connectionId)
		})
		connectionsStore.setOnConnectionLost((connectionId) => {
			editorStore.rejectPendingQueriesForConnection(connectionId)
		})
	})

	onCleanup(() => {
		cleanup?.()
		connectionsStore.setOnTransactionLost(null)
		connectionsStore.setOnConnectionLost(null)
	})

	return <AppShell />
}
