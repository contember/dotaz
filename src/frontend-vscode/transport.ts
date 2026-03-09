import type { RpcTransport } from '@dotaz/frontend-shared/lib/transport/types'

interface PendingRequest {
	resolve: (value: any) => void
	reject: (error: any) => void
}

declare function acquireVsCodeApi(): {
	postMessage(message: any): void
	getState(): any
	setState(state: any): void
}

export function createVscodeTransport(): RpcTransport {
	const vscode = acquireVsCodeApi()
	let requestId = 0
	const pending = new Map<number, PendingRequest>()
	const messageListeners = new Map<string, Set<(payload: any) => void>>()

	window.addEventListener('message', (event) => {
		const msg = event.data
		if (!msg || !msg.type) return

		if (msg.type === 'response') {
			const req = pending.get(msg.id)
			if (req) {
				pending.delete(msg.id)
				if (msg.success) {
					req.resolve(msg.payload)
				} else {
					const err = new Error(msg.error ?? 'RPC error')
					if (msg.errorCode) (err as any).code = msg.errorCode
					req.reject(err)
				}
			}
		} else if (msg.type === 'message') {
			const listeners = messageListeners.get(msg.channel)
			if (listeners) {
				for (const handler of listeners) {
					handler(msg.payload)
				}
			}
		}
	})

	return {
		async call<T>(method: string, params: unknown): Promise<T> {
			const id = ++requestId
			return new Promise<T>((resolve, reject) => {
				pending.set(id, { resolve, reject })
				vscode.postMessage({ type: 'request', id, method, params })
			})
		},

		addMessageListener(channel: string, handler: (payload: any) => void): () => void {
			let listeners = messageListeners.get(channel)
			if (!listeners) {
				listeners = new Set()
				messageListeners.set(channel, listeners)
			}
			listeners.add(handler)

			return () => {
				listeners!.delete(handler)
				if (listeners!.size === 0) {
					messageListeners.delete(channel)
				}
			}
		},
	}
}
