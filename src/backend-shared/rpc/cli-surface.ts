// What the local CLI endpoint is allowed to reach (see docs/agent-cli.md).
//
// The control server must NOT expose the full handler map. That map is built for the app's
// own webview, which is already trusted with everything — it includes connection deletion,
// imports, settings writes and methods that hand back decrypted credentials. A local CLI
// client gets an explicit allowlist instead, and even allowed responses are stripped of
// secrets before they leave the process.

import type { ConnectionInfo } from '@dotaz/shared/types/connection'
import { stripSecrets } from '@dotaz/shared/types/connection'
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
	'session.list',
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
	'ui.runCommand',
])

function isConnectionInfoArray(value: unknown): value is ConnectionInfo[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'config' in item)
}

/** Connection listings carry decrypted passwords in-process — never let those reach a CLI client. */
function redact(method: string, payload: unknown): unknown {
	if (method !== 'connections.list' || !isConnectionInfoArray(payload)) return payload
	return payload.map((connection) => ({ ...connection, config: stripSecrets(connection.config) }))
}

/**
 * Wrap a handler map so only allowlisted methods resolve, and their results are redacted.
 * An unknown or forbidden method looks identical from outside — the caller learns nothing
 * about which handlers exist.
 */
export function createCliHandlerLookup(handlers: Record<string, RpcHandler>): RpcHandlerLookup {
	return (method) => {
		if (!CLI_ALLOWED_METHODS.has(method)) return undefined
		const handler = handlers[method]
		if (!handler) return undefined
		return async (params: unknown) => redact(method, await handler(params))
	}
}
