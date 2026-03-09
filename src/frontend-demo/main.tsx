import { setCapabilities } from '@dotaz/frontend-shared/lib/capabilities'
import { setShortcutMode } from '@dotaz/frontend-shared/lib/keyboard'
import { setStorage } from '@dotaz/frontend-shared/lib/storage'
import { RpcAppStateStorage } from '@dotaz/frontend-shared/lib/storage/rpc'
import { setTransport } from '@dotaz/frontend-shared/lib/transport'
import { createInlineTransport } from './transport'
import '../frontend-shared/styles/global.css'
import { render } from 'solid-js/web'
import App from '@dotaz/frontend-shared/App'

setTransport(createInlineTransport())
setStorage(new RpcAppStateStorage())
setCapabilities({ hasFileSystem: false, hasHttpStreaming: false, hasNativeDialogs: false, isDemo: true })
setShortcutMode('browser')
render(() => <App />, document.getElementById('app')!)
