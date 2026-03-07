// Error handling utilities for RPC — separated from rpc.ts to avoid Electrobun dependency in tests

import type { DatabaseErrorCode } from '../../shared/types/errors'
import { friendlyMessageForCode } from '../../shared/types/errors'

export class RpcError extends Error {
	/** Domain error code from the backend, if available */
	public readonly code: DatabaseErrorCode | undefined

	constructor(
		public readonly method: string,
		public readonly cause: unknown,
	) {
		const message = cause instanceof Error ? cause.message : String(cause)
		super(`${method}: ${message}`)
		this.name = 'RpcError'
		this.code = (cause as any)?.code as DatabaseErrorCode | undefined
	}
}

/** Map common DB/connection error patterns to user-friendly messages */
export function friendlyErrorMessage(err: unknown): string {
	const raw = typeof (err as any)?.message === 'string' ? (err as any).message : String(err)

	// If we have a typed error code, use the centralized mapping
	const code = (err as any)?.code as DatabaseErrorCode | undefined
	if (code && code !== 'UNKNOWN') {
		// Strip method prefix from RpcError messages before passing to friendly mapper
		const stripped = raw.replace(/^[\w.]+:\s*/, '')
		return friendlyMessageForCode(code, stripped || raw)
	}

	// Fallback: regex-based pattern matching for backward compatibility
	// Connection errors
	if (/ECONNREFUSED|connection refused/i.test(raw)) return 'Connection refused \u2014 is the database server running?'
	if (/authentication failed|password authentication/i.test(raw)) return 'Authentication failed \u2014 check username and password'
	if (/database .* does not exist|unknown database/i.test(raw)) return 'Database not found \u2014 check the database name'
	if (/timeout|timed out/i.test(raw)) return 'Connection timed out \u2014 check host and port'
	if (/ENOTFOUND|getaddrinfo/i.test(raw)) return 'Host not found \u2014 check the hostname'
	if (/SSL|TLS|certificate/i.test(raw)) return 'SSL/TLS error \u2014 check your SSL configuration'
	if (/too many connections|connection limit/i.test(raw)) return 'Too many connections \u2014 try again later'

	// Query errors — pass through SQL error messages as they're useful to developers
	if (/syntax error/i.test(raw)) return raw.replace(/^[^:]+:\s*/, '')
	if (/relation .* does not exist|no such table/i.test(raw)) return raw.replace(/^[^:]+:\s*/, '')
	if (/column .* does not exist|no such column/i.test(raw)) return raw.replace(/^[^:]+:\s*/, '')
	if (/violates .* constraint/i.test(raw)) return raw.replace(/^[^:]+:\s*/, '')
	if (/permission denied/i.test(raw)) return 'Permission denied \u2014 insufficient privileges'

	// Strip method prefix from RpcError messages (e.g. "connections.connect: actual error")
	const stripped = raw.replace(/^[\w.]+:\s*/, '')
	return stripped || 'An unexpected error occurred'
}
