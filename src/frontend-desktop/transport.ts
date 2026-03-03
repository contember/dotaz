import { Electroview } from 'electrobun/view'
import type { DotazRPC } from '../backend-types'
import type { RpcTransport } from '../frontend-shared/lib/transport/types'

/** String-keyed request dispatch — bridges generic transport to typed Electrobun RPC */
type RequestDispatch = Record<string, (params: unknown) => Promise<unknown>>

/**
 * String-keyed message listener — bridges generic transport to typed Electrobun RPC.
 * Electrobun types message channels from webview.messages (which is empty),
 * but at runtime the webview receives messages defined in bun.messages.
 */
type MessageListenerFn = (channel: string, handler: (payload: unknown) => void) => void

export function createElectrobunTransport(): RpcTransport {
	const electroviewRpc = Electroview.defineRPC<DotazRPC>({
		handlers: {
			requests: {},
			messages: {},
		},
	})

	new Electroview({ rpc: electroviewRpc })

	// Cast once at the transport boundary: typed Electrobun RPC → generic string dispatch
	const requestMethods = electroviewRpc.request as unknown as RequestDispatch
	const addListener = electroviewRpc.addMessageListener as unknown as MessageListenerFn
	const removeListener = electroviewRpc.removeMessageListener as unknown as MessageListenerFn

	return {
		call<T>(method: string, params: unknown): Promise<T> {
			return requestMethods[method](params) as Promise<T>
		},
		addMessageListener<T = unknown>(channel: string, handler: (payload: T) => void): () => void {
			const wrappedHandler = handler as (payload: unknown) => void
			addListener(channel, wrappedHandler)
			return () => {
				removeListener(channel, wrappedHandler)
			}
		},
	}
}
