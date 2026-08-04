// Endpoint discovery — find the control server the running desktop app published.
// See docs/agent-cli.md § Endpoint discovery.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { notRunningError } from './errors'

/** Must match `app.identifier` in electrobun.config.ts — it is part of the userData path. */
export const APP_IDENTIFIER = 'dotaz.electrobun.dev'

export const ENDPOINT_FILE_NAME = 'cli-endpoint.json'

export interface EndpointInfo {
	pid: number
	transport: 'unix' | 'tcp'
	socket: string | null
	port: number | null
	token: string
	version: string
	protocol: number
	startedAt: number
}

export interface EndpointSource {
	file: string
	endpoint: EndpointInfo
}

/** Mirrors Electrobun's `Utils.paths.appData` so we land in the same userData directory. */
export function appDataDir(platform: string, env: Record<string, string | undefined>, home: string): string {
	switch (platform) {
		case 'darwin':
			return join(home, 'Library', 'Application Support')
		case 'win32':
			return env.LOCALAPPDATA || join(home, 'AppData', 'Local')
		default:
			return env.XDG_DATA_HOME || join(home, '.local', 'share')
	}
}

/** `Utils.paths.userData` is `<appData>/<identifier>/<channel>`, and the CLI does not know the channel. */
export function userDataRoot(platform: string, env: Record<string, string | undefined>, home: string): string {
	return join(appDataDir(platform, env, home), APP_IDENTIFIER)
}

export function parseEndpointFile(raw: string): EndpointInfo | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (typeof parsed !== 'object' || parsed === null) return null
	const obj: Record<string, unknown> = { ...parsed }

	const pid = obj.pid
	const token = obj.token
	const transport = obj.transport
	if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null
	if (typeof token !== 'string' || token.length === 0) return null
	if (transport !== 'unix' && transport !== 'tcp') return null

	const socket = typeof obj.socket === 'string' ? obj.socket : null
	const port = typeof obj.port === 'number' ? obj.port : null
	if (transport === 'unix' && !socket) return null
	if (transport === 'tcp' && (port === null || port <= 0)) return null

	return {
		pid,
		transport,
		socket,
		port,
		token,
		version: typeof obj.version === 'string' ? obj.version : 'unknown',
		protocol: typeof obj.protocol === 'number' ? obj.protocol : 0,
		startedAt: typeof obj.startedAt === 'number' ? obj.startedAt : 0,
	}
}

export function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (err) {
		// EPERM means the process exists but belongs to another user — still alive
		return err instanceof Error && 'code' in err && err.code === 'EPERM'
	}
}

/** Every `<channel>/cli-endpoint.json` under the userData root, newest channel directory first. */
export function candidateEndpointFiles(root: string): string[] {
	let entries: string[]
	try {
		entries = readdirSync(root)
	} catch {
		return []
	}
	const files: string[] = []
	for (const entry of entries) {
		const file = join(root, entry, ENDPOINT_FILE_NAME)
		if (existsSync(file)) files.push(file)
	}
	return files
}

export interface DiscoverOptions {
	/** `--endpoint <file>`, then `DOTAZ_ENDPOINT`. */
	explicitFile?: string
	platform?: string
	env?: Record<string, string | undefined>
	home?: string
	pidAlive?: (pid: number) => boolean
	readFile?: (file: string) => string
	listCandidates?: (root: string) => string[]
}

/**
 * Resolve the endpoint to talk to. Throws exit-5 for every "cannot reach the app" case,
 * so callers never have to distinguish missing file from dead pid.
 */
export function discoverEndpoint(opts: DiscoverOptions = {}): EndpointSource {
	const platform = opts.platform ?? process.platform
	const env = opts.env ?? process.env
	const home = opts.home ?? homedir()
	const pidAlive = opts.pidAlive ?? isPidAlive
	const read = opts.readFile ?? ((file: string) => readFileSync(file, 'utf8'))
	const listCandidates = opts.listCandidates ?? candidateEndpointFiles

	const explicit = opts.explicitFile ?? env.DOTAZ_ENDPOINT
	const files = explicit ? [explicit] : listCandidates(userDataRoot(platform, env, home))

	if (files.length === 0) {
		throw notRunningError(
			explicit
				? `Endpoint file not found: ${explicit}`
				: `No Dotaz control endpoint found under ${userDataRoot(platform, env, home)}`,
		)
	}

	const stale: string[] = []
	let best: EndpointSource | null = null

	for (const file of files) {
		let raw: string
		try {
			raw = read(file)
		} catch {
			stale.push(`${file} (unreadable)`)
			continue
		}
		const endpoint = parseEndpointFile(raw)
		if (!endpoint) {
			stale.push(`${file} (malformed)`)
			continue
		}
		if (!pidAlive(endpoint.pid)) {
			stale.push(`${file} (pid ${endpoint.pid} is not running)`)
			continue
		}
		if (!best || endpoint.startedAt > best.endpoint.startedAt) {
			best = { file, endpoint }
		}
	}

	if (best) return best

	throw notRunningError(`Dotaz is not running — no live control endpoint. Checked: ${stale.join(', ')}`)
}
