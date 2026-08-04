// The control server's TCP transport is the Windows path, so nothing else in the suite
// covers it. `transport: 'tcp'` makes it reachable on Linux/macOS too.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { endpointFilePath, resolveTransport, startControlServer } from '../src/backend-desktop/control-server'
import type { ControlServerHandle } from '../src/backend-desktop/control-server'
import { DotazClient } from '../src/cli-agent/client'
import { candidateEndpointFiles, discoverEndpoint, parseEndpointFile } from '../src/cli-agent/endpoint'
import { CliError, EXIT } from '../src/cli-agent/errors'

const handlers = {
	'agent.hello': () => ({ version: '9.9.9', mode: 'desktop', pid: process.pid, protocol: 1 }),
}

function endpointFile(userDataDir: string, pid: number): string {
	return join(userDataDir, 'cli', `endpoint-${pid}.json`)
}

function seedEndpointFile(userDataDir: string, pid: number, startedAt: number): string {
	const file = endpointFile(userDataDir, pid)
	mkdirSync(join(userDataDir, 'cli'), { recursive: true })
	writeFileSync(
		file,
		JSON.stringify({
			pid,
			transport: 'unix',
			socket: `/tmp/dotaz-${pid}.sock`,
			port: null,
			token: 'x'.repeat(64),
			version: '0.0.1',
			protocol: 1,
			startedAt,
		}),
	)
	return file
}

describe('control server over TCP', () => {
	let root: string
	let userDataDir: string
	let server: ControlServerHandle
	let liveNeighbour: ReturnType<typeof Bun.spawn>
	let liveFile: string
	let deadFile: string
	let unrelatedFile: string

	beforeAll(async () => {
		// The CLI scans <root>/<channel>/cli, so userData must sit one level below the root
		root = mkdtempSync(join(tmpdir(), 'dotaz-control-'))
		userDataDir = join(root, 'dev')
		mkdirSync(userDataDir)

		liveNeighbour = Bun.spawn(['sleep', '30'])
		const dead = Bun.spawn(['sleep', '0'])
		await dead.exited

		liveFile = seedEndpointFile(userDataDir, liveNeighbour.pid, 1)
		deadFile = seedEndpointFile(userDataDir, dead.pid, 2)
		unrelatedFile = join(userDataDir, 'cli', 'not-an-endpoint.json')
		writeFileSync(unrelatedFile, '{}')

		server = await startControlServer({ handlers, userDataDir, appVersion: '9.9.9', transport: 'tcp' })
	})

	afterAll(async () => {
		await server?.stop()
		liveNeighbour?.kill()
		rmSync(root, { recursive: true, force: true })
	})

	test('binds a loopback port on any platform', () => {
		expect(server.address.transport).toBe('tcp')
		expect(server.address.transport === 'tcp' && server.address.port).toBeGreaterThan(0)
	})

	test('publishes one endpoint file per pid, readable only by the owner', () => {
		expect(server.endpointFile).toBe(endpointFilePath(userDataDir, process.pid))
		expect(server.endpointFile).toBe(endpointFile(userDataDir, process.pid))
		expect(statSync(server.endpointDir).mode & 0o777).toBe(0o700)
		expect(statSync(server.endpointFile).mode & 0o777).toBe(0o600)

		const endpoint = parseEndpointFile(readFileSync(server.endpointFile, 'utf8'))
		expect(endpoint?.transport).toBe('tcp')
		expect(endpoint?.socket).toBeNull()
		expect(endpoint?.port).toBe(server.address.transport === 'tcp' ? server.address.port : 0)
		expect(endpoint?.token).toBe(server.token)
	})

	test('startup drops files of dead instances only', () => {
		expect(existsSync(deadFile)).toBe(false)
		expect(existsSync(liveFile)).toBe(true)
		expect(existsSync(unrelatedFile)).toBe(true)
	})

	test('the CLI discovers it by scanning the userData root', () => {
		expect(candidateEndpointFiles(root)).toContain(server.endpointFile)
		const found = discoverEndpoint({ env: {}, home: root, listCandidates: () => candidateEndpointFiles(root) })
		// Ours started last, so it wins over the seeded neighbour
		expect(found.endpoint.pid).toBe(process.pid)
		expect(found.instances.map((i) => i.pid).sort()).toEqual([liveNeighbour.pid, process.pid].sort())
	})

	test('--instance picks a specific pid', () => {
		const candidates = () => candidateEndpointFiles(root)
		const found = discoverEndpoint({ env: {}, home: root, listCandidates: candidates, instancePid: liveNeighbour.pid })
		expect(found.endpoint.pid).toBe(liveNeighbour.pid)

		try {
			discoverEndpoint({ env: {}, home: root, listCandidates: candidates, instancePid: 999_999_999 })
			expect.unreachable()
		} catch (err) {
			expect(err instanceof CliError && err.exitCode).toBe(EXIT.usage)
			expect(err instanceof CliError && err.hint).toContain(String(process.pid))
		}
	})

	test('health needs no token over TCP', async () => {
		const found = discoverEndpoint({ explicitFile: server.endpointFile })
		const health = await new DotazClient({ ...found.endpoint, token: 'nonsense' }, 5_000).health()
		expect(health.ok).toBe(true)
		expect(health.version).toBe('9.9.9')
	})

	test('a bad token is rejected on /rpc', async () => {
		const found = discoverEndpoint({ explicitFile: server.endpointFile })
		try {
			await new DotazClient({ ...found.endpoint, token: 'b'.repeat(64) }, 5_000).call('agent.hello')
			expect.unreachable()
		} catch (err) {
			expect(err instanceof CliError && err.exitCode).toBe(EXIT.notRunning)
			expect(err instanceof Error && err.message).toContain('token')
		}
	})

	test('a valid call round-trips over TCP', async () => {
		const found = discoverEndpoint({ explicitFile: server.endpointFile })
		const payload = await new DotazClient(found.endpoint, 5_000).call('agent.hello')
		expect(payload).toEqual({ version: '9.9.9', mode: 'desktop', pid: process.pid, protocol: 1 })
	})
})

