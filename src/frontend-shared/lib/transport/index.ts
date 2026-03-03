import type { RpcTransport } from './types'

let _transport: RpcTransport | null = null

export function setTransport(t: RpcTransport): void {
	_transport = t
}

export const transport: RpcTransport = {
	call<T>(method: string, params: unknown): Promise<T> {
		if (!_transport) throw new Error('Transport not initialized. Call setTransport() first.')
		return _transport.call<T>(method, params)
	},
	addMessageListener<T = unknown>(channel: string, handler: (payload: T) => void): () => void {
		if (!_transport) throw new Error('Transport not initialized. Call setTransport() first.')
		return _transport.addMessageListener(channel, handler)
	},
}
