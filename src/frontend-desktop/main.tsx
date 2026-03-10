import { setCapabilities } from '@dotaz/frontend-shared/lib/capabilities'
import { setStorage } from '@dotaz/frontend-shared/lib/storage'
import { RpcAppStateStorage } from '@dotaz/frontend-shared/lib/storage/rpc'
import { setTransport } from '@dotaz/frontend-shared/lib/transport'
import { createElectrobunTransport } from './transport'
import '../frontend-shared/styles/global.css'
import App from '@dotaz/frontend-shared/App'
import { render } from 'solid-js/web'

setTransport(createElectrobunTransport())
setStorage(new RpcAppStateStorage())
setCapabilities({ hasFileSystem: true, hasHttpStreaming: false, hasNativeDialogs: true, isDesktop: true })

// Expose platform to CSS for macOS-specific styling
if (navigator.platform.startsWith('Mac')) {
	document.documentElement.dataset.platform = 'mac'
}

render(() => <App />, document.getElementById('app')!)
