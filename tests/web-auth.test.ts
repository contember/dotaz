import { authorizeApiRequest, createWebAuthConfig, failureResponse, isAllowedHost, isLoopbackHost } from '@dotaz/backend-web/auth'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

describe('web RPC request isolation', () => {
	let originalAllowedHosts: string | undefined

	beforeEach(() => {
		originalAllowedHosts = process.env.DOTAZ_ALLOWED_HOSTS
		delete process.env.DOTAZ_ALLOWED_HOSTS
	})

	afterEach(() => {
		restoreEnv('DOTAZ_ALLOWED_HOSTS', originalAllowedHosts)
	})

	test('detects loopback hosts', () => {
		expect(isLoopbackHost('localhost')).toBe(true)
		expect(isLoopbackHost('127.0.0.1')).toBe(true)
		expect(isLoopbackHost('127.12.34.56')).toBe(true)
		expect(isLoopbackHost('[::1]')).toBe(true)
		expect(isLoopbackHost('0.0.0.0')).toBe(false)
		expect(isLoopbackHost('example.com')).toBe(false)
	})

	test('loopback bind allows same-origin browser requests without a token', () => {
		const config = createWebAuthConfig('localhost', {})
		expect(config.requireLoopbackHost).toBe(true)

		const req = new Request('http://localhost:6401/rpc', {
			headers: {
				host: 'localhost:6401',
				origin: 'http://localhost:6401',
				'sec-fetch-site': 'same-origin',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({ ok: true })
	})

	test('public bind allows same-origin browser requests without a token', () => {
		const config = createWebAuthConfig('0.0.0.0', {})
		expect(config.requireLoopbackHost).toBe(false)

		const req = new Request('https://dotaz.example/rpc', {
			headers: {
				host: 'dotaz.example',
				origin: 'https://dotaz.example',
				'sec-fetch-site': 'same-origin',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({ ok: true })
	})

	test('rejects cross-site browser requests', () => {
		const config = createWebAuthConfig('0.0.0.0', {})
		const req = new Request('https://dotaz.example/rpc', {
			headers: {
				host: 'dotaz.example',
				origin: 'https://evil.example',
				'sec-fetch-site': 'cross-site',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({
			ok: false,
			status: 403,
			reason: 'Cross-site requests are not allowed',
		})
	})

	test('rejects a foreign Origin when Sec-Fetch-Site is absent', () => {
		const config = createWebAuthConfig('0.0.0.0', {})
		const req = new Request('https://dotaz.example/rpc', {
			headers: {
				host: 'dotaz.example',
				origin: 'https://evil.example',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({
			ok: false,
			status: 403,
			reason: 'Origin not allowed',
		})
	})

	test('allows Vite web dev origin for loopback backend', () => {
		const config = createWebAuthConfig('localhost', {})
		const req = new Request('http://localhost:6401/rpc', {
			headers: {
				host: 'localhost:6401',
				origin: 'http://localhost:6402',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({ ok: true })
	})

	test('allows reverse proxy Host when explicitly configured and Origin is same-host', () => {
		const config = createWebAuthConfig('localhost', {
			DOTAZ_ALLOWED_HOSTS: 'dotaz.example',
		})
		const req = new Request('http://dotaz.example/rpc', {
			headers: {
				host: 'dotaz.example',
				origin: 'https://dotaz.example',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({ ok: true })
	})

	test('rejects different reverse proxy Origin even when Host is allowed', () => {
		const config = createWebAuthConfig('localhost', {
			DOTAZ_ALLOWED_HOSTS: 'dotaz.example',
		})
		const req = new Request('http://dotaz.example/rpc', {
			headers: {
				host: 'dotaz.example',
				origin: 'https://app.example',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({
			ok: false,
			status: 403,
			reason: 'Origin not allowed',
		})
	})

	test('loopback bind rejects non-loopback Host by default', () => {
		const config = createWebAuthConfig('localhost', {})
		const req = new Request('http://localhost:6401/rpc', {
			headers: { host: 'dotaz.example' },
		})

		expect(isAllowedHost(req, config)).toBe(false)
		expect(authorizeApiRequest(req, config)).toEqual({
			ok: false,
			status: 403,
			reason: 'Host not allowed',
		})
	})

	test('loopback bind allows explicitly configured public Host', () => {
		const config = createWebAuthConfig('localhost', { DOTAZ_ALLOWED_HOSTS: 'public.example.com' })
		const req = new Request('http://public.example.com/rpc', {
			headers: {
				host: 'public.example.com',
				origin: 'http://public.example.com',
			},
		})

		expect(isAllowedHost(req, config)).toBe(true)
		expect(authorizeApiRequest(req, config)).toEqual({ ok: true })
	})

	test('allowed host with a port matches a request carrying that port', () => {
		const config = createWebAuthConfig('0.0.0.0', {
			DOTAZ_ALLOWED_HOSTS: 'db.example.com:8080',
		})
		const req = new Request('http://db.example.com:8080/rpc', {
			headers: {
				host: 'db.example.com:8080',
				origin: 'http://db.example.com:8080',
			},
		})

		expect(isAllowedHost(req, config)).toBe(true)
		expect(authorizeApiRequest(req, config)).toEqual({ ok: true })
	})

	test('failureResponse preserves request isolation status and reason', async () => {
		const response = failureResponse({ ok: false, status: 403, reason: 'Origin not allowed' }, 'json')

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Origin not allowed' })
	})
})

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name]
	} else {
		process.env[name] = value
	}
}
