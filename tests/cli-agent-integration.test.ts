// Drives the real CLI client against a real control server over a real unix socket.
// Windows uses loopback TCP instead, and the desktop control server is not part of the
// web/CI matrix there — skip rather than fake it.

import { DatabaseError } from '@dotaz/shared/types/errors'
import type { Proposal } from '@dotaz/shared/types/rpc'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ControlServerHandle, startControlServer } from '../src/backend-desktop/control-server'
import { DotazClient } from '../src/cli-agent/client'
import { decodeAgentHello, decodeConnections } from '../src/cli-agent/decode'
import { discoverEndpoint } from '../src/cli-agent/endpoint'
import { CliError, EXIT } from '../src/cli-agent/errors'

const runOnUnixSocket = process.platform !== 'win32'
const MAIN = join(import.meta.dir, '../src/cli-agent/main.ts')

const sessions = { created: 0, destroyed: 0, lastSql: '', lastReadOnly: false }
const proposals = new Map<string, Proposal>()
const uiCalls: Record<string, unknown>[] = []

const handlers = {
	'agent.hello': () => ({ version: '9.9.9', mode: 'desktop', pid: process.pid, protocol: 1 }),
	'connections.list': () => [
		{
			id: 'c-test',
			name: 'testdb',
			config: { type: 'postgresql', host: 'localhost', port: 5432, database: 'app', user: 'u', password: 'super-secret' },
			state: 'connected',
			readOnly: false,
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z',
		},
	],
	'databases.list': () => [{ name: 'app', isDefault: true, isActive: true }],
	'schema.load': () => ({
		schemas: [{ name: 'public' }],
		tables: { public: [{ schema: 'public', name: 'orders', type: 'table' }] },
		columns: {
			'public.orders': [
				{ name: 'id', dataType: 'integer', nullable: false, defaultValue: null, isPrimaryKey: true, isAutoIncrement: true },
				{ name: 'note', dataType: 'text', nullable: true, defaultValue: null, isPrimaryKey: false, isAutoIncrement: false },
			],
		},
		indexes: {},
		foreignKeys: {},
		referencingForeignKeys: {},
	}),
	'session.create': (params: { readOnly?: boolean }) => {
		sessions.created++
		sessions.lastReadOnly = params?.readOnly === true
		return { sessionId: 's-1', connectionId: 'c-test', label: 'cli', inTransaction: false, txAborted: false, createdAt: 0, readOnly: true }
	},
	'session.destroy': () => {
		sessions.destroyed++
	},
	'query.execute': (params: { sql: string }) => {
		sessions.lastSql = params?.sql ?? ''
		if (!/^\s*(SELECT|EXPLAIN)/i.test(sessions.lastSql)) {
			throw new DatabaseError('READ_ONLY_SESSION', 'cannot execute UPDATE in a read-only transaction')
		}
		return [{
			columns: [{ name: 'id', dataType: 'integer' }, { name: 'note', dataType: 'text' }],
			rows: [{ id: 1, note: null }, { id: 2, note: 'NULL' }],
			rowCount: 2,
			durationMs: 3,
		}]
	},
	'agent.proposeWrite': ({ connectionId, sql, reason }: { connectionId: string; sql: string; reason?: string }) => {
		const id = `p-${proposals.size + 1}`
		proposals.set(id, { id, connectionId, sql, reason, status: 'pending', createdAt: Date.now() })
		return { proposalId: id }
	},
	'agent.proposals.get': ({ proposalId }: { proposalId: string }) => {
		const proposal = proposals.get(proposalId)
		if (!proposal) throw new Error(`Proposal not found: ${proposalId}`)
		return proposal
	},
	'agent.proposals.list': () => [...proposals.values()],
	'agent.proposals.wait': ({ proposalId }: { proposalId: string }) => proposals.get(proposalId),
	'agent.proposals.cancel': ({ proposalId }: { proposalId: string }) => {
		const proposal = proposals.get(proposalId)
		if (proposal) proposal.status = 'cancelled'
	},
	'ui.state': () => ({
		tabs: [{ id: 't1', type: 'data-grid', title: 'orders', connectionId: 'c-test', database: 'app', schema: 'public', table: 'orders' }],
		activeTabId: 't1',
		activeConnectionId: 'c-test',
		updatedAt: 0,
	}),
	'ui.openTable': (params: Record<string, unknown>) => {
		uiCalls.push({ kind: 'open-table', ...params })
		return { ok: true }
	},
	'ui.openConsole': (params: { sql?: string; run?: boolean }) => {
		// Mirrors the real handler: auto-running a write would bypass the approval flow
		if (params?.run && !/^\s*SELECT/i.test(params.sql ?? '')) {
			throw new DatabaseError('READ_ONLY_SESSION', 'Only read-only SQL can be auto-run — submit writes via agent.proposeWrite')
		}
		uiCalls.push({ kind: 'open-console', ...params })
		return { ok: true }
	},
	'ui.runCommand': (params: Record<string, unknown>) => {
		uiCalls.push({ kind: 'run-command', ...params })
		return { ok: true }
	},
	'history.list': () => [
		{
			id: 1,
			connectionId: 'c-test',
			database: 'app',
			sql: 'SELECT 1',
			status: 'success',
			durationMs: 2,
			rowCount: 1,
			executedAt: '2024-05-05T10:00:00Z',
		},
	],
	// Present in the handler map but absent from the CLI allowlist
	'settings.set': () => undefined,
}

