import type { RpcTransport } from '@dotaz/frontend-shared/lib/transport/types'

interface PendingRequest {
	resolve: (value: any) => void
	reject: (error: any) => void
}

// Local stubs for system dialogs that can't work over WebSocket
const LOCAL_HANDLERS: Record<string, (params: any) => any> = {
	'system.showOpenDialog': (_params: any) => {
		return { paths: [], cancelled: true }
	},
	'system.showSaveDialog': (_params: any) => {
		return { path: null, cancelled: true }
	},
}

export function createWebSocketTransport(): RpcTransport {
	let ws: WebSocket | null = null
	let requestId = 0
	const pending = new Map<number, PendingRequest>()
	const messageListeners = new Map<string, Set<(payload: any) => void>>()
	let connectPromise: Promise<void> | null = null

	function connect(): Promise<void> {
		if (ws && ws.readyState === WebSocket.OPEN) {
			return Promise.resolve()
		}
		if (connectPromise) return connectPromise

		connectPromise = new Promise<void>((resolve, reject) => {
			const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
			const socket = new WebSocket(`${protocol}//${location.host}/rpc`)

			socket.onopen = () => {
				ws = socket
				connectPromise = null
				resolve()
			}

			socket.onerror = () => {
				connectPromise = null
				reject(new Error('WebSocket connection failed'))
			}

			socket.onclose = () => {
				ws = null
				connectPromise = null
				// Reject all pending requests
				for (const [id, req] of pending) {
					req.reject(new Error('WebSocket closed'))
					pending.delete(id)
				}
				// Auto-reconnect after delay (catch to prevent unhandled rejection toasts)
				setTimeout(() => {
					connect().catch(() => {})
				}, 1000)
			}

			socket.onmessage = (event) => {
				let msg: any
				try {
					msg = JSON.parse(event.data)
				} catch (err) {
					console.debug('Failed to parse WebSocket message:', err instanceof Error ? err.message : err)
					return
				}

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
			}
		})

		return connectPromise
	}

	return {
		async call<T>(method: string, params: unknown): Promise<T> {
			// Intercept methods that need local handling in browser
			if (method in LOCAL_HANDLERS) {
				return LOCAL_HANDLERS[method](params) as T
			}

			await connect()
			if (!ws) throw new Error('WebSocket not connected')

			const id = ++requestId
			return new Promise<T>((resolve, reject) => {
				pending.set(id, { resolve, reject })
				ws!.send(JSON.stringify({ type: 'request', id, method, params }))
			})
		},

		addMessageListener(channel: string, handler: (payload: any) => void): () => void {
			let listeners = messageListeners.get(channel)
			if (!listeners) {
				listeners = new Set()
				messageListeners.set(channel, listeners)
			}
			listeners.add(handler)

			// Ensure connection is established so we receive messages
			connect()

			return () => {
				listeners!.delete(handler)
				if (listeners!.size === 0) {
					messageListeners.delete(channel)
				}
			}
		},
	}
}
