import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { appDataDir, discoverEndpoint, type EndpointInfo, parseEndpointFile, userDataRoot } from '../src/cli-agent/endpoint'
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

function exitCodeOf(fn: () => unknown): number | undefined {
	try {
		fn()
		return undefined
	} catch (err) {
		return err instanceof CliError ? err.exitCode : undefined
	}
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

describe('discoverEndpoint', () => {
	const base = {
		platform: 'linux',
		env: {},
		home: '/home/x',
		readFile: () => fileFor({}),
		pidAlive: () => true,
	}

	test('uses an explicit file when given', () => {
		const found = discoverEndpoint({ ...base, explicitFile: '/tmp/endpoint.json' })
		expect(found.file).toBe('/tmp/endpoint.json')
		expect(found.endpoint.pid).toBe(4242)
	})

	test('DOTAZ_ENDPOINT overrides discovery', () => {
		const found = discoverEndpoint({ ...base, env: { DOTAZ_ENDPOINT: '/tmp/from-env.json' } })
		expect(found.file).toBe('/tmp/from-env.json')
	})

	test('scans every channel directory under userData', () => {
		const root = userDataRoot('linux', {}, '/home/x')
		const found = discoverEndpoint({ ...base, listCandidates: () => [join(root, 'dev', 'cli-endpoint.json')] })
		expect(found.file).toBe(join(root, 'dev', 'cli-endpoint.json'))
	})

	test('prefers the most recently started live endpoint', () => {
		const files = ['/a.json', '/b.json']
		const found = discoverEndpoint({
			...base,
			listCandidates: () => files,
			readFile: (file) => fileFor(file === '/b.json' ? { pid: 2, startedAt: 20 } : { pid: 1, startedAt: 10 }),
		})
		expect(found.file).toBe('/b.json')
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
		try {
			discoverEndpoint({ ...base, listCandidates: () => [] })
			expect.unreachable()
		} catch (err) {
			expect(err instanceof CliError && err.hint).toContain('Allow CLI access')
		}
	})
})
