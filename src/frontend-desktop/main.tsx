import { setCapabilities } from '@dotaz/frontend-shared/lib/capabilities'
import { setStorage } from '@dotaz/frontend-shared/lib/storage'
import { RpcAppStateStorage } from '@dotaz/frontend-shared/lib/storage/rpc'
import { setTransport } from '@dotaz/frontend-shared/lib/transport'
import { createElectrobunTransport } from './transport'
import '../frontend-shared/styles/global.css'
import { render } from 'solid-js/web'
import App from '@dotaz/frontend-shared/App'

setTransport(createElectrobunTransport())
setStorage(new RpcAppStateStorage())
setCapabilities({ hasFileSystem: true, hasHttpStreaming: false, hasNativeDialogs: true })
render(() => <App />, document.getElementById('app')!)
