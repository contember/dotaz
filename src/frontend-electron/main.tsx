import { setCapabilities } from '@dotaz/frontend-shared/lib/capabilities'
import { setShortcutMode } from '@dotaz/frontend-shared/lib/keyboard'
import { setStorage } from '@dotaz/frontend-shared/lib/storage'
import { IndexedDbAppStateStorage } from '@dotaz/frontend-shared/lib/storage/indexeddb'
import { setTransport } from '@dotaz/frontend-shared/lib/transport'
import { createWebSocketTransport } from '@dotaz/frontend-web/transport'
import '../frontend-shared/styles/global.css'
import App from '@dotaz/frontend-shared/App'
import { render } from 'solid-js/web'

setTransport(createWebSocketTransport())
setStorage(new IndexedDbAppStateStorage())
setCapabilities({ hasFileSystem: false, hasHttpStreaming: true, hasNativeDialogs: false })
setShortcutMode('desktop')
render(() => <App />, document.getElementById('app')!)
