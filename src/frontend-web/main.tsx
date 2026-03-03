import { setCapabilities } from '../frontend-shared/lib/capabilities'
import { setShortcutMode } from '../frontend-shared/lib/keyboard'
import { setStorage } from '../frontend-shared/lib/storage'
import { IndexedDbAppStateStorage } from '../frontend-shared/lib/storage/indexeddb'
import { setTransport } from '../frontend-shared/lib/transport'
import { createWebSocketTransport } from './transport'
import '../frontend-shared/styles/global.css'
import { render } from 'solid-js/web'
import App from '../frontend-shared/App'

setTransport(createWebSocketTransport())
setStorage(new IndexedDbAppStateStorage())
setCapabilities({ hasFileSystem: false, hasHttpStreaming: true, hasNativeDialogs: false })
setShortcutMode('browser')
render(() => <App />, document.getElementById('app')!)
