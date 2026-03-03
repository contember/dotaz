import { onCleanup, onMount } from 'solid-js'
import AppShell from './components/layout/AppShell'
import { initConnectionsListener } from './stores/connections'

export default function App() {
	let cleanup: (() => void) | undefined

	onMount(() => {
		cleanup = initConnectionsListener()
	})

	onCleanup(() => {
		cleanup?.()
	})

	return <AppShell />
}