describe('control server shutdown', () => {
	test('removes only its own endpoint file', async () => {
		const root = mkdtempSync(join(tmpdir(), 'dotaz-control-stop-'))
		const userDataDir = join(root, 'dev')
		mkdirSync(userDataDir)
		const neighbour = Bun.spawn(['sleep', '30'])
		const neighbourFile = seedEndpointFile(userDataDir, neighbour.pid, 1)

		const server = await startControlServer({ handlers, userDataDir, appVersion: '9.9.9', transport: 'tcp' })
		expect(existsSync(server.endpointFile)).toBe(true)

		await server.stop()
		expect(existsSync(server.endpointFile)).toBe(false)
		expect(existsSync(neighbourFile)).toBe(true)
		expect(existsSync(server.endpointDir)).toBe(true)

		neighbour.kill()
		rmSync(root, { recursive: true, force: true })
	})

	test('a unix server removes its socket, and stop() is idempotent', async () => {
		const userDataDir = mkdtempSync(join(tmpdir(), 'dotaz-control-unix-'))
		const server = await startControlServer({ handlers, userDataDir, appVersion: '9.9.9', transport: 'unix' })
		expect(server.address.transport).toBe('unix')
		const socket = server.address.transport === 'unix' ? server.address.socket : ''
		expect(existsSync(socket)).toBe(true)

		await server.stop()
		await server.stop()
		expect(existsSync(socket)).toBe(false)
		expect(existsSync(server.endpointFile)).toBe(false)

		rmSync(userDataDir, { recursive: true, force: true })
	})
})

describe('resolveTransport', () => {
	test('the explicit option wins over everything', () => {
		expect(resolveTransport({ transport: 'tcp', env: { DOTAZ_CLI_TRANSPORT: 'unix' }, platform: 'linux' })).toBe('tcp')
	})

	test('DOTAZ_CLI_TRANSPORT overrides the platform default', () => {
		expect(resolveTransport({ env: { DOTAZ_CLI_TRANSPORT: 'tcp' }, platform: 'linux' })).toBe('tcp')
		expect(resolveTransport({ env: { DOTAZ_CLI_TRANSPORT: 'unix' }, platform: 'win32' })).toBe('unix')
	})

	test('falls back to the platform, ignoring a bogus env value', () => {
		expect(resolveTransport({ env: {}, platform: 'linux' })).toBe('unix')
		expect(resolveTransport({ env: {}, platform: 'darwin' })).toBe('unix')
		expect(resolveTransport({ env: {}, platform: 'win32' })).toBe('tcp')
		expect(resolveTransport({ env: { DOTAZ_CLI_TRANSPORT: 'http' }, platform: 'linux' })).toBe('unix')
	})
})
