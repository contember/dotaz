// Endpoint discovery — find the control server the running desktop app published.
// See docs/agent-cli.md § Endpoint discovery.

import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { notRunningError, usageError } from './errors'

/** Must match `app.identifier` in electrobun.config.ts — it is part of the userData path. */
export const APP_IDENTIFIER = 'dotaz.electrobun.dev'

// Layout must match src/backend-desktop/control-server.ts — one file per running instance.
export const CLI_DIR_NAME = 'cli'
const ENDPOINT_FILE_PATTERN = /^endpoint-(\d+)\.json$/

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

export interface EndpointRef {
	file: string
	endpoint: EndpointInfo
}

export interface EndpointSource extends EndpointRef {
	/** Every live instance, newest first — `status` reports when more than one is running. */
	instances: EndpointInfo[]
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

function readDirSafely(dir: string): string[] {
	try {
		return readdirSync(dir)
	} catch {
		return []
	}
}

/** Every `<channel>/cli/endpoint-<pid>.json` under the userData root — one file per instance. */
export function candidateEndpointFiles(root: string): string[] {
	const files: string[] = []
	for (const channel of readDirSafely(root)) {
		const dir = join(root, channel, CLI_DIR_NAME)
		for (const entry of readDirSafely(dir)) {
			if (ENDPOINT_FILE_PATTERN.test(entry)) files.push(join(dir, entry))
		}
	}
	return files
}

export interface DiscoverOptions {
	/** `--endpoint <file>`, then `DOTAZ_ENDPOINT`. */
	explicitFile?: string
	/** `--instance <pid>` — pick one specific running instance. */
	instancePid?: number
	platform?: string
	env?: Record<string, string | undefined>
	home?: string
	pidAlive?: (pid: number) => boolean
	readFile?: (file: string) => string
	listCandidates?: (root: string) => string[]
}

interface Scan {
	/** Live instances, newest first. */
	live: EndpointRef[]
	/** Human-readable reason per rejected file, for the exit-5 message. */
	stale: string[]
}

function scanEndpointFiles(files: string[], read: (file: string) => string, pidAlive: (pid: number) => boolean): Scan {
	const live: EndpointRef[] = []
	const stale: string[] = []

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
		live.push({ file, endpoint })
	}

	live.sort((a, b) => b.endpoint.startedAt - a.endpoint.startedAt)
	return { live, stale }
}

interface Resolved extends DiscoverOptions {
	platform: string
	env: Record<string, string | undefined>
	home: string
	pidAlive: (pid: number) => boolean
	readFile: (file: string) => string
	listCandidates: (root: string) => string[]
}

function resolveOptions(opts: DiscoverOptions): Resolved {
	return {
		...opts,
		platform: opts.platform ?? process.platform,
		env: opts.env ?? process.env,
		home: opts.home ?? homedir(),
		pidAlive: opts.pidAlive ?? isPidAlive,
		readFile: opts.readFile ?? ((file: string) => readFileSync(file, 'utf8')),
		listCandidates: opts.listCandidates ?? candidateEndpointFiles,
	}
}

/** Every instance currently serving a control endpoint, newest first. */
export function listLiveInstances(opts: DiscoverOptions = {}): EndpointRef[] {
	const resolved = resolveOptions(opts)
	const root = userDataRoot(resolved.platform, resolved.env, resolved.home)
	return scanEndpointFiles(resolved.listCandidates(root), resolved.readFile, resolved.pidAlive).live
}

/**
 * Resolve the endpoint to talk to. Throws exit-5 for every "cannot reach the app" case,
 * so callers never have to distinguish missing file from dead pid.
 */
export function discoverEndpoint(opts: DiscoverOptions = {}): EndpointSource {
	const resolved = resolveOptions(opts)
	const instancePid = resolved.instancePid

	if (instancePid !== undefined) {
		if (opts.explicitFile !== undefined) throw usageError('--instance and --endpoint cannot be combined')
		if (!Number.isInteger(instancePid) || instancePid <= 0) throw usageError('--instance must be a process id')
	}

	// A flag beats the environment, so --instance ignores DOTAZ_ENDPOINT
	const explicit = opts.explicitFile ?? (instancePid === undefined ? resolved.env.DOTAZ_ENDPOINT : undefined)
	if (explicit) {
		const { live, stale } = scanEndpointFiles([explicit], resolved.readFile, resolved.pidAlive)
		const chosen = live[0]
		if (!chosen) throw notRunningError(`Dotaz is not running — no live control endpoint. Checked: ${stale.join(', ')}`)
		return { ...chosen, instances: [chosen.endpoint] }
	}

	const root = userDataRoot(resolved.platform, resolved.env, resolved.home)
	const files = resolved.listCandidates(root)
	if (files.length === 0) throw notRunningError(`No Dotaz control endpoint found under ${root}`)

	const { live, stale } = scanEndpointFiles(files, resolved.readFile, resolved.pidAlive)
	if (live.length === 0) throw notRunningError(`Dotaz is not running — no live control endpoint. Checked: ${stale.join(', ')}`)

	const instances = live.map((ref) => ref.endpoint)
	if (instancePid === undefined) return { ...live[0], instances }

	const match = live.find((ref) => ref.endpoint.pid === instancePid)
	if (!match) {
		throw usageError(`No live Dotaz instance with pid ${instancePid}`, `Live instances: ${instances.map((i) => i.pid).join(', ')}`)
	}
	return { ...match, instances }
}
