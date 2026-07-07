// Request security for web mode, two independent layers:
//  1. Host validation — on loopback binds the Host header must itself be loopback (DNS-rebinding defense)
//  2. Browser isolation — Sec-Fetch-Site + Origin checks reject cross-site requests (CSRF/WS-hijack defense)
// This is not user authentication; it only keeps arbitrary cross-site browser JS from invoking Dotaz RPC.

export interface WebAuthConfig {
	requireLoopbackHost: boolean
	allowedHosts: Set<string>
}

export type AuthFailure = { ok: false; status: 403; reason: string }
export type AuthResult = { ok: true } | AuthFailure

export function isLoopbackHost(host: string): boolean {
	const normalized = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
	return normalized === 'localhost' || normalized === '::1' || /^127(\.\d{1,3}){3}$/.test(normalized)
}

export function createWebAuthConfig(
	bindHost: string,
	env: Record<string, string | undefined> = process.env,
): WebAuthConfig {
	const loopbackBind = isLoopbackHost(bindHost)

	// Normalize allowed hosts exactly like the request hostname (lowercase + strip port/brackets),
	// so entries with a port or IPv6 brackets still match.
	const allowedHosts = parseList(env.DOTAZ_ALLOWED_HOSTS, (value) => hostnameFromHostHeader(value.toLowerCase()))

	return {
		requireLoopbackHost: loopbackBind,
		allowedHosts,
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
	if (!isAllowedOrigin(req)) {
		return { ok: false, status: 403, reason: 'Origin not allowed' }
	}
	return { ok: true }
}

export function failureResponse(failure: AuthFailure, format: 'json' | 'text'): Response {
	if (format === 'json') {
		return Response.json({ error: failure.reason }, { status: failure.status })
	}
	return new Response(failure.reason, { status: failure.status })
}

// Forbidden header — browsers set it, attacker JS cannot. Absent on non-browser
// clients and pre-2023 Safari; the Origin layer still applies there.
function isAllowedFetchSite(req: Request): boolean {
	const site = req.headers.get('sec-fetch-site')
	return site === null || site === 'same-origin' || site === 'none'
}

function isAllowedOrigin(req: Request): boolean {
	const origin = req.headers.get('origin')
	// Absent on non-browser clients and same-origin GETs — CSRF does not apply to either
	if (origin === null) return true

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
