import { setCapabilities } from '../frontend-shared/lib/capabilities'
import { setStorage } from '../frontend-shared/lib/storage'
import { RpcAppStateStorage } from '../frontend-shared/lib/storage/rpc'
import { setTransport } from '../frontend-shared/lib/transport'
import { createElectrobunTransport } from './transport'
import '../frontend-shared/styles/global.css'
import { render } from 'solid-js/web'
import App from '../frontend-shared/App'

setTransport(createElectrobunTransport())
setStorage(new RpcAppStateStorage())
setCapabilities({ hasFileSystem: true, hasHttpStreaming: false, hasNativeDialogs: true })
render(() => <App />, document.getElementById('app')!)
