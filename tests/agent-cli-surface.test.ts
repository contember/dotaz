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
		expect(lookup('query.execute')).toBeUndefined()
		expect(lookup('connections.delete')).toBeUndefined()
	})

	test('allowlisted methods pass params and results through', async () => {
		const lookup = createCliHandlerLookup({
			'query.execute': (params: { sql: string }) => ({ echoed: params.sql }),
		})
		const handler = lookup('query.execute')

		expect(handler).toBeDefined()
		expect(await handler!({ sql: 'SELECT 1' })).toEqual({ echoed: 'SELECT 1' })
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
