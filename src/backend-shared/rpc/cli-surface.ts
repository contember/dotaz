// What the local CLI endpoint is allowed to reach (see docs/agent-cli.md).
//
// The control server must NOT expose the full handler map. That map is built for the app's
// own webview, which is already trusted with everything — it includes connection deletion,
// imports, settings writes and methods that hand back decrypted credentials. A local CLI
// client gets an explicit allowlist instead, and even allowed responses are stripped of
// secrets before they leave the process.

import type { ConnectionInfo } from '@dotaz/shared/types/connection'
import { stripSecrets } from '@dotaz/shared/types/connection'
import type { ProposalStatus, SearchScope, TransactionLogStatus } from '@dotaz/shared/types/rpc'
import type { RpcHandler, RpcHandlerLookup } from './dispatch'
import type { createHandlers } from './handlers'

type Handlers = ReturnType<typeof createHandlers>

/** What a handler takes — `undefined` for one that takes nothing. */
type ParamsOf<M extends keyof Handlers> = Parameters<Handlers[M]> extends [] ? undefined : Parameters<Handlers[M]>[0]

type Fields = Record<string, unknown>

/** Rejects malformed CLI input before it reaches a handler. */
export class CliParamsError extends Error {}

function fields(raw: unknown, method: string): Fields {
	if (raw === undefined || raw === null) return {}
	if (typeof raw !== 'object' || Array.isArray(raw)) throw new CliParamsError(`${method}: params must be an object`)
	return Object.fromEntries(Object.entries(raw))
}

function requiredString(f: Fields, key: string, method: string): string {
	const value = f[key]
	if (typeof value !== 'string' || value === '') throw new CliParamsError(`${method}: ${key} must be a non-empty string`)
	return value
}

function optionalString(f: Fields, key: string, method: string): string | undefined {
	const value = f[key]
	if (value === undefined || value === null) return undefined
	if (typeof value !== 'string') throw new CliParamsError(`${method}: ${key} must be a string`)
	return value
}

function optionalNumber(f: Fields, key: string, method: string): number | undefined {
	const value = f[key]
	if (value === undefined || value === null) return undefined
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new CliParamsError(`${method}: ${key} must be a finite number`)
	return value
}

function optionalOneOf<T extends string>(f: Fields, key: string, allowed: readonly T[], method: string): T | undefined {
	const value = optionalString(f, key, method)
	if (value === undefined) return undefined
	const match = allowed.find((candidate) => candidate === value)
	if (match === undefined) throw new CliParamsError(`${method}: ${key} must be one of ${allowed.join(', ')}`)
	return match
}

function optionalStringArray(f: Fields, key: string, method: string): string[] | undefined {
	const value = f[key]
	if (value === undefined || value === null) return undefined
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
		throw new CliParamsError(`${method}: ${key} must be an array of strings`)
	}
	return value
}

/** Bound query parameters are JSON scalars — nothing a driver would interpret as an object. */
function optionalScalarArray(f: Fields, key: string, method: string): Array<string | number | boolean | null> | undefined {
	const value = f[key]
	if (value === undefined) return undefined
	if (!Array.isArray(value)) throw new CliParamsError(`${method}: ${key} must be an array`)
	return value.map((item) => {
		if (item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) {
			return item
		}
		throw new CliParamsError(`${method}: ${key} may only hold strings, numbers, booleans and null`)
	})
}

const PROPOSAL_STATUSES: readonly ProposalStatus[] = ['pending', 'approved', 'rejected', 'executed', 'failed', 'cancelled', 'expired']
const SEARCH_SCOPES: readonly SearchScope[] = ['database', 'schema', 'tables']
const TRANSACTION_LOG_STATUSES: readonly TransactionLogStatus[] = ['success', 'error']

/**
 * Methods reachable over the CLI control endpoint, each with the parser for its params. Input is
 * parsed here, where it enters, into exactly the shape the handler takes — unknown fields are
 * dropped, so e.g. `connections.connect` never sees a client-supplied config or password.
 *
 * Deliberately absent: everything that mutates stored connections, imports or exports data,
 * writes settings, or decrypts secrets. `ui.snapshot.set` and `agent.proposals.resolve` are
 * absent too — those belong to the frontend, which reaches handlers directly.
 */
