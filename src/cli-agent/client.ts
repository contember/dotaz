// One-shot JSON RPC over the control server's unix socket (loopback TCP on Windows).

import type { DatabaseErrorCode } from '@dotaz/shared/types/errors'
import { randomUUID } from 'node:crypto'
import type { EndpointInfo } from './endpoint'
import { CliError, EXIT, messageOf, notRunningError, readOnlyError, START_DOTAZ_HINT, timeoutError } from './errors'

export const DEFAULT_TIMEOUT_MS = 30_000

/** A cancel issued because we stopped waiting must not start a long wait of its own. */
export const CANCEL_TIMEOUT_MS = 3_000

export interface RpcFailure {
	message: string
	errorCode?: DatabaseErrorCode
}

/** Thrown for `success: false` envelopes so callers can branch on `errorCode`. */
export class RpcError extends CliError {
	readonly errorCode?: DatabaseErrorCode

	constructor(failure: RpcFailure) {
		super(EXIT.database, failure.message)
		this.name = 'RpcError'
		this.errorCode = failure.errorCode
	}
}

/** The socket died under an in-flight request — the app was there and then quit. */
export class ConnectionLostError extends CliError {
	constructor(message: string) {
		super(EXIT.notRunning, message, START_DOTAZ_HINT)
		this.name = 'ConnectionLostError'
	}
}

export interface CallOptions {
	/** Overrides the client-wide timeout for this one request. */
	timeoutMs?: number
	/** Aborts the in-flight request; the caller then unwinds normally so cleanup still runs. */
	signal?: AbortSignal
}

export interface HealthInfo {
	ok: boolean
	version: string
	pid: number
	protocol: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function knownErrorCode(value: unknown): DatabaseErrorCode | undefined {
	return typeof value === 'string' && value.length > 0 ? toErrorCode(value) : undefined
}

// The wire carries a plain string; narrow it without asserting.
const ERROR_CODES: readonly DatabaseErrorCode[] = [
	'CONNECTION_REFUSED',
	'CONNECTION_TIMEOUT',
	'HOST_NOT_FOUND',
	'CONNECTION_LIMIT',
	'SSL_ERROR',
	'AUTH_FAILED',
	'DATABASE_NOT_FOUND',
	'QUERY_SYNTAX',
	'QUERY_EXECUTION',
	'TABLE_NOT_FOUND',
	'COLUMN_NOT_FOUND',
	'CONSTRAINT_UNIQUE',
	'CONSTRAINT_FK',
	'CONSTRAINT_CHECK',
	'CONSTRAINT_NOT_NULL',
	'PERMISSION_DENIED',
	'SERIALIZATION_FAILURE',
	'DEADLOCK_DETECTED',
	'TRANSACTION_ABORTED',
	'COMMIT_UNCERTAIN',
	'STATEMENT_UNCERTAIN',
	'READ_ONLY_SESSION',
	'UNKNOWN',
]

function toErrorCode(value: string): DatabaseErrorCode | undefined {
	for (const code of ERROR_CODES) {
		if (code === value) return code
	}
	return undefined
}

export class DotazClient {
	private requestId = 0

	constructor(readonly endpoint: EndpointInfo, private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

	private url(path: string): string {
		if (this.endpoint.transport === 'tcp') return `http://127.0.0.1:${this.endpoint.port}${path}`
		// The host is ignored when `unix` is set, but fetch still needs a well-formed URL
		return `http://localhost${path}`
	}

	private init(base: RequestInit): RequestInit & { unix?: string } {
		if (this.endpoint.transport === 'unix' && this.endpoint.socket) {
			return { ...base, unix: this.endpoint.socket }
		}
		return base
	}

	private async send(path: string, init: RequestInit, timeoutMs: number, external?: AbortSignal): Promise<Response> {
		const timeout = AbortSignal.timeout(timeoutMs)
		const signal = external ? AbortSignal.any([timeout, external]) : timeout
		try {
			return await fetch(this.url(path), { ...this.init(init), signal })
		} catch (err) {
			// Check the caller's signal first — an interrupt and a timeout both surface as an abort
			if (external?.aborted) throw timeoutError('Interrupted while waiting for Dotaz')
			if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
				throw timeoutError(`Dotaz did not respond within ${timeoutMs}ms`)
			}
			throw new ConnectionLostError(`Cannot reach the Dotaz control endpoint (${messageOf(err)})`)
		}
	}

