// Request security for web mode, three independent layers:
//  1. Host validation — on loopback binds the Host header must itself be loopback (DNS-rebinding defense)
//  2. Browser isolation — Sec-Fetch-Site + Origin checks reject cross-site requests (CSRF/WS-hijack defense)
//  3. Token auth — required when publicly reachable (non-loopback bind, or a loopback bind exposed via a
//     non-loopback allowed host/origin); delivered once via ?rpcToken= and stored in an HttpOnly cookie
// A purely local loopback bind skips layer 3: layers 1+2 already block every browser-based attack,
// and a local process can reach the port either way.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const RPC_COOKIE_NAME = 'dotaz_rpc_token'

// Persistent so the ?rpcToken= link is needed once per browser, not once per browser restart
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export interface WebAuthConfig {
	token: string | null
	tokenGenerated: boolean
	requireLoopbackHost: boolean
	allowedHosts: Set<string>
	allowedOrigins: Set<string>
}

export type AuthFailure = { ok: false; status: 401 | 403; reason: string }
export type AuthResult = { ok: true } | AuthFailure

export function isLoopbackHost(host: string): boolean {
	const normalized = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
	return normalized === 'localhost' || normalized === '::1' || /^127(\.\d{1,3}){3}$/.test(normalized)
}

export function createWebAuthConfig(
	bindHost: string,
	env: Record<string, string | undefined> = process.env,
): WebAuthConfig {
	const configuredToken = env.DOTAZ_RPC_TOKEN?.trim() || null
	const loopbackBind = isLoopbackHost(bindHost)

	// Normalize allowed hosts exactly like the request hostname (lowercase + strip port/brackets),
	// so entries with a port or IPv6 brackets still match.
	const allowedHosts = parseList(env.DOTAZ_ALLOWED_HOSTS, (value) => hostnameFromHostHeader(value.toLowerCase()))
	const allowedOrigins = parseList(env.DOTAZ_ALLOWED_ORIGINS, normalizeOrigin)

	// A loopback bind fronted by a reverse proxy is signalled by a non-loopback allowed host/origin —
	// treat that as intentional external exposure so token auth still applies.
	const externallyExposed = someHost(allowedHosts, (host) => !isLoopbackHost(host))
		|| someHost(allowedOrigins, (origin) => !isOriginLoopback(origin))
	const publiclyReachable = !loopbackBind || externallyExposed

	let token = configuredToken
	let tokenGenerated = false
	if (!token && publiclyReachable) {
		token = randomBytes(32).toString('hex')
		tokenGenerated = true
	}

	return {
		token,
		tokenGenerated,
		requireLoopbackHost: loopbackBind,
		allowedHosts,
		allowedOrigins,
	}
}

function someHost(set: Set<string>, predicate: (value: string) => boolean): boolean {
	for (const value of set) {
		if (predicate(value)) return true
	}
	return false
}

function isOriginLoopback(origin: string): boolean {
	try {
		return isLoopbackHost(new URL(origin).hostname)
	} catch {
		return false // unparseable origin — treat as external exposure (safer)
	}
}

// Applied to every route (including static files) — a rebound page must not reach the server at all
export function isAllowedHost(req: Request, config: WebAuthConfig): boolean {
	const hostname = hostnameFromHostHeader(requestHost(req))
	if (config.requireLoopbackHost) {
		return isLoopbackHost(hostname) || config.allowedHosts.has(hostname)
	}
	if (config.allowedHosts.size > 0) {
		return config.allowedHosts.has(hostname)
	}
	return true
}

export function authorizeApiRequest(req: Request, config: WebAuthConfig): AuthResult {
	if (!isAllowedHost(req, config)) {
		return { ok: false, status: 403, reason: 'Host not allowed' }
	}
	if (!isAllowedFetchSite(req)) {
		return { ok: false, status: 403, reason: 'Cross-site requests are not allowed' }
	}
	if (!isAllowedOrigin(req, config)) {
		return { ok: false, status: 403, reason: 'Origin not allowed' }
	}
	if (config.token !== null && !tokenMatches(getRequestToken(req), config.token)) {
		return { ok: false, status: 401, reason: 'RPC authentication required' }
	}
	return { ok: true }
}

