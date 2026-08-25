import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	appDataDir,
	candidateEndpointFiles,
	discoverEndpoint,
	type EndpointInfo,
	listLiveInstances,
	parseEndpointFile,
	userDataRoot,
} from '../src/cli-agent/endpoint'
import { CliError, EXIT } from '../src/cli-agent/errors'

const VALID: EndpointInfo = {
	pid: 4242,
	transport: 'unix',
	socket: '/run/user/1000/dotaz-4242.sock',
	port: null,
	token: 'a'.repeat(64),
	version: '0.0.42',
	protocol: 1,
	startedAt: 1717430000000,
}

function fileFor(endpoint: Partial<EndpointInfo>): string {
	return JSON.stringify({ ...VALID, ...endpoint })
}

function errorOf(fn: () => unknown): CliError | undefined {
	try {
		fn()
		return undefined
	} catch (err) {
		return err instanceof CliError ? err : undefined
	}
}

function exitCodeOf(fn: () => unknown): number | undefined {
	return errorOf(fn)?.exitCode
}

describe('userData resolution', () => {
	test('matches Electrobun on each platform', () => {
		expect(appDataDir('darwin', {}, '/Users/x')).toBe('/Users/x/Library/Application Support')
		expect(appDataDir('linux', {}, '/home/x')).toBe('/home/x/.local/share')
		expect(appDataDir('linux', { XDG_DATA_HOME: '/data' }, '/home/x')).toBe('/data')
		expect(appDataDir('win32', { LOCALAPPDATA: 'C:\\local' }, 'C:\\Users\\x')).toBe('C:\\local')
	})

	test('the endpoint lives under <appData>/<identifier>/<channel>', () => {
		expect(userDataRoot('linux', {}, '/home/x')).toBe('/home/x/.local/share/dotaz.electrobun.dev')
	})
})

describe('parseEndpointFile', () => {
	test('accepts the documented shape', () => {
		expect(parseEndpointFile(fileFor({}))).toEqual(VALID)
	})

	test('accepts a tcp endpoint', () => {
		const parsed = parseEndpointFile(fileFor({ transport: 'tcp', socket: null, port: 51234 }))
		expect(parsed?.transport).toBe('tcp')
		expect(parsed?.port).toBe(51234)
	})

	test('rejects malformed or incomplete files', () => {
		expect(parseEndpointFile('not json')).toBeNull()
		expect(parseEndpointFile('[]')).toBeNull()
		expect(parseEndpointFile(fileFor({ token: '' }))).toBeNull()
		expect(parseEndpointFile(fileFor({ pid: 0 }))).toBeNull()
		expect(parseEndpointFile(fileFor({ socket: null }))).toBeNull()
		expect(parseEndpointFile(fileFor({ transport: 'tcp', socket: null, port: null }))).toBeNull()
	})
})

