import {
	canProvisionRpcCookie,
	createBootstrapResponse,
	createRpcAuthConfig,
	createRpcAuthCookie,
	getRequestRpcToken,
	isLoopbackHost,
	isRpcRequestAuthorized,
	RPC_COOKIE_NAME,
} from '@dotaz/backend-web/auth'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

describe('web RPC auth', () => {
	let originalAllowedOrigins: string | undefined

	beforeEach(() => {
		originalAllowedOrigins = process.env.DOTAZ_ALLOWED_ORIGINS
		delete process.env.DOTAZ_ALLOWED_ORIGINS
	})

	afterEach(() => {
		if (originalAllowedOrigins === undefined) {
			delete process.env.DOTAZ_ALLOWED_ORIGINS
		} else {
			process.env.DOTAZ_ALLOWED_ORIGINS = originalAllowedOrigins
		}
	})

	test('detects loopback hosts', () => {
		expect(isLoopbackHost('localhost')).toBe(true)
		expect(isLoopbackHost('127.0.0.1')).toBe(true)
		expect(isLoopbackHost('[::1]')).toBe(true)
		expect(isLoopbackHost('0.0.0.0')).toBe(false)
		expect(isLoopbackHost('example.com')).toBe(false)
	})

	test('allows generated token only on loopback hosts', () => {
		const config = createRpcAuthConfig('localhost', undefined)
		expect(config.exposeToken).toBe(true)
		expect(config.token.length).toBeGreaterThan(0)

		expect(() => createRpcAuthConfig('0.0.0.0', undefined)).toThrow('DOTAZ_RPC_TOKEN')
	})

	test('uses configured token without exposing it', () => {
		const config = createRpcAuthConfig('0.0.0.0', 'secret-token')
		expect(config.token).toBe('secret-token')
		expect(config.exposeToken).toBe(false)
	})

	test('reads RPC token from cookie, bearer, and header', () => {
		const config = createRpcAuthConfig('localhost', 'secret-token')
		const cookieReq = new Request('http://localhost:6401/rpc', {
			headers: { cookie: `${RPC_COOKIE_NAME}=secret-token` },
		})
		const bearerReq = new Request('http://localhost:6401/rpc', {
			headers: { authorization: 'Bearer secret-token' },
		})
		const headerReq = new Request('http://localhost:6401/rpc', {
			headers: { 'x-dotaz-rpc-token': 'secret-token' },
		})

		expect(getRequestRpcToken(cookieReq, config)).toBe('secret-token')
		expect(getRequestRpcToken(bearerReq, config)).toBe('secret-token')
		expect(getRequestRpcToken(headerReq, config)).toBe('secret-token')
	})

	test('authorizes matching token from same origin', () => {
		const config = createRpcAuthConfig('localhost', 'secret-token')
		const url = new URL('http://localhost:6401/rpc')
		const req = new Request(url, {
			headers: {
				cookie: `${RPC_COOKIE_NAME}=secret-token`,
				origin: 'http://localhost:6401',
			},
		})

		expect(isRpcRequestAuthorized(req, url, config)).toBe(true)
	})

	test('rejects cross-origin requests even with token', () => {
		const config = createRpcAuthConfig('localhost', 'secret-token')
		const url = new URL('http://localhost:6401/rpc')
		const req = new Request(url, {
			headers: {
				cookie: `${RPC_COOKIE_NAME}=secret-token`,
				origin: 'http://evil.example',
			},
		})

		expect(isRpcRequestAuthorized(req, url, config)).toBe(false)
	})

	test('allows Vite web dev origin for loopback backend', () => {
		const config = createRpcAuthConfig('localhost', 'secret-token')
		const url = new URL('http://localhost:6401/rpc')
		const req = new Request(url, {
			headers: {
				host: 'localhost:6401',
				cookie: `${RPC_COOKIE_NAME}=secret-token`,
				origin: 'http://localhost:6402',
			},
		})

		expect(isRpcRequestAuthorized(req, url, config)).toBe(true)
	})

	test('allows configured origins', () => {
		process.env.DOTAZ_ALLOWED_ORIGINS = 'https://dotaz.example'
		const config = createRpcAuthConfig('0.0.0.0', 'secret-token')
		const url = new URL('http://dotaz.internal:6401/rpc')
		const req = new Request(url, {
			headers: {
				cookie: `${RPC_COOKIE_NAME}=secret-token`,
				origin: 'https://dotaz.example',
			},
		})

		expect(isRpcRequestAuthorized(req, url, config)).toBe(true)
	})

	test('sets HttpOnly SameSite cookie for bootstrap', async () => {
		const config = createRpcAuthConfig('localhost', undefined)
		const url = new URL('http://localhost:6401/api/bootstrap')
		const req = new Request(url)

		const response = createBootstrapResponse(req, url, config)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true })
		expect(response.headers.get('set-cookie')).toContain('HttpOnly')
		expect(response.headers.get('set-cookie')).toContain('SameSite=Strict')
	})

	test('requires explicit token before provisioning public cookie', () => {
		const config = createRpcAuthConfig('0.0.0.0', 'secret-token')
		const url = new URL('http://dotaz.example/api/bootstrap')
		const req = new Request(url)

		expect(canProvisionRpcCookie(req, url, config)).toBe(false)
		expect(createBootstrapResponse(req, url, config).status).toBe(401)
	})

	test('provisions public cookie from matching one-time URL token', () => {
		const config = createRpcAuthConfig('0.0.0.0', 'secret-token')
		const url = new URL('http://dotaz.example/api/bootstrap?rpcToken=secret-token')
		const req = new Request(url)

		expect(canProvisionRpcCookie(req, url, config)).toBe(true)
		expect(createRpcAuthCookie(req, config)).toContain(`${RPC_COOKIE_NAME}=secret-token`)
	})
})
