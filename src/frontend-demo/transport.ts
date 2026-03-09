import type { RpcTransport } from '@dotaz/frontend-shared/lib/transport/types'

export function createInlineTransport(): RpcTransport {
	const messageListeners = new Map<string, Set<(payload: any) => void>>()
	let handlersPromise: Promise<{ handlers: Record<string, Function> }> | null = null

	function emitMessage(channel: string, payload: any) {
		const listeners = messageListeners.get(channel)
		if (listeners) {
			for (const handler of listeners) {
				queueMicrotask(() => handler(payload))
			}
		}
	}

	function getHandlers() {
		if (!handlersPromise) {
			handlersPromise = import('./init').then((m) => m.initDemo(emitMessage))
		}
		return handlersPromise
	}

	return {
		async call<T>(method: string, params: unknown): Promise<T> {
			const { handlers } = await getHandlers()
			const handler = handlers[method]
			if (!handler) throw new Error(`Unknown RPC method: ${method}`)
			return handler(params) as T
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