describe('candidateEndpointFiles', () => {
	test('collects endpoint-<pid>.json from every channel, ignoring anything else', () => {
		const root = mkdtempSync(join(tmpdir(), 'dotaz-endpoint-scan-'))
		try {
			mkdirSync(join(root, 'dev', 'cli'), { recursive: true })
			mkdirSync(join(root, 'stable', 'cli'), { recursive: true })
			// A channel that never enabled CLI access has no cli/ directory at all
			mkdirSync(join(root, 'canary'), { recursive: true })
			writeFileSync(join(root, 'dev', 'cli', 'endpoint-11.json'), fileFor({ pid: 11 }))
			writeFileSync(join(root, 'dev', 'cli', 'notes.json'), '{}')
			writeFileSync(join(root, 'stable', 'cli', 'endpoint-22.json'), fileFor({ pid: 22 }))

			expect(candidateEndpointFiles(root).sort()).toEqual([
				join(root, 'dev', 'cli', 'endpoint-11.json'),
				join(root, 'stable', 'cli', 'endpoint-22.json'),
			])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test('a missing root is not an error', () => {
		expect(candidateEndpointFiles(join(tmpdir(), 'dotaz-does-not-exist-1234'))).toEqual([])
	})
})

describe('discoverEndpoint', () => {
	const base = {
		platform: 'linux',
		env: {},
		home: '/home/x',
		readFile: () => fileFor({}),
		pidAlive: () => true,
	}

	const twoInstances = {
		...base,
		listCandidates: () => ['/a.json', '/b.json'],
		readFile: (file: string) => fileFor(file === '/b.json' ? { pid: 2, startedAt: 20 } : { pid: 1, startedAt: 10 }),
	}

	test('uses an explicit file when given', () => {
		const found = discoverEndpoint({ ...base, explicitFile: '/tmp/endpoint.json' })
		expect(found.file).toBe('/tmp/endpoint.json')
		expect(found.endpoint.pid).toBe(4242)
		expect(found.instances).toHaveLength(1)
	})

	test('DOTAZ_ENDPOINT overrides discovery', () => {
		const found = discoverEndpoint({ ...base, env: { DOTAZ_ENDPOINT: '/tmp/from-env.json' } })
		expect(found.file).toBe('/tmp/from-env.json')
	})

	test('scans every channel directory under userData', () => {
		const root = userDataRoot('linux', {}, '/home/x')
		const file = join(root, 'dev', 'cli', 'endpoint-4242.json')
		const found = discoverEndpoint({ ...base, listCandidates: () => [file] })
		expect(found.file).toBe(file)
	})

	test('prefers the most recently started live endpoint', () => {
		const found = discoverEndpoint(twoInstances)
		expect(found.file).toBe('/b.json')
	})

	test('reports every live instance, newest first', () => {
		const found = discoverEndpoint(twoInstances)
		expect(found.instances.map((i) => i.pid)).toEqual([2, 1])
	})

	test('dead instances are left out of the instance list', () => {
		const found = discoverEndpoint({ ...twoInstances, pidAlive: (pid: number) => pid === 1 })
		expect(found.endpoint.pid).toBe(1)
		expect(found.instances.map((i) => i.pid)).toEqual([1])
	})

	test('--instance selects a specific pid even when it is not the newest', () => {
		const found = discoverEndpoint({ ...twoInstances, instancePid: 1 })
		expect(found.endpoint.pid).toBe(1)
		expect(found.file).toBe('/a.json')
	})

	test('--instance with an unknown pid is a usage error listing the live ones', () => {
		const err = errorOf(() => discoverEndpoint({ ...twoInstances, instancePid: 999 }))
		expect(err?.exitCode).toBe(EXIT.usage)
		expect(err?.message).toContain('999')
		expect(err?.hint).toBe('Live instances: 2, 1')
	})

	test('--instance with a dead pid is a usage error', () => {
		const err = errorOf(() => discoverEndpoint({ ...twoInstances, instancePid: 2, pidAlive: (pid: number) => pid === 1 }))
		expect(err?.exitCode).toBe(EXIT.usage)
		expect(err?.hint).toBe('Live instances: 1')
	})

	test('--instance beats DOTAZ_ENDPOINT but conflicts with --endpoint', () => {
		const found = discoverEndpoint({ ...twoInstances, env: { DOTAZ_ENDPOINT: '/from-env.json' }, instancePid: 1 })
		expect(found.file).toBe('/a.json')

		const err = errorOf(() => discoverEndpoint({ ...twoInstances, instancePid: 1, explicitFile: '/x.json' }))
		expect(err?.exitCode).toBe(EXIT.usage)
	})

	test('--instance must be a process id', () => {
		expect(exitCodeOf(() => discoverEndpoint({ ...twoInstances, instancePid: 1.5 }))).toBe(EXIT.usage)
		expect(exitCodeOf(() => discoverEndpoint({ ...twoInstances, instancePid: -3 }))).toBe(EXIT.usage)
	})

	test('a dead pid is exit 5', () => {
		expect(exitCodeOf(() => discoverEndpoint({ ...base, listCandidates: () => ['/a.json'], pidAlive: () => false }))).toBe(EXIT.notRunning)
	})

	test('no endpoint file at all is exit 5', () => {
		expect(exitCodeOf(() => discoverEndpoint({ ...base, listCandidates: () => [] }))).toBe(EXIT.notRunning)
	})

	test('an unreadable explicit file is exit 5', () => {
		const code = exitCodeOf(() =>
			discoverEndpoint({
				...base,
				explicitFile: '/nope.json',
				readFile: () => {
					throw new Error('ENOENT')
				},
			})
		)
		expect(code).toBe(EXIT.notRunning)
	})

	test('a malformed file is exit 5, not a crash', () => {
		expect(exitCodeOf(() => discoverEndpoint({ ...base, listCandidates: () => ['/a.json'], readFile: () => '{' }))).toBe(EXIT.notRunning)
	})

	test('every exit-5 message tells the user how to enable CLI access', () => {
		expect(errorOf(() => discoverEndpoint({ ...base, listCandidates: () => [] }))?.hint).toContain('Allow CLI access')
	})
})

describe('listLiveInstances', () => {
	test('returns only live instances, newest first', () => {
		const instances = listLiveInstances({
			platform: 'linux',
			env: {},
			home: '/home/x',
			listCandidates: () => ['/a.json', '/b.json', '/c.json'],
			readFile: (file: string) =>
				fileFor(file === '/a.json' ? { pid: 1, startedAt: 10 } : file === '/b.json' ? { pid: 2, startedAt: 30 } : { pid: 3, startedAt: 20 }),
			pidAlive: (pid: number) => pid !== 3,
		})
		expect(instances.map((i) => i.endpoint.pid)).toEqual([2, 1])
	})

	test('nothing running is an empty list, not an error', () => {
		expect(listLiveInstances({ platform: 'linux', env: {}, home: '/home/x', listCandidates: () => [] })).toEqual([])
	})
})
