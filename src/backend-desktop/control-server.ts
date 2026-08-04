// Local control endpoint for the `dotaz` CLI (see docs/agent-cli.md).
//
// Plain HTTP over a unix socket (macOS/Linux) or loopback TCP (Windows) — every CLI
// invocation is one-shot, so a WebSocket would buy nothing. The endpoint only exists while
// the user has CLI access enabled; there is no way to reach it otherwise.

import { createCliHandlerLookup } from '@dotaz/backend-shared/rpc/cli-surface'
import { dispatchRpc, parseRpcRequest, type RpcHandler } from '@dotaz/backend-shared/rpc/dispatch'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const CLI_PROTOCOL_VERSION = 1

const ENDPOINT_FILE = 'cli-endpoint.json'

export interface ControlServerOptions {
	/** RPC handlers to expose — the same map the webview RPC uses. */
	handlers: Record<string, RpcHandler>
	/** Directory holding the endpoint file, normally Utils.paths.userData. */
	userDataDir: string
	appVersion: string
}

export type ControlServerAddress =
	| { transport: 'unix'; socket: string }
	| { transport: 'tcp'; port: number }

export interface ControlServerHandle {
	address: ControlServerAddress
	endpointFile: string
	token: string
	stop(): Promise<void>
}

export function endpointFilePath(userDataDir: string): string {
	return join(userDataDir, ENDPOINT_FILE)
}

/** Socket lives in the runtime dir so the OS cleans it up on reboot. */
function socketPathForPid(pid: number): string {
	return join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), `dotaz-${pid}.sock`)
}

function tokensMatch(expected: string, received: string | null): boolean {
	if (received === null) return false
	const encoder = new TextEncoder()
	const a = encoder.encode(expected)
	const b = encoder.encode(received)
	// timingSafeEqual throws on length mismatch, and the length itself is not a secret
	if (a.length !== b.length) return false
	return timingSafeEqual(a, b)
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

function removeIfExists(path: string): void {
	try {
		if (existsSync(path)) unlinkSync(path)
	} catch { /* best effort — a leftover file must never block startup or shutdown */ }
}

export async function startControlServer(opts: ControlServerOptions): Promise<ControlServerHandle> {
	const token = randomBytes(32).toString('hex')
	const getHandler = createCliHandlerLookup(opts.handlers)
	const pid = process.pid
	const useUnixSocket = process.platform !== 'win32'
	const socketPath = useUnixSocket ? socketPathForPid(pid) : null
	const endpointFile = endpointFilePath(opts.userDataDir)

	// A socket left behind by a crashed instance would make bind fail
	if (socketPath) removeIfExists(socketPath)

	const handleRequest = async (req: Request): Promise<Response> => {
		const url = new URL(req.url)

		if (url.pathname === '/health' && req.method === 'GET') {
			return jsonResponse({ ok: true, version: opts.appVersion, pid, protocol: CLI_PROTOCOL_VERSION })
		}

		if (url.pathname === '/rpc' && req.method === 'POST') {
			if (!tokensMatch(token, req.headers.get('x-dotaz-token'))) {
				return jsonResponse({ type: 'response', id: 0, success: false, error: 'Invalid token' }, 401)
			}
			const raw = await req.text()
			const request = parseRpcRequest(raw)
			if (!request) {
				return jsonResponse({ type: 'response', id: 0, success: false, error: 'Invalid JSON' }, 400)
			}
			const response = await dispatchRpc(request, getHandler)
			return jsonResponse(response)
		}

		return jsonResponse({ error: 'Not found' }, 404)
	}

	let server: ReturnType<typeof Bun.serve>
	let address: ControlServerAddress
	if (socketPath) {
		server = Bun.serve({ unix: socketPath, fetch: handleRequest })
		address = { transport: 'unix', socket: socketPath }
	} else {
		// Windows has no unix sockets — an ephemeral loopback port plus the token instead
		const tcpServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handleRequest })
		server = tcpServer
		const port = tcpServer.port
		if (port === undefined) {
			await tcpServer.stop(true)
			throw new Error('CLI control server bound no port')
		}
		address = { transport: 'tcp', port }
	}

	writeFileSync(
		endpointFile,
		JSON.stringify(
			{
				pid,
				transport: address.transport,
				socket: socketPath,
				port: socketPath ? null : server.port,
				token,
				version: opts.appVersion,
				protocol: CLI_PROTOCOL_VERSION,
				startedAt: Date.now(),
			},
			null,
			2,
		),
		{ mode: 0o600 },
	)
	// writeFileSync only applies mode when creating — an existing file keeps its old perms
	chmodSync(endpointFile, 0o600)

	const cleanup = () => {
		if (socketPath) removeIfExists(socketPath)
		removeIfExists(endpointFile)
	}
	process.once('exit', cleanup)

	let stopped = false
	return {
		address,
		endpointFile,
		token,
		async stop() {
			if (stopped) return
			stopped = true
			process.off('exit', cleanup)
			await server.stop(true)
			cleanup()
		},
	}
}
