import { setCapabilities } from '@dotaz/frontend-shared/lib/capabilities'
import { setShortcutMode } from '@dotaz/frontend-shared/lib/keyboard'
import { setStorage } from '@dotaz/frontend-shared/lib/storage'
import { RpcAppStateStorage } from '@dotaz/frontend-shared/lib/storage/rpc'
import { setTransport } from '@dotaz/frontend-shared/lib/transport'
import { createVscodeTransport } from './transport'
import '../frontend-shared/styles/global.css'
import App from '@dotaz/frontend-shared/App'
import { render } from 'solid-js/web'

setTransport(createVscodeTransport())
setStorage(new RpcAppStateStorage())
setCapabilities({ hasFileSystem: true, hasHttpStreaming: false, hasNativeDialogs: true })
setShortcutMode('browser')
render(() => <App />, document.getElementById('app')!)
