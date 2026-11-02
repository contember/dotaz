import { CLI_ALLOWED_METHODS, createCliHandlerLookup } from '@dotaz/backend-shared/rpc/cli-surface'
import type { RpcHandler } from '@dotaz/backend-shared/rpc/dispatch'
import type { ConnectionInfo } from '@dotaz/shared/types/connection'
import { describe, expect, test } from 'bun:test'

function connection(overrides?: Partial<ConnectionInfo>): ConnectionInfo {
	return {
		id: 'c1',
		name: 'prod',
		config: {
			type: 'postgresql',
			host: 'db.example.com',
			port: 5432,
			database: 'app',
			user: 'app',
			password: 'hunter2',
			sshTunnel: {
				enabled: true,
				host: 'bastion.example.com',
				port: 22,
				username: 'deploy',
				authMethod: 'password',
				password: 'bastion-secret',
			},
		},
		state: 'disconnected',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	}
}

describe('CLI surface', () => {
	test('forbidden methods are not reachable', () => {
		const handlers: Record<string, RpcHandler> = {
			'connections.delete': () => 'deleted',
			'storage.decryptConfig': () => 'secret',
			'settings.set': () => undefined,
			'import.importData': () => undefined,
		}
		const lookup = createCliHandlerLookup(handlers)

		for (const method of Object.keys(handlers)) {
			expect(lookup(method)).toBeUndefined()
		}
	})

	test('an allowlisted method that does not exist looks the same as a forbidden one', () => {
		const lookup = createCliHandlerLookup({})
		expect(lookup('agent.query')).toBeUndefined()
		expect(lookup('connections.delete')).toBeUndefined()
	})

	test('allowlisted methods pass params and results through', async () => {
		const lookup = createCliHandlerLookup({ 'agent.query': (params: { sql: string }) => ({ echoed: params.sql }) })
		const handler = lookup('agent.query')

		expect(handler).toBeDefined()
		expect(await handler!({ connectionId: 'c1', sql: 'SELECT 1', queryId: 'q1' })).toEqual({ echoed: 'SELECT 1' })
	})

	test('params are parsed at the boundary — malformed input never reaches the handler', async () => {
		const seen: unknown[] = []
		const lookup = createCliHandlerLookup({
			'agent.query': (params: unknown) => seen.push(params),
			'agent.search': (params: unknown) => seen.push(params),
			'agent.proposals.wait': (params: unknown) => seen.push(params),
		})

		await expect(lookup('agent.query')!({ connectionId: 'c1', sql: 42, queryId: 'q1' })).rejects.toThrow(/sql must be a non-empty string/)
		await expect(lookup('agent.query')!({ connectionId: 'c1', sql: 'SELECT $1', queryId: 'q1', params: [{ $ne: 1 }] })).rejects.toThrow(
			/params may only hold/,
		)
		await expect(lookup('agent.search')!({ connectionId: 'c1', searchTerm: 'x', scope: 'everything' })).rejects.toThrow(/scope must be one of/)
		await expect(lookup('agent.proposals.wait')!({ proposalId: 'p1', timeoutMs: '5' })).rejects.toThrow(/timeoutMs must be a finite number/)
		await expect(lookup('agent.query')!('SELECT 1')).rejects.toThrow(/params must be an object/)
		expect(seen).toHaveLength(0)
	})

	test('unknown fields are dropped — connections.connect never sees a client-supplied config', async () => {
		const seen: unknown[] = []
		const lookup = createCliHandlerLookup({ 'connections.connect': (params: unknown) => seen.push(params) })

		await lookup('connections.connect')!({ connectionId: 'c1', password: 'x', config: { type: 'sqlite', path: '/etc/passwd' }, encryptedConfig: 'e' })
		expect(seen).toEqual([{ connectionId: 'c1' }])
	})

	test('session ids and generic data methods never cross the CLI boundary', () => {
		for (const method of ['session.create', 'session.destroy', 'session.list', 'query.execute', 'schema.load', 'search.searchDatabase']) {
			expect(CLI_ALLOWED_METHODS.has(method)).toBe(false)
		}
		for (const method of ['agent.query', 'agent.schema', 'agent.search']) {
			expect(CLI_ALLOWED_METHODS.has(method)).toBe(true)
		}
	})

	test('ui.runCommand is unreachable — it could run any registered command in a writable session', () => {
		expect(CLI_ALLOWED_METHODS.has('ui.runCommand')).toBe(false)
	})

	test('connections.list never leaks a password', async () => {
		const lookup = createCliHandlerLookup({ 'connections.list': () => [connection()] })
		const result = await lookup('connections.list')!({})

		expect(Array.isArray(result)).toBe(true)
		const [listed] = Array.isArray(result) ? result : []
		expect(listed).toMatchObject({ config: { type: 'postgresql', host: 'db.example.com', password: '' } })
		expect(JSON.stringify(result)).not.toContain('hunter2')
		expect(JSON.stringify(result)).not.toContain('bastion-secret')
	})

	test('connections.list never leaks initSql, which may embed credentials', async () => {
		const withInit = connection({
			config: { type: 'postgresql', host: 'h', port: 5432, database: 'app', user: 'app', password: '', initSql: "SET app.token = 's3cret'" },
		})
		const lookup = createCliHandlerLookup({ 'connections.list': () => [withInit] })

		expect(JSON.stringify(await lookup('connections.list')!({}))).not.toContain('s3cret')
	})

	test('the write surface stays off the allowlist', () => {
		for (
			const method of [
				'connections.create',
				'connections.update',
				'connections.delete',
				'settings.set',
				'import.importData',
				'export.exportData',
				'storage.decryptConfig',
				'storage.encryptSecrets',
				'ui.snapshot.set',
				'agent.proposals.resolve',
			]
		) {
			expect(CLI_ALLOWED_METHODS.has(method)).toBe(false)
		}
	})
})