const CLI_METHODS: { [M in keyof Handlers]?: (raw: unknown) => ParamsOf<M> } = {
	// Discovery
	'connections.list': () => undefined,
	'connections.connect': (raw) => {
		const f = fields(raw, 'connections.connect')
		return { connectionId: requiredString(f, 'connectionId', 'connections.connect') }
	},
	'databases.list': (raw) => {
		const f = fields(raw, 'databases.list')
		return { connectionId: requiredString(f, 'connectionId', 'databases.list') }
	},
	// Read-only querying
	'agent.schema': (raw) => {
		const f = fields(raw, 'agent.schema')
		return { connectionId: requiredString(f, 'connectionId', 'agent.schema'), database: optionalString(f, 'database', 'agent.schema') }
	},
	'agent.query': (raw) => {
		const m = 'agent.query'
		const f = fields(raw, m)
		return {
			connectionId: requiredString(f, 'connectionId', m),
			database: optionalString(f, 'database', m),
			sql: requiredString(f, 'sql', m),
			queryId: requiredString(f, 'queryId', m),
			params: optionalScalarArray(f, 'params', m),
			searchPath: optionalString(f, 'searchPath', m),
		}
	},
	'agent.search': (raw) => {
		const m = 'agent.search'
		const f = fields(raw, m)
		const scope = optionalOneOf(f, 'scope', SEARCH_SCOPES, m)
		if (scope === undefined) throw new CliParamsError(`${m}: scope is required`)
		return {
			connectionId: requiredString(f, 'connectionId', m),
			database: optionalString(f, 'database', m),
			searchTerm: requiredString(f, 'searchTerm', m),
			scope,
			schemaName: optionalString(f, 'schemaName', m),
			tableNames: optionalStringArray(f, 'tableNames', m),
			resultsPerTable: optionalNumber(f, 'resultsPerTable', m),
		}
	},
	'query.cancel': (raw) => {
		const f = fields(raw, 'query.cancel')
		return { queryId: requiredString(f, 'queryId', 'query.cancel') }
	},
	'query.format': (raw) => {
		const f = fields(raw, 'query.format')
		return { sql: requiredString(f, 'sql', 'query.format') }
	},
	// Context the agent can read but not change
	'history.list': (raw) => {
		const m = 'history.list'
		const f = fields(raw, m)
		return {
			connectionId: optionalString(f, 'connectionId', m),
			limit: optionalNumber(f, 'limit', m),
			offset: optionalNumber(f, 'offset', m),
			search: optionalString(f, 'search', m),
			startDate: optionalString(f, 'startDate', m),
			endDate: optionalString(f, 'endDate', m),
		}
	},
	'bookmarks.list': (raw) => {
		const f = fields(raw, 'bookmarks.list')
		return { connectionId: requiredString(f, 'connectionId', 'bookmarks.list'), search: optionalString(f, 'search', 'bookmarks.list') }
	},
	'transaction.getLog': (raw) => {
		const m = 'transaction.getLog'
		const f = fields(raw, m)
		return {
			connectionId: requiredString(f, 'connectionId', m),
			database: optionalString(f, 'database', m),
			sessionId: optionalString(f, 'sessionId', m),
			statusFilter: optionalOneOf(f, 'statusFilter', TRANSACTION_LOG_STATUSES, m),
			search: optionalString(f, 'search', m),
		}
	},
	// Agent surface
	'agent.hello': () => undefined,
	'agent.proposeWrite': (raw) => {
		const m = 'agent.proposeWrite'
		const f = fields(raw, m)
		return {
			connectionId: requiredString(f, 'connectionId', m),
			database: optionalString(f, 'database', m),
			sql: requiredString(f, 'sql', m),
			reason: optionalString(f, 'reason', m),
		}
	},
	'agent.proposals.list': (raw) => {
		const m = 'agent.proposals.list'
		const f = fields(raw, m)
		return { status: optionalOneOf(f, 'status', PROPOSAL_STATUSES, m), connectionId: optionalString(f, 'connectionId', m) }
	},
	'agent.proposals.get': (raw) => {
		const f = fields(raw, 'agent.proposals.get')
		return { proposalId: requiredString(f, 'proposalId', 'agent.proposals.get') }
	},
	'agent.proposals.wait': (raw) => {
		const m = 'agent.proposals.wait'
		const f = fields(raw, m)
		return { proposalId: requiredString(f, 'proposalId', m), timeoutMs: optionalNumber(f, 'timeoutMs', m) }
	},
	'agent.proposals.cancel': (raw) => {
		const f = fields(raw, 'agent.proposals.cancel')
		return { proposalId: requiredString(f, 'proposalId', 'agent.proposals.cancel') }
	},
	'ui.state': () => undefined,
	'ui.openTable': (raw) => {
		const m = 'ui.openTable'
		const f = fields(raw, m)
		return {
			connectionId: requiredString(f, 'connectionId', m),
			database: optionalString(f, 'database', m),
			schema: optionalString(f, 'schema', m),
			table: requiredString(f, 'table', m),
			where: optionalString(f, 'where', m),
			limit: optionalNumber(f, 'limit', m),
		}
	},
	'ui.openConsole': (raw) => {
		const m = 'ui.openConsole'
		const f = fields(raw, m)
		return { connectionId: requiredString(f, 'connectionId', m), database: optionalString(f, 'database', m), sql: optionalString(f, 'sql', m) }
	},
}

const PARSERS: ReadonlyMap<string, (raw: unknown) => unknown> = new Map(Object.entries(CLI_METHODS))

export const CLI_ALLOWED_METHODS: ReadonlySet<string> = new Set(PARSERS.keys())

function isConnectionInfoArray(value: unknown): value is ConnectionInfo[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'config' in item)
}

/**
 * Connection listings carry decrypted passwords in-process — never let those reach a CLI client.
 * `initSql` goes too: it is free-form session setup that may embed credentials, and the CLI never needs it.
 */
function redact(method: string, payload: unknown): unknown {
	if (method !== 'connections.list' || !isConnectionInfoArray(payload)) return payload
	return payload.map((connection) => ({ ...connection, config: { ...stripSecrets(connection.config), initSql: undefined } }))
}

/**
 * Wrap a handler map so only allowlisted methods resolve and their results are redacted.
 * An unknown or forbidden method looks identical from outside, so the caller learns nothing
 * about which handlers exist.
 */
export function createCliHandlerLookup(handlers: Record<string, RpcHandler>): RpcHandlerLookup {
	return (method) => {
		const parse = PARSERS.get(method)
		if (!parse) return undefined
		const handler = handlers[method]
		if (!handler) return undefined
		return async (params: unknown) => redact(method, await handler(parse(params)))
	}
}
