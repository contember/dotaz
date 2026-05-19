import { onCleanup, onMount } from 'solid-js'
import AppShell from './components/layout/AppShell'
import { connectionsStore, initConnectionsListener } from './stores/connections'
import { editorStore } from './stores/editor'

// Suppress the webview's native context menu (with "Inspect Element" etc.) in
// production builds. In dev we keep it so we can inspect the DOM. Component-
// level context menus call e.preventDefault() themselves and render their own
// menu via the ContextMenu component, so they keep working either way.
// Inputs and editable surfaces are exempted so users keep the native clipboard
// menu (cut/copy/paste) where they actually need it.
function preventNativeContextMenu(e: MouseEvent) {
	const target = e.target as HTMLElement | null
	if (target) {
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
			return
		}
	}
	e.preventDefault()
}

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

		if (import.meta.env.PROD) {
			document.addEventListener('contextmenu', preventNativeContextMenu)
		}
	})

	onCleanup(() => {
		cleanup?.()
		connectionsStore.setOnTransactionLost(null)
		connectionsStore.setOnConnectionLost(null)
		if (import.meta.env.PROD) {
			document.removeEventListener('contextmenu', preventNativeContextMenu)
		}
	})

	return <AppShell />
}
