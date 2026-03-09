// Frontend RPC client — Proxy-based, typed from handler definitions
// Types inferred from createHandlers() via NamespacedRpcClient.

import type { NamespacedRpcClient } from '@dotaz/backend-types'
import type { ConnectionState } from '@dotaz/shared/types/connection'
import type { DatabaseErrorCode } from '@dotaz/shared/types/errors'
import type { SessionInfo } from '@dotaz/shared/types/rpc'
import { transport } from './transport'

export { friendlyErrorMessage, RpcError } from './rpc-errors'
import { RpcError } from './rpc-errors'

async function call<T>(method: string, params: unknown): Promise<T> {
	try {
		return await transport.call<T>(method, params)
	} catch (err) {
		throw new RpcError(method, err)
	}
}

export const rpc: NamespacedRpcClient = new Proxy({} as NamespacedRpcClient, {
	get(_, namespace: string) {
		return new Proxy({} as Record<string, unknown>, {
			get(_, method: string) {
				return (params?: unknown) => call(`${namespace}.${method}`, params ?? {})
			},
		})
	},
})

// ── Message listeners ────────────────────────────────────

/** Subscribe to backend → frontend notifications */
export const messages = {
	onConnectionStatusChanged: (
		handler: (
			event: { connectionId: string; state: ConnectionState; error?: string; errorCode?: DatabaseErrorCode; transactionLost?: boolean },
		) => void,
	) => {
		return transport.addMessageListener('connections.statusChanged', handler)
	},
	onMenuAction: (
		handler: (event: { action: string }) => void,
	) => {
		return transport.addMessageListener('menu.action', handler)
	},
	onSessionChanged: (
		handler: (event: { connectionId: string; sessions: SessionInfo[] }) => void,
	) => {
		return transport.addMessageListener('session.changed', handler)
	},
}
