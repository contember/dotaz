// Transport-agnostic RPC dispatch — shared by the web WebSocket server and the CLI control server
import { DatabaseError } from '@dotaz/shared/types/errors'
import type { DatabaseErrorCode } from '@dotaz/shared/types/errors'

export interface RpcRequest {
	id?: number
	method: string
	params?: unknown
}

export interface RpcResponse {
	type: 'response'
	id: number
	success: boolean
	payload?: unknown
	error?: string
	errorCode?: DatabaseErrorCode
}

// Handlers are heterogeneous (each has its own params shape) — any is intentional here.
export type RpcHandler = (params: any) => unknown | Promise<unknown>
export type RpcHandlerLookup = (method: string) => RpcHandler | undefined

/** The envelope sent when the raw payload didn't parse as JSON at all. */
export function invalidJsonResponse(): RpcResponse {
	return { type: 'response', id: 0, success: false, error: 'Invalid JSON' }
}

/** Dispatch a parsed request. Never throws — handler errors become error responses. */
export async function dispatchRpc(req: RpcRequest, getHandler: RpcHandlerLookup): Promise<RpcResponse> {
	const id = req.id ?? 0
	const handler = getHandler(req.method)
	if (!handler) {
		return { type: 'response', id, success: false, error: `Unknown method: ${req.method}` }
	}

	try {
		const payload = await handler(req.params)
		return { type: 'response', id, success: true, payload }
	} catch (err) {
		return {
			type: 'response',
			id,
			success: false,
			error: err instanceof Error ? err.message : String(err),
			errorCode: err instanceof DatabaseError ? err.code : undefined,
		}
	}
}

/** Parse a raw JSON payload into a request. Returns null when it is not a valid request. */
export function parseRpcRequest(raw: string | Uint8Array | ArrayBuffer): RpcRequest | null {
	const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)

	let msg: unknown
	try {
		msg = JSON.parse(text)
	} catch {
		return null
	}

	if (typeof msg !== 'object' || msg === null || typeof (msg as { method?: unknown }).method !== 'string') {
		return null
	}

	const { id, method, params } = msg as { id?: number; method: string; params?: unknown }
	return { id, method, params }
}
