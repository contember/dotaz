/**
 * Tests for the transport-agnostic RPC dispatcher shared by the web WebSocket
 * server and the CLI control server.
 *
 * Run: bun test tests/rpc-dispatch.test.ts
 */
import { dispatchRpc, invalidJsonResponse, parseRpcRequest } from '@dotaz/backend-shared/rpc/dispatch'
import type { RpcHandler, RpcHandlerLookup } from '@dotaz/backend-shared/rpc/dispatch'
import { DatabaseError } from '@dotaz/shared/types/errors'
import { describe, expect, test } from 'bun:test'

function lookup(handlers: Record<string, RpcHandler>): RpcHandlerLookup {
	return (method) => handlers[method]
}

describe('dispatchRpc', () => {
	test('successful dispatch returns the handler payload', async () => {
		const res = await dispatchRpc(
			{ id: 1, method: 'ping', params: { x: 1 } },
			lookup({ ping: (params) => ({ echo: params }) }),
		)
		expect(res).toEqual({ type: 'response', id: 1, success: true, payload: { echo: { x: 1 } } })
	})

	test('unknown method reports success: false with the method name', async () => {
		const res = await dispatchRpc({ id: 2, method: 'nope.method' }, lookup({}))
		expect(res).toEqual({ type: 'response', id: 2, success: false, error: 'Unknown method: nope.method' })
	})

	test('handler throwing a plain Error becomes an error response', async () => {
		const res = await dispatchRpc(
			{ id: 3, method: 'boom' },
			lookup({
				boom: () => {
					throw new Error('kaboom')
				},
			}),
		)
		expect(res).toEqual({ type: 'response', id: 3, success: false, error: 'kaboom', errorCode: undefined })
	})

	test('handler throwing a DatabaseError propagates errorCode', async () => {
		const res = await dispatchRpc(
			{ id: 4, method: 'writeInReadOnly' },
			lookup({
				writeInReadOnly: () => {
					throw new DatabaseError('READ_ONLY_SESSION', 'session is read-only')
				},
			}),
		)
		expect(res).toEqual({
			type: 'response',
			id: 4,
			success: false,
			error: 'session is read-only',
			errorCode: 'READ_ONLY_SESSION',
		})
	})

	test('async handlers are awaited', async () => {
		const res = await dispatchRpc(
			{ id: 5, method: 'slow' },
			lookup({
				slow: async () => {
					await Promise.resolve()
					return { done: true }
				},
			}),
		)
		expect(res).toEqual({ type: 'response', id: 5, success: true, payload: { done: true } })
	})

	test('an async handler that rejects is treated the same as a throw', async () => {
		const res = await dispatchRpc(
			{ id: 6, method: 'rejects' },
			lookup({ rejects: async () => Promise.reject(new Error('rejected')) }),
		)
		expect(res).toEqual({ type: 'response', id: 6, success: false, error: 'rejected', errorCode: undefined })
	})

	test('missing id defaults to 0', async () => {
		const res = await dispatchRpc({ method: 'ping' }, lookup({ ping: () => 'pong' }))
		expect(res.id).toBe(0)
		expect(res).toEqual({ type: 'response', id: 0, success: true, payload: 'pong' })
	})
})

describe('parseRpcRequest', () => {
	test('parses a valid JSON request from a string', () => {
		const req = parseRpcRequest(JSON.stringify({ id: 7, method: 'connections.list', params: { a: 1 } }))
		expect(req).toEqual({ id: 7, method: 'connections.list', params: { a: 1 } })
	})

	test('parses a valid JSON request from a Uint8Array', () => {
		const bytes = new TextEncoder().encode(JSON.stringify({ method: 'ping' }))
		const req = parseRpcRequest(bytes)
		expect(req).toEqual({ id: undefined, method: 'ping', params: undefined })
	})

	test('parses a valid JSON request from an ArrayBuffer', () => {
		const buffer = new TextEncoder().encode(JSON.stringify({ method: 'ping' })).buffer
		const req = parseRpcRequest(buffer)
		expect(req).toEqual({ id: undefined, method: 'ping', params: undefined })
	})

	test('returns null for invalid JSON', () => {
		expect(parseRpcRequest('{not json')).toBeNull()
	})

	test('returns null when method is missing', () => {
		expect(parseRpcRequest(JSON.stringify({ id: 1, params: {} }))).toBeNull()
	})

	test('returns null for non-object JSON', () => {
		expect(parseRpcRequest('"just a string"')).toBeNull()
		expect(parseRpcRequest('42')).toBeNull()
		expect(parseRpcRequest('null')).toBeNull()
	})
})

describe('invalidJsonResponse', () => {
	test('matches the documented envelope', () => {
		expect(invalidJsonResponse()).toEqual({ type: 'response', id: 0, success: false, error: 'Invalid JSON' })
	})
})
