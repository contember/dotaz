// What the local CLI endpoint is allowed to reach (see docs/agent-cli.md).
//
// The control server must NOT expose the full handler map. That map is built for the app's
// own webview, which is already trusted with everything — it includes connection deletion,
// imports, settings writes and methods that hand back decrypted credentials. A local CLI
// client gets an explicit allowlist instead, and even allowed responses are stripped of
// secrets before they leave the process.

import type { ConnectionInfo } from '@dotaz/shared/types/connection'
import { stripSecrets } from '@dotaz/shared/types/connection'
import { DatabaseError } from '@dotaz/shared/types/errors'
import type { RpcHandler, RpcHandlerLookup } from './dispatch'

/**
 * Methods reachable over the CLI control endpoint.
 *
 * Deliberately absent: everything that mutates stored connections, imports or exports data,
 * writes settings, or decrypts secrets. `ui.snapshot.set` and `agent.proposals.resolve` are
 * absent too — those belong to the frontend, which reaches handlers directly.
 */
export const CLI_ALLOWED_METHODS: ReadonlySet<string> = new Set([
	// Discovery
	'connections.list',
	'connections.connect',
	'databases.list',
	'schema.load',
	// Read-only querying
	'session.create',
	'session.destroy',
	'query.execute',
	'query.cancel',
	'query.format',
	'search.searchDatabase',
	// Context the agent can read but not change
	'history.list',
	'bookmarks.list',
	'transaction.getLog',
	// Agent surface
	'agent.hello',
	'agent.proposeWrite',
	'agent.proposals.list',
	'agent.proposals.get',
	'agent.proposals.wait',
	'agent.proposals.cancel',
	'ui.state',
	'ui.openTable',
	'ui.openConsole',
])

function isConnectionInfoArray(value: unknown): value is ConnectionInfo[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'config' in item)
}

/** Connection listings carry decrypted passwords in-process — never let those reach a CLI client. */
function redact(method: string, payload: unknown): unknown {
	if (method !== 'connections.list' || !isConnectionInfoArray(payload)) return payload
	return payload.map((connection) => ({ ...connection, config: stripSecrets(connection.config) }))
}

/** Lets the gate ask the backend whether a session really is read-only. */
export interface CliSessionGuard {
	isSessionReadOnly(sessionId: string): boolean
}

function paramsOf(params: unknown): Record<string, unknown> {
	return typeof params === 'object' && params !== null ? params as Record<string, unknown> : {}
}

/**
 * Constrain the params of an allowlisted method.
 *
 * Filtering by method name is not enough: `query.execute` runs on the writable pool when no
 * sessionId is given, and `session.create` takes `readOnly` straight from the caller. Both are
 * allowlisted, so without this a CLI client could write without ever proposing anything.
 * The CLI client applies the same rules, but it is not what enforces them — anything holding
 * the token can talk to the socket directly.
 */
function guardParams(method: string, params: unknown, guard?: CliSessionGuard): unknown {
	const p = paramsOf(params)

	if (method === 'session.create') {
		if (p.readOnly !== undefined && p.readOnly !== true) {
			throw new DatabaseError('READ_ONLY_SESSION', 'CLI sessions are always read-only')
		}
		return { ...p, readOnly: true }
	}

	if (method === 'query.execute') {
		const sessionId = typeof p.sessionId === 'string' ? p.sessionId : undefined
		if (!sessionId) {
			throw new DatabaseError(
				'READ_ONLY_SESSION',
				'The CLI must run queries in a read-only session — create one with session.create. Submit writes with `dotaz propose`.',
			)
		}
		if (!guard?.isSessionReadOnly(sessionId)) {
			throw new DatabaseError(
				'READ_ONLY_SESSION',
				'This session is not read-only. Submit the statement with `dotaz propose` so it can be approved and run in the app.',
			)
		}
	}

	return params
}

/**
 * Wrap a handler map so only allowlisted methods resolve, their params are constrained, and
 * their results are redacted. An unknown or forbidden method looks identical from outside —
 * the caller learns nothing about which handlers exist.
 */
export function createCliHandlerLookup(
	handlers: Record<string, RpcHandler>,
	guard?: CliSessionGuard,
): RpcHandlerLookup {
	return (method) => {
		if (!CLI_ALLOWED_METHODS.has(method)) return undefined
		const handler = handlers[method]
		if (!handler) return undefined
		return async (params: unknown) => redact(method, await handler(guardParams(method, params, guard)))
	}
}