// Possession of the token is the authorization here — the link is legitimately opened
// cross-site (chat, email), so only the Host layer applies on top of the token match.
export function createTokenRedirectResponse(req: Request, url: URL, config: WebAuthConfig): Response {
	if (config.token === null || !tokenMatches(url.searchParams.get('rpcToken'), config.token)) {
		return new Response('Invalid rpcToken', { status: 401 })
	}

	const redirectUrl = new URL(url)
	redirectUrl.searchParams.delete('rpcToken')
	// Collapse leading slashes so the path can't become "//host" (protocol-relative → open redirect)
	const safePath = redirectUrl.pathname.replace(/^\/+/, '/')
	return new Response(null, {
		status: 302,
		headers: {
			Location: `${safePath}${redirectUrl.search}`,
			'Set-Cookie': createAuthCookie(req, config.token),
		},
	})
}

export function failureResponse(failure: AuthFailure, format: 'json' | 'text'): Response {
	if (format === 'json') {
		return Response.json({ error: failure.reason }, { status: failure.status })
	}
	return new Response(failure.reason, { status: failure.status })
}

function createAuthCookie(req: Request, token: string): string {
	const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
	const secure = new URL(req.url).protocol === 'https:' || forwardedProto === 'https'
	const parts = [
		`${RPC_COOKIE_NAME}=${encodeURIComponent(token)}`,
		'Path=/',
		`Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
		'HttpOnly',
		'SameSite=Strict',
	]
	if (secure) parts.push('Secure')
	return parts.join('; ')
}

// Forbidden header — browsers set it, attacker JS cannot. Absent on non-browser
// clients and pre-2023 Safari; the Origin and token layers still apply there.
function isAllowedFetchSite(req: Request): boolean {
	const site = req.headers.get('sec-fetch-site')
	return site === null || site === 'same-origin' || site === 'none'
}

function isAllowedOrigin(req: Request, config: WebAuthConfig): boolean {
	const origin = req.headers.get('origin')
	// Absent on non-browser clients and same-origin GETs — CSRF does not apply to either
	if (origin === null) return true
	if (config.allowedOrigins.has(origin)) return true

	let originUrl: URL
	try {
		originUrl = new URL(origin)
	} catch {
		return false // includes the opaque "null" origin
	}

	const host = requestHost(req)
	// Scheme intentionally ignored: an https-terminating reverse proxy forwards plain http upstream
	if (originUrl.host === host) return true

	// Loopback page talking to a loopback-addressed server, e.g. Vite dev on another port
	return isLoopbackHost(originUrl.hostname) && isLoopbackHost(hostnameFromHostHeader(host))
}

function getRequestToken(req: Request): string | null {
	const cookieToken = getCookieValue(req, RPC_COOKIE_NAME)
	if (cookieToken) return cookieToken

	// Bearer supports non-browser clients (scripts, health checks)
	const authorization = req.headers.get('authorization')?.trim()
	const bearerPrefix = 'bearer '
	if (authorization?.toLowerCase().startsWith(bearerPrefix)) {
		const token = authorization.slice(bearerPrefix.length).trim()
		if (token) return token
	}

	return null
}

function tokenMatches(provided: string | null, expected: string): boolean {
	if (!provided) return false
	const a = Uint8Array.from(createHash('sha256').update(provided).digest())
	const b = Uint8Array.from(createHash('sha256').update(expected).digest())
	return timingSafeEqual(a, b)
}

function getCookieValue(req: Request, name: string): string | null {
	const cookieHeader = req.headers.get('cookie')
	if (!cookieHeader) return null

	for (const item of cookieHeader.split(';')) {
		const [rawName, ...valueParts] = item.trim().split('=')
		if (rawName !== name) continue
		const rawValue = valueParts.join('=')
		if (!rawValue) return null
		try {
			return decodeURIComponent(rawValue)
		} catch {
			return rawValue
		}
	}

	return null
}

function requestHost(req: Request): string {
	return (req.headers.get('host') ?? new URL(req.url).host).trim().toLowerCase()
}

function hostnameFromHostHeader(host: string): string {
	if (host.startsWith('[')) {
		const end = host.indexOf(']')
		return end === -1 ? host : host.slice(1, end)
	}
	return host.split(':')[0] ?? host
}

function parseList(value: string | undefined, normalize: (item: string) => string): Set<string> {
	const result = new Set<string>()
	if (!value) return result
	for (const item of value.split(',')) {
		const trimmed = item.trim()
		if (trimmed) result.add(normalize(trimmed))
	}
	return result
}

function normalizeOrigin(value: string): string {
	try {
		return new URL(value).origin
	} catch {
		return value
	}
}
