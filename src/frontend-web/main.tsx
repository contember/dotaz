import { setCapabilities } from '@dotaz/frontend-shared/lib/capabilities'
import { setShortcutMode } from '@dotaz/frontend-shared/lib/keyboard'
import { setStorage } from '@dotaz/frontend-shared/lib/storage'
import { IndexedDbAppStateStorage } from '@dotaz/frontend-shared/lib/storage/indexeddb'
import { setTransport } from '@dotaz/frontend-shared/lib/transport'
import { createWebSocketTransport } from './transport'
import '../frontend-shared/styles/global.css'
import App from '@dotaz/frontend-shared/App'
import { render } from 'solid-js/web'

type BootstrapResult =
	| { ok: true }
	| { ok: false; message: string }

async function bootstrapRpcAuth(): Promise<BootstrapResult> {
	try {
		const response = await fetch('/api/bootstrap', {
			cache: 'no-store',
			credentials: 'same-origin',
		})

		if (response.ok) {
			return { ok: true }
		}

		if (response.status === 403) {
			return {
				ok: false,
				message: 'The server rejected this request (host/origin check). Serve Dotaz UI and RPC under the same origin, and check DOTAZ_ALLOWED_HOSTS if it runs behind a proxy.',
			}
		}

		return {
			ok: false,
			message: 'Dotaz could not start. Refresh the page and try again.',
		}
	} catch {
		return {
			ok: false,
			message: 'Dotaz could not reach the backend. Refresh the page and try again.',
		}
	}
}

function appRoot(): HTMLElement {
	const root = document.getElementById('app')
	if (!root) {
		throw new Error('App root not found')
	}
	return root
}

function renderFatalMessage(message: string): void {
	const container = document.createElement('main')
	container.setAttribute('role', 'alert')
	container.style.alignItems = 'center'
	container.style.background = 'var(--surface)'
	container.style.boxSizing = 'border-box'
	container.style.color = 'var(--ink)'
	container.style.display = 'flex'
	container.style.fontFamily = 'var(--font-ui)'
	container.style.justifyContent = 'center'
	container.style.minHeight = '100vh'
	container.style.padding = '24px'
	container.style.textAlign = 'center'

	const content = document.createElement('section')
	content.style.maxWidth = '420px'

	const title = document.createElement('h1')
	title.textContent = 'Unable to start Dotaz'
	title.style.fontSize = '16px'
	title.style.fontWeight = '600'
	title.style.lineHeight = '1.4'
	title.style.margin = '0 0 8px'

	const detail = document.createElement('p')
	detail.textContent = message
	detail.style.color = 'var(--ink-secondary)'
	detail.style.fontSize = '13px'
	detail.style.lineHeight = '1.5'
	detail.style.margin = '0'

	content.append(title, detail)
	container.append(content)

	const root = document.getElementById('app') ?? document.body
	root.replaceChildren(container)
}

async function startWebApp(): Promise<void> {
	const bootstrap = await bootstrapRpcAuth()
	if (!bootstrap.ok) {
		renderFatalMessage(bootstrap.message)
		return
	}

	setTransport(createWebSocketTransport())
	setStorage(new IndexedDbAppStateStorage())
	setCapabilities({ hasFileSystem: false, hasHttpStreaming: true, hasNativeDialogs: false })
	setShortcutMode('browser')
	render(() => <App />, appRoot())
}

void startWebApp().catch(() => {
	renderFatalMessage('Dotaz could not start. Refresh the page and try again.')
})