	async health(): Promise<HealthInfo> {
		const res = await this.send('/health', { method: 'GET' }, this.timeoutMs)
		if (!res.ok) throw notRunningError(`Health check failed with HTTP ${res.status}`)
		const body: unknown = await res.json()
		if (!isRecord(body)) throw notRunningError('Health check returned an unexpected payload')
		return {
			ok: body.ok === true,
			version: typeof body.version === 'string' ? body.version : 'unknown',
			pid: typeof body.pid === 'number' ? body.pid : this.endpoint.pid,
			protocol: typeof body.protocol === 'number' ? body.protocol : 0,
		}
	}

	/** Returns the raw payload — callers narrow it with the decoders in `decode.ts`. */
	async call(method: string, params: unknown = {}, opts: CallOptions = {}): Promise<unknown> {
		const id = ++this.requestId
		const res = await this.send(
			'/rpc',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-dotaz-token': this.endpoint.token },
				body: JSON.stringify({ id, method, params }),
			},
			opts.timeoutMs ?? this.timeoutMs,
			opts.signal,
		)

		if (res.status === 401) {
			throw new CliError(
				EXIT.notRunning,
				'Dotaz rejected the CLI token — the endpoint file is stale.',
				`Restart Dotaz, or toggle Settings → Allow CLI access off and on. ${START_DOTAZ_HINT}`,
			)
		}

		const text = await res.text()
		let body: unknown
		try {
			body = JSON.parse(text)
		} catch {
			throw new CliError(EXIT.database, `Dotaz returned a non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`)
		}

		if (!isRecord(body)) {
			throw new CliError(EXIT.database, `Dotaz returned an unexpected response envelope (HTTP ${res.status})`)
		}

		if (body.success === true) return body.payload

		const message = typeof body.error === 'string' ? body.error : `RPC ${method} failed (HTTP ${res.status})`
		const errorCode = knownErrorCode(body.errorCode)
		if (errorCode === 'READ_ONLY_SESSION') throw readOnlyError(message)
		throw new RpcError({ message, errorCode })
	}

	/**
	 * Ask the app to stop a running query. Best-effort by contract: the caller is already on an
	 * error path, and a failed cancel must never replace the error the user has to see.
	 */
	async cancelQuery(queryId: string): Promise<boolean> {
		try {
			await this.call('query.cancel', { queryId }, { timeoutMs: CANCEL_TIMEOUT_MS })
			return true
		} catch {
			return false
		}
	}
}

export interface QueryExecuteParams {
	connectionId: string
	database?: string
	sql: string
	params?: unknown[]
}

/**
 * Run `agent.query` under a queryId we own, so that giving up on the answer also stops the
 * work: on a timeout or a Ctrl-C the query is cancelled inside the app instead of running on
 * for nobody. The backend owns the read-only session and releases it when the handler settles.
 */
export async function executeQuery(client: DotazClient, params: QueryExecuteParams): Promise<unknown> {
	const queryId = randomUUID()
	const interrupt = new AbortController()
	const onInterrupt = () => {
		// Detach at once so a second Ctrl-C kills the process the usual way
		process.off('SIGINT', onInterrupt)
		interrupt.abort()
	}
	process.on('SIGINT', onInterrupt)

	try {
		return await client.call('agent.query', { ...params, queryId }, { signal: interrupt.signal })
	} catch (err) {
		// Both the timeout and the interrupt land on EXIT.timeout — nobody is waiting for the rows
		if (!(err instanceof CliError) || err.exitCode !== EXIT.timeout) throw err
		const cancelled = await client.cancelQuery(queryId)
		// Same error, same exit code — plus whether the query is actually stopped
		throw new CliError(
			err.exitCode,
			`${err.message} — ${cancelled ? 'the query was cancelled in Dotaz' : `could not cancel query ${queryId}, it may still be running in Dotaz`}`,
			err.hint,
		)
	} finally {
		process.off('SIGINT', onInterrupt)
	}
}
