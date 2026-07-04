import {
	authorizeApiRequest,
	createTokenRedirectResponse,
	createWebAuthConfig,
	failureResponse,
	isAllowedHost,
	isLoopbackHost,
	RPC_COOKIE_NAME,
} from '@dotaz/backend-web/auth'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

describe('web RPC auth', () => {
	let originalAllowedHosts: string | undefined
	let originalAllowedOrigins: string | undefined
	let originalRpcToken: string | undefined

	beforeEach(() => {
		originalAllowedHosts = process.env.DOTAZ_ALLOWED_HOSTS
		originalAllowedOrigins = process.env.DOTAZ_ALLOWED_ORIGINS
		originalRpcToken = process.env.DOTAZ_RPC_TOKEN
		delete process.env.DOTAZ_ALLOWED_HOSTS
		delete process.env.DOTAZ_ALLOWED_ORIGINS
		delete process.env.DOTAZ_RPC_TOKEN
	})

	afterEach(() => {
		restoreEnv('DOTAZ_ALLOWED_HOSTS', originalAllowedHosts)
		restoreEnv('DOTAZ_ALLOWED_ORIGINS', originalAllowedOrigins)
		restoreEnv('DOTAZ_RPC_TOKEN', originalRpcToken)
	})

	test('detects loopback hosts', () => {
		expect(isLoopbackHost('localhost')).toBe(true)
		expect(isLoopbackHost('127.0.0.1')).toBe(true)
		expect(isLoopbackHost('127.12.34.56')).toBe(true)
		expect(isLoopbackHost('[::1]')).toBe(true)
		expect(isLoopbackHost('0.0.0.0')).toBe(false)
		expect(isLoopbackHost('example.com')).toBe(false)
	})

	test('loopback bind uses host and browser isolation without token auth', () => {
		const config = createWebAuthConfig('localhost', {})
		expect(config.token).toBeNull()
		expect(config.tokenGenerated).toBe(false)
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

	test('non-loopback bind generates a process token when none is configured', () => {
		const config = createWebAuthConfig('0.0.0.0', {})
		expect(config.token).toMatch(/^[a-f0-9]{64}$/)
		expect(config.tokenGenerated).toBe(true)
		expect(config.requireLoopbackHost).toBe(false)
	})

	test('uses configured token without generating a replacement', () => {
		const config = createWebAuthConfig('0.0.0.0', { DOTAZ_RPC_TOKEN: 'secret-token' })
		expect(config.token).toBe('secret-token')
		expect(config.tokenGenerated).toBe(false)
	})

	test('authorizes public requests with matching cookie token', () => {
		const config = createWebAuthConfig('0.0.0.0', { DOTAZ_RPC_TOKEN: 'secret-token' })
		const req = new Request('http://dotaz.example/rpc', {
			headers: {
				cookie: `${RPC_COOKIE_NAME}=secret-token`,
				host: 'dotaz.example',
				origin: 'http://dotaz.example',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({ ok: true })
	})

	test('authorizes public requests with bearer token', () => {
		const config = createWebAuthConfig('0.0.0.0', { DOTAZ_RPC_TOKEN: 'secret-token' })
		const req = new Request('http://dotaz.example/rpc', {
			headers: {
				authorization: 'Bearer secret-token',
				host: 'dotaz.example',
				origin: 'http://dotaz.example',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({ ok: true })
	})

	test('rejects missing public token', () => {
		const config = createWebAuthConfig('0.0.0.0', { DOTAZ_RPC_TOKEN: 'secret-token' })
		const req = new Request('http://dotaz.example/rpc', {
			headers: {
				host: 'dotaz.example',
				origin: 'http://dotaz.example',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({
			ok: false,
			status: 401,
			reason: 'RPC authentication required',
		})
	})

	test('rejects cross-site browser requests even with token', () => {
		const config = createWebAuthConfig('0.0.0.0', { DOTAZ_RPC_TOKEN: 'secret-token' })
		const req = new Request('http://dotaz.example/rpc', {
			headers: {
				cookie: `${RPC_COOKIE_NAME}=secret-token`,
				host: 'dotaz.example',
				origin: 'http://evil.example',
				'sec-fetch-site': 'cross-site',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({
			ok: false,
			status: 403,
			reason: 'Cross-site requests are not allowed',
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

	test('allows configured origins', () => {
		const config = createWebAuthConfig('0.0.0.0', {
			DOTAZ_ALLOWED_ORIGINS: 'https://dotaz.example',
			DOTAZ_RPC_TOKEN: 'secret-token',
		})
		const req = new Request('http://dotaz.internal:6401/rpc', {
			headers: {
				cookie: `${RPC_COOKIE_NAME}=secret-token`,
				host: 'dotaz.internal:6401',
				origin: 'https://dotaz.example',
			},
		})

		expect(authorizeApiRequest(req, config)).toEqual({ ok: true })
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

	test('token redirect sets HttpOnly SameSite cookie and strips token from URL', () => {
		const config = createWebAuthConfig('0.0.0.0', { DOTAZ_RPC_TOKEN: 'secret-token' })
		const url = new URL('http://dotaz.example/?rpcToken=secret-token&tab=1')
		const req = new Request(url, { headers: { host: 'dotaz.example' } })

		const response = createTokenRedirectResponse(req, url, config)

		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe('/?tab=1')
		expect(response.headers.get('set-cookie')).toContain(`${RPC_COOKIE_NAME}=secret-token`)
		expect(response.headers.get('set-cookie')).toContain('HttpOnly')
		expect(response.headers.get('set-cookie')).toContain('SameSite=Strict')
	})

	test('failureResponse preserves auth status and reason', async () => {
		const response = failureResponse({ ok: false, status: 401, reason: 'RPC authentication required' }, 'json')

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'RPC authentication required' })
	})
})

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name]
	} else {
		process.env[name] = value
	}
}
