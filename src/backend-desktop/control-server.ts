// Local control endpoint for the `dotaz` CLI (see docs/agent-cli.md).
//
// Plain HTTP over a unix socket (macOS/Linux) or loopback TCP (Windows, or on request) —
// every CLI invocation is one-shot, so a WebSocket would buy nothing. The endpoint only
// exists while the user has CLI access enabled; there is no way to reach it otherwise.

import { type CliSessionGuard, createCliHandlerLookup } from '@dotaz/backend-shared/rpc/cli-surface'
import { dispatchRpc, parseRpcRequest, type RpcHandler } from '@dotaz/backend-shared/rpc/dispatch'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const CLI_PROTOCOL_VERSION = 1

// Layout must match src/cli-agent/endpoint.ts — one file per instance, so two running
// instances never overwrite or delete each other's endpoint.
const CLI_DIR = 'cli'
const ENDPOINT_FILE_PATTERN = /^endpoint-(\d+)\.json$/

export type ControlTransport = 'unix' | 'tcp'

export interface ControlServerOptions {
	/** RPC handlers to expose — the same map the webview RPC uses. */
	handlers: Record<string, RpcHandler>
	/** Lets the allowlist reject a query on a session the backend did not open read-only. */
	sessionGuard?: CliSessionGuard
	/** Parent of the `cli/` endpoint directory, normally Utils.paths.userData. */
	userDataDir: string
	appVersion: string
	/** Overrides the platform default — also settable with DOTAZ_CLI_TRANSPORT. */
	transport?: ControlTransport
}

export type ControlServerAddress =
	| { transport: 'unix'; socket: string }
	| { transport: 'tcp'; port: number }

export interface ControlServerHandle {
	address: ControlServerAddress
	endpointDir: string
	endpointFile: string
	token: string
	stop(): Promise<void>
}

export function endpointDirPath(userDataDir: string): string {
	return join(userDataDir, CLI_DIR)
}

export function endpointFilePath(userDataDir: string, pid: number = process.pid): string {
	return join(endpointDirPath(userDataDir), `endpoint-${pid}.json`)
}

/** Explicit option first, then DOTAZ_CLI_TRANSPORT, then the platform (Windows has no unix sockets). */
export function resolveTransport(
	opts: { transport?: ControlTransport; env?: Record<string, string | undefined>; platform?: string } = {},
): ControlTransport {
	if (opts.transport) return opts.transport
	const fromEnv = (opts.env ?? process.env).DOTAZ_CLI_TRANSPORT
	if (fromEnv === 'tcp' || fromEnv === 'unix') return fromEnv
	return (opts.platform ?? process.platform) === 'win32' ? 'tcp' : 'unix'
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

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (err) {
		// EPERM means the process exists but belongs to another user — still alive
		return err instanceof Error && 'code' in err && err.code === 'EPERM'
	}
}

/** Drops files left behind by crashed instances; a live instance's file is never touched. */
function pruneDeadEndpointFiles(dir: string, ownPid: number): void {
	let entries: string[]
	try {
		entries = readdirSync(dir)
	} catch {
		return
	}
	for (const entry of entries) {
		const match = ENDPOINT_FILE_PATTERN.exec(entry)
		if (!match) continue
		const pid = Number(match[1])
		if (pid !== ownPid && isPidAlive(pid)) continue
		removeIfExists(join(dir, entry))
	}
}

export async function startControlServer(opts: ControlServerOptions): Promise<ControlServerHandle> {
	const token = randomBytes(32).toString('hex')
	const getHandler = createCliHandlerLookup(opts.handlers, opts.sessionGuard)
	const pid = process.pid
	const transport = resolveTransport({ transport: opts.transport })
	const socketPath = transport === 'unix' ? socketPathForPid(pid) : null
	const endpointDir = endpointDirPath(opts.userDataDir)
	const endpointFile = endpointFilePath(opts.userDataDir, pid)

	mkdirSync(endpointDir, { recursive: true, mode: 0o700 })
	// mkdir applies the mode only when creating, and umask can strip bits off it
	chmodSync(endpointDir, 0o700)
	pruneDeadEndpointFiles(endpointDir, pid)

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
		// No unix sockets on Windows — an ephemeral loopback port plus the token instead
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

	// Only our own file and socket — another instance may still be serving from this directory
	const cleanup = () => {
		if (socketPath) removeIfExists(socketPath)
		removeIfExists(endpointFile)
	}
	// Covers graceful paths only. Electrobun installs its own SIGINT/SIGTERM handlers that end
	// the process through a native quit, so a signalled instance runs neither these nor 'exit'
	// and leaves its files behind — that is what the startup prune and the CLI's dead-pid
	// filter are for.
	process.once('exit', cleanup)

	let stopped = false
	return {
		address,
		endpointDir,
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
