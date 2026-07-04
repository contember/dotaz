export const RPC_COOKIE_NAME = 'dotaz_rpc_token'

export interface RpcAuthConfig {
	token: string
	exposeToken: boolean
	cookieName: string
}

export function isLoopbackHost(host: string): boolean {
	const normalized = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
	return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

export function createRpcAuthConfig(host: string, configuredToken = process.env.DOTAZ_RPC_TOKEN): RpcAuthConfig {
	const token = configuredToken?.trim()
	if (!token && !isLoopbackHost(host)) {
		throw new Error('DOTAZ_RPC_TOKEN is required when DOTAZ_HOST is not loopback')
	}

	return {
		token: token ?? crypto.randomUUID(),
		exposeToken: !token,
		cookieName: RPC_COOKIE_NAME,
	}
}

export function createRpcAuthCookie(req: Request, config: RpcAuthConfig): string {
	const url = new URL(req.url)
	const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
	const secure = url.protocol === 'https:' || forwardedProto === 'https'
	const parts = [
		`${config.cookieName}=${encodeURIComponent(config.token)}`,
		'Path=/',
		'HttpOnly',
		'SameSite=Strict',
	]
	if (secure) parts.push('Secure')
	return parts.join('; ')
}

export function getRequestRpcToken(req: Request, config: RpcAuthConfig): string | null {
	const cookieToken = getCookieValue(req, config.cookieName)
	if (cookieToken) return cookieToken

	const authorization = req.headers.get('authorization')?.trim()
	const bearerPrefix = 'bearer '
	if (authorization?.toLowerCase().startsWith(bearerPrefix)) {
		const token = authorization.slice(bearerPrefix.length).trim()
		if (token) return token
	}

	const headerToken = req.headers.get('x-dotaz-rpc-token')?.trim()
	return headerToken || null
}

export function getProvisioningRpcToken(req: Request, url: URL, config: RpcAuthConfig): string | null {
	return getRequestRpcToken(req, config) ?? url.searchParams.get('rpcToken')?.trim() ?? null
}

export function isRpcRequestAuthorized(req: Request, url: URL, config: RpcAuthConfig): boolean {
	return isAllowedOrigin(req, url) && getRequestRpcToken(req, config) === config.token
}

export function canProvisionRpcCookie(req: Request, url: URL, config: RpcAuthConfig): boolean {
	if (!isAllowedOrigin(req, url)) return false
	if (config.exposeToken) return true
	return getProvisioningRpcToken(req, url, config) === config.token
}

export function createBootstrapResponse(req: Request, url: URL, config: RpcAuthConfig): Response {
	if (!canProvisionRpcCookie(req, url, config)) {
		return unauthorizedJsonResponse('RPC authentication required')
	}

	return new Response(JSON.stringify({ ok: true }), {
		headers: {
			'Content-Type': 'application/json',
			'Set-Cookie': createRpcAuthCookie(req, config),
		},
	})
}

export function createTokenRedirectResponse(req: Request, url: URL, config: RpcAuthConfig): Response {
	if (!canProvisionRpcCookie(req, url, config)) {
		return unauthorizedTextResponse('RPC authentication failed')
	}

	const redirectUrl = new URL(url)
	redirectUrl.searchParams.delete('rpcToken')
	const location = `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`
	return new Response(null, {
		status: 302,
		headers: {
			Location: location,
			'Set-Cookie': createRpcAuthCookie(req, config),
		},
	})
}

export function withRpcAuthCookie(req: Request, config: RpcAuthConfig, headers: HeadersInit = {}): Headers {
	const result = new Headers(headers)
	if (canProvisionRpcCookie(req, new URL(req.url), config)) {
		result.set('Set-Cookie', createRpcAuthCookie(req, config))
	}
	return result
}

export function unauthorizedJsonResponse(message = 'Unauthorized'): Response {
	return new Response(JSON.stringify({ error: message }), {
		status: 401,
		headers: { 'Content-Type': 'application/json' },
	})
}

export function unauthorizedTextResponse(message = 'Unauthorized'): Response {
	return new Response(message, { status: 401 })
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

function isAllowedOrigin(req: Request, url: URL): boolean {
	const origin = req.headers.get('origin')
	if (!origin) return true

	const allowedOrigins = new Set<string>()
	allowedOrigins.add(requestOrigin(req, url))

	const configured = process.env.DOTAZ_ALLOWED_ORIGINS
	if (configured) {
		for (const item of configured.split(',')) {
			const value = item.trim()
			if (value) allowedOrigins.add(value)
		}
	}

	if (isLoopbackRequest(req, url)) {
		allowedOrigins.add('http://localhost:6402')
		allowedOrigins.add('http://127.0.0.1:6402')
		allowedOrigins.add('http://[::1]:6402')
	}

	return allowedOrigins.has(origin)
}

function requestOrigin(req: Request, url: URL): string {
	const host = req.headers.get('host') ?? url.host
	const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
	const protocol = forwardedProto || url.protocol.replace(/:$/, '')
	return `${protocol}://${host}`
}

function isLoopbackRequest(req: Request, url: URL): boolean {
	const host = req.headers.get('host') ?? url.host
	return isLoopbackHost(url.hostname) || isLoopbackHost(hostnameFromHostHeader(host))
}

function hostnameFromHostHeader(host: string): string {
	const trimmed = host.trim()
	if (trimmed.startsWith('[')) {
		const end = trimmed.indexOf(']')
		return end === -1 ? trimmed : trimmed.slice(1, end)
	}
	return trimmed.split(':')[0] ?? trimmed
}