describe.skipIf(!runOnUnixSocket)('cli-agent ↔ control server', () => {
	let server: ControlServerHandle
	let userDataDir: string

	beforeAll(async () => {
		userDataDir = mkdtempSync(join(tmpdir(), 'dotaz-cli-test-'))
		server = await startControlServer({ handlers, userDataDir, appVersion: '9.9.9' })
	})

	afterAll(async () => {
		await server?.stop()
		rmSync(userDataDir, { recursive: true, force: true })
	})

	function client(tokenOverride?: string): DotazClient {
		const found = discoverEndpoint({ explicitFile: server.endpointFile })
		const endpoint = tokenOverride === undefined ? found.endpoint : { ...found.endpoint, token: tokenOverride }
		return new DotazClient(endpoint, 5_000)
	}

	test('the endpoint file is discoverable and describes a unix socket', () => {
		const found = discoverEndpoint({ explicitFile: server.endpointFile })
		expect(found.endpoint.transport).toBe('unix')
		expect(found.endpoint.pid).toBe(process.pid)
		expect(found.endpoint.token).toBe(server.token)
	})

	test('health needs no token', async () => {
		const health = await client('nonsense').health()
		expect(health.ok).toBe(true)
		expect(health.version).toBe('9.9.9')
	})

	test('a successful call returns the decoded payload', async () => {
		const hello = decodeAgentHello(await client().call('agent.hello'))
		expect(hello).toEqual({ version: '9.9.9', mode: 'desktop', pid: process.pid, protocol: 1 })
	})

	test('connections come back without passwords', async () => {
		const payload = await client().call('connections.list')
		expect(JSON.stringify(payload)).not.toContain('super-secret')
		const connections = decodeConnections(payload)
		expect(connections).toHaveLength(1)
		expect(connections[0].name).toBe('testdb')
	})

	test('a read-only violation maps to exit 4 with the propose hint', async () => {
		try {
			await client().call('query.execute', { sql: 'UPDATE t SET a = 1' })
			expect.unreachable()
		} catch (err) {
			expect(err instanceof CliError).toBe(true)
			expect(err instanceof CliError && err.exitCode).toBe(EXIT.readOnly)
			expect(err instanceof CliError && err.hint).toContain('dotaz propose')
		}
	})

	test('a method outside the allowlist is simply unknown', async () => {
		try {
			await client().call('settings.set', { key: 'cli.enabled', value: 'false' })
			expect.unreachable()
		} catch (err) {
			expect(err instanceof CliError && err.exitCode).toBe(EXIT.database)
			expect(err instanceof Error && err.message).toContain('Unknown method')
		}
	})

	test('a bad token is rejected with exit 5', async () => {
		try {
			await client('b'.repeat(64)).call('agent.hello')
			expect.unreachable()
		} catch (err) {
			expect(err instanceof CliError && err.exitCode).toBe(EXIT.notRunning)
			expect(err instanceof Error && err.message).toContain('token')
		}
	})

	test('a socket that is not there is exit 5', async () => {
		const dead = new DotazClient(
			{ ...discoverEndpoint({ explicitFile: server.endpointFile }).endpoint, socket: join(userDataDir, 'gone.sock') },
			2_000,
		)
		try {
			await dead.call('agent.hello')
			expect.unreachable()
		} catch (err) {
			expect(err instanceof CliError && err.exitCode).toBe(EXIT.notRunning)
		}
	})

	test('`dotaz status --json` exits 0 and reports the app', async () => {
		const proc = Bun.spawn(['bun', MAIN, 'status', '--json', '--endpoint', server.endpointFile], { stdout: 'pipe', stderr: 'pipe' })
		const stdout = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(EXIT.ok)
		const parsed = JSON.parse(stdout)
		expect(parsed.status).toBe('running')
		expect(parsed.version).toBe('9.9.9')
		expect(parsed.connections).toBe(1)
	})

	test('`dotaz ls` renders the connection table', async () => {
		const proc = Bun.spawn(['bun', MAIN, 'ls', '--endpoint', server.endpointFile], { stdout: 'pipe', stderr: 'pipe' })
		const stdout = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(EXIT.ok)
		expect(stdout).toContain('testdb')
		expect(stdout).toContain('c-test')
	})

	test('a dead pid in the endpoint file exits 5', async () => {
		const dead = Bun.spawn(['bun', '-e', 'process.exit(0)'])
		await dead.exited
		const file = join(userDataDir, 'dead-endpoint.json')
		writeFileSync(
			file,
			JSON.stringify({ pid: dead.pid, transport: 'unix', socket: '/nonexistent.sock', port: null, token: 'x', version: '0', protocol: 1, startedAt: 1 }),
		)

		const proc = Bun.spawn(['bun', MAIN, 'status', '--endpoint', file], { stdout: 'pipe', stderr: 'pipe' })
		const stderr = await new Response(proc.stderr).text()
		expect(await proc.exited).toBe(EXIT.notRunning)
		expect(stderr).toContain('Allow CLI access')
	})

	test('a usage error exits 2 without touching the app', async () => {
		const proc = Bun.spawn(['bun', MAIN, 'rows', '--endpoint', server.endpointFile], { stdout: 'pipe', stderr: 'pipe' })
		expect(await proc.exited).toBe(EXIT.usage)
	})

	test('`dotaz rows` builds a quoted SELECT in a read-only session and cleans it up', async () => {
		const before = { ...sessions }
		const proc = Bun.spawn(['bun', MAIN, 'rows', 'testdb/app/public/orders', '--limit', '2', '--order', 'id:desc', '--endpoint', server.endpointFile], {
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const stdout = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(EXIT.ok)

		expect(sessions.lastReadOnly).toBe(true)
		expect(sessions.lastSql).toBe('SELECT * FROM "public"."orders" ORDER BY "id" DESC LIMIT $1 OFFSET $2')
		expect(sessions.created).toBe(before.created + 1)
		expect(sessions.destroyed).toBe(before.destroyed + 1)
		// SQL NULL and the string "NULL" must not look the same
		expect(stdout).toContain('NULL')
		expect(stdout).toContain('"NULL"')
	})

	test('`dotaz propose` without --wait exits 7 and prints the proposal id', async () => {
		const proc = Bun.spawn(
			['bun', MAIN, 'propose', 'testdb', "UPDATE orders SET note='x'", '--reason', 'test', '--json', '--endpoint', server.endpointFile],
			{ stdout: 'pipe', stderr: 'pipe' },
		)
		const stdout = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(EXIT.pending)
		const parsed = JSON.parse(stdout)
		expect(parsed.status).toBe('pending')
		expect(proposals.get(parsed.id)?.reason).toBe('test')
	})

	test('`dotaz approvals status` reports a rejected proposal with exit 8', async () => {
		proposals.set('p-rejected', {
			id: 'p-rejected',
			connectionId: 'c-test',
			sql: 'DELETE FROM orders',
			status: 'rejected',
			createdAt: Date.now(),
			resolvedAt: Date.now(),
		})
		const proc = Bun.spawn(['bun', MAIN, 'approvals', 'status', 'p-rejected', '--endpoint', server.endpointFile], { stdout: 'pipe', stderr: 'pipe' })
		const stderr = await new Response(proc.stderr).text()
		expect(await proc.exited).toBe(EXIT.rejected)
		expect(stderr).toContain('rejected by the user')
	})

	test('`dotaz approvals cancel` exits 0', async () => {
		proposals.set('p-cancel', { id: 'p-cancel', connectionId: 'c-test', sql: 'DELETE FROM orders', status: 'pending', createdAt: Date.now() })
		const proc = Bun.spawn(['bun', MAIN, 'approvals', 'cancel', 'p-cancel', '--endpoint', server.endpointFile], { stdout: 'pipe', stderr: 'pipe' })
		expect(await proc.exited).toBe(EXIT.ok)
		expect(proposals.get('p-cancel')?.status).toBe('cancelled')
	})

	test('`dotaz ui state` and `dotaz ui open` drive the app', async () => {
		const state = Bun.spawn(['bun', MAIN, 'ui', 'state', '--json', '--endpoint', server.endpointFile], { stdout: 'pipe', stderr: 'pipe' })
		const stdout = await new Response(state.stdout).text()
		expect(await state.exited).toBe(EXIT.ok)
		expect(JSON.parse(stdout).activeTabId).toBe('t1')

		const open = Bun.spawn(['bun', MAIN, 'ui', 'open', 'testdb/app/public/orders', '--endpoint', server.endpointFile], {
			stdout: 'pipe',
			stderr: 'pipe',
		})
		expect(await open.exited).toBe(EXIT.ok)
		expect(uiCalls.at(-1)).toMatchObject({ kind: 'open-table', connectionId: 'c-test', schema: 'public', table: 'orders' })
	})

	test('`dotaz ui console --run` refuses a write with exit 4', async () => {
		const proc = Bun.spawn(['bun', MAIN, 'ui', 'console', 'testdb', '--sql', 'DELETE FROM orders', '--run', '--endpoint', server.endpointFile], {
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const stderr = await new Response(proc.stderr).text()
		expect(await proc.exited).toBe(EXIT.readOnly)
		expect(stderr).toContain('dotaz propose')
	})

	test('`dotaz history` lists recent queries', async () => {
		const proc = Bun.spawn(['bun', MAIN, 'history', '--json', '--endpoint', server.endpointFile], { stdout: 'pipe', stderr: 'pipe' })
		const stdout = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(EXIT.ok)
		expect(JSON.parse(stdout).rows[0].sql).toBe('SELECT 1')
	})

	test('`dotaz describe` renders the schema sections', async () => {
		const proc = Bun.spawn(['bun', MAIN, 'describe', 'testdb/app/public/orders', '--endpoint', server.endpointFile], { stdout: 'pipe', stderr: 'pipe' })
		const stdout = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(EXIT.ok)
		expect(stdout).toContain('Columns')
		expect(stdout).toContain('Referenced by')
	})

	test('`dotaz query` with a write exits 4 and still destroys the session', async () => {
		const before = { ...sessions }
		const proc = Bun.spawn(['bun', MAIN, 'query', 'testdb', 'UPDATE orders SET note = 1', '--endpoint', server.endpointFile], {
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const stderr = await new Response(proc.stderr).text()
		expect(await proc.exited).toBe(EXIT.readOnly)
		expect(stderr).toContain('dotaz propose')
		expect(sessions.destroyed).toBe(before.destroyed + 1)
	})
})
