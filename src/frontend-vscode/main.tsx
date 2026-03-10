import { setCapabilities } from '@dotaz/frontend-shared/lib/capabilities'
import { setShortcutMode } from '@dotaz/frontend-shared/lib/keyboard'
import { setStorage } from '@dotaz/frontend-shared/lib/storage'
import { RpcAppStateStorage } from '@dotaz/frontend-shared/lib/storage/rpc'
import { setTransport } from '@dotaz/frontend-shared/lib/transport'
import { render } from 'solid-js/web'
import type { DotazPanelContext } from './PanelRoot'
import { createVscodeTransport } from './transport'
import '../frontend-shared/styles/global.css'

setTransport(createVscodeTransport())
setStorage(new RpcAppStateStorage())
setCapabilities({ hasFileSystem: true, hasHttpStreaming: false, hasNativeDialogs: true })
setShortcutMode('browser')

const context = (window as any).__DOTAZ_CONTEXT__ as DotazPanelContext | undefined
const root = document.getElementById('app')!

if (context?.type && context.type !== 'full-app') {
	import('./PanelRoot').then(({ default: PanelRoot }) => {
		render(() => <PanelRoot context={context} />, root)
	})
} else {
	import('@dotaz/frontend-shared/App').then(({ default: App }) => {
		render(() => <App />, root)
	})
}
