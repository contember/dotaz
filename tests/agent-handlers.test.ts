import { createHandlers } from '@dotaz/backend-shared/rpc/rpc-handlers'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { SqliteConnectionConfig } from '@dotaz/shared/types/connection'
import type { UiSnapshot } from '@dotaz/shared/types/rpc'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const sqliteConfig: SqliteConnectionConfig = { type: 'sqlite', path: ':memory:' }

interface Emitted {
	channel: string
	payload: unknown
}

function setup() {
	AppDatabase.resetInstance()
	const appDb = AppDatabase.getInstance(':memory:')
	const cm = new ConnectionManager(appDb)
	const emitted: Emitted[] = []
	const { handlers, adapter } = createHandlers(cm, undefined, appDb, undefined, {
		emitMessage: (channel, payload) => emitted.push({ channel, payload }),
		appVersion: '1.2.3',
		mode: 'desktop',
	})
	const connection = handlers['connections.create']({ name: 'Test SQLite', config: sqliteConfig })
	return { adapter, appDb, cm, connectionId: connection.id, emitted, handlers }
}

function payloadsOn(emitted: Emitted[], channel: string): unknown[] {
	return emitted.filter((m) => m.channel === channel).map((m) => m.payload)
}

describe('Agent CLI handlers', () => {
	let ctx: ReturnType<typeof setup>

	beforeEach(() => {
		ctx = setup()
	})

	afterEach(async () => {
		ctx.adapter.dispose()
		await ctx.cm.disconnectAll()
		AppDatabase.resetInstance()
	})

	// ── agent.hello ──────────────────────────────────────

	test('agent.hello reports version, mode, pid and protocol', () => {
		const hello = ctx.handlers['agent.hello']()

		expect(hello).toEqual({ version: '1.2.3', mode: 'desktop', pid: process.pid, protocol: 1 })
	})

	test('agent.hello falls back to 0.0.0/web when the entry point supplied nothing', () => {
		AppDatabase.resetInstance()
		const appDb = AppDatabase.getInstance(':memory:')
		const cm = new ConnectionManager(appDb)
		const { handlers } = createHandlers(cm, undefined, appDb)

		const hello = handlers['agent.hello']()

		expect(hello.version).toBe('0.0.0')
		expect(hello.mode).toBe('web')
	})

	// ── agent.proposeWrite ───────────────────────────────

	test('agent.proposeWrite emits cli.proposal and stores a pending proposal', () => {
		const { proposalId } = ctx.handlers['agent.proposeWrite']({
			connectionId: ctx.connectionId,
			sql: '  DELETE FROM users WHERE id = 1  ',
			reason: 'cleanup',
		})

		const emitted = payloadsOn(ctx.emitted, 'cli.proposal')
		expect(emitted).toHaveLength(1)
		expect(emitted[0]).toMatchObject({
			id: proposalId,
			status: 'pending',
			connectionId: ctx.connectionId,
			sql: 'DELETE FROM users WHERE id = 1',
			reason: 'cleanup',
		})

		const stored = ctx.handlers['agent.proposals.get']({ proposalId })
		expect(stored.id).toBe(proposalId)
		expect(stored.connectionId).toBe(ctx.connectionId)
		expect(stored.status).toBe('pending')
	})

	test('agent.proposeWrite rejects an empty sql', () => {
		expect(() => ctx.handlers['agent.proposeWrite']({ connectionId: ctx.connectionId, sql: '   ' })).toThrow(/sql is required/)
		expect(ctx.emitted).toHaveLength(0)
	})

	test('agent.proposeWrite rejects an unknown connectionId', () => {
		expect(() => ctx.handlers['agent.proposeWrite']({ connectionId: 'missing', sql: 'DELETE FROM users' })).toThrow(/Unknown connection/)
		expect(() => ctx.handlers['agent.proposeWrite']({ connectionId: '', sql: 'DELETE FROM users' })).toThrow(/connectionId is required/)
	})

	// ── agent.proposals.* ────────────────────────────────

	test('agent.proposals.list filters by status and connectionId', () => {
		const other = ctx.handlers['connections.create']({ name: 'Other', config: sqliteConfig })
		const first = ctx.handlers['agent.proposeWrite']({ connectionId: ctx.connectionId, sql: 'DELETE FROM a' })
		ctx.handlers['agent.proposeWrite']({ connectionId: other.id, sql: 'DELETE FROM b' })
		ctx.handlers['agent.proposals.resolve']({ proposalId: first.proposalId, status: 'executed', result: { affectedRows: 2 } })

		expect(ctx.handlers['agent.proposals.list']()).toHaveLength(2)
		expect(ctx.handlers['agent.proposals.list']({ status: 'pending' })).toHaveLength(1)
		expect(ctx.handlers['agent.proposals.list']({ status: 'executed' })[0].id).toBe(first.proposalId)
		expect(ctx.handlers['agent.proposals.list']({ connectionId: other.id })).toHaveLength(1)
	})

	test('agent.proposals.get throws for an unknown id', () => {
		expect(() => ctx.handlers['agent.proposals.get']({ proposalId: 'nope' })).toThrow(/not found/)
	})

	test('agent.proposals.resolve records the outcome and refuses a second resolve', () => {
		const { proposalId } = ctx.handlers['agent.proposeWrite']({ connectionId: ctx.connectionId, sql: 'DELETE FROM a' })

		const resolved = ctx.handlers['agent.proposals.resolve']({ proposalId, status: 'failed', error: 'boom' })
		expect(resolved.status).toBe('failed')
		expect(resolved.error).toBe('boom')

		expect(() => ctx.handlers['agent.proposals.resolve']({ proposalId, status: 'executed' })).toThrow(/already failed/)
	})

	test('agent.proposals.resolve refuses an illegal target status', () => {
		const { proposalId } = ctx.handlers['agent.proposeWrite']({ connectionId: ctx.connectionId, sql: 'DELETE FROM a' })

		expect(() => ctx.handlers['agent.proposals.resolve']({ proposalId, status: 'pending' })).toThrow(/Cannot resolve/)
		expect(ctx.handlers['agent.proposals.get']({ proposalId }).status).toBe('pending')
	})

	test('agent.proposals.cancel moves the proposal to cancelled', () => {
		const { proposalId } = ctx.handlers['agent.proposeWrite']({ connectionId: ctx.connectionId, sql: 'DELETE FROM a' })

		ctx.handlers['agent.proposals.cancel']({ proposalId })

		expect(ctx.handlers['agent.proposals.get']({ proposalId }).status).toBe('cancelled')
	})

	test('agent.proposals.wait resolves once the frontend resolves the proposal', async () => {
		const { proposalId } = ctx.handlers['agent.proposeWrite']({ connectionId: ctx.connectionId, sql: 'DELETE FROM a' })

		const waiting = ctx.handlers['agent.proposals.wait']({ proposalId, timeoutMs: 5_000 })
		ctx.handlers['agent.proposals.resolve']({ proposalId, status: 'executed', result: { statements: 1 } })

		const result = await waiting
		expect(result.status).toBe('executed')
		expect(result.result).toEqual({ statements: 1 })
	})

	test('agent.proposals.wait returns the pending proposal on timeout', async () => {
		const { proposalId } = ctx.handlers['agent.proposeWrite']({ connectionId: ctx.connectionId, sql: 'DELETE FROM a' })

		expect((await ctx.handlers['agent.proposals.wait']({ proposalId, timeoutMs: 20 })).status).toBe('pending')
	})

	test('agent.proposals.wait rejects a negative timeout', async () => {
		const { proposalId } = ctx.handlers['agent.proposeWrite']({ connectionId: ctx.connectionId, sql: 'DELETE FROM a' })

		await expect(ctx.handlers['agent.proposals.wait']({ proposalId, timeoutMs: -1 })).rejects.toThrow(/non-negative/)
	})

	// ── ui.* ─────────────────────────────────────────────

	test('ui.openConsole emits cli.command', () => {
		const result = ctx.handlers['ui.openConsole']({ connectionId: ctx.connectionId, sql: 'SELECT 1', run: true })

		expect(result).toEqual({ ok: true })
		const commands = payloadsOn(ctx.emitted, 'cli.command')
		expect(commands).toHaveLength(1)
		expect(commands[0]).toMatchObject({ kind: 'open-console', connectionId: ctx.connectionId, sql: 'SELECT 1', run: true })
	})

	test('ui.openConsole rejects run without sql and unknown connections', () => {
		expect(() => ctx.handlers['ui.openConsole']({ connectionId: ctx.connectionId, run: true })).toThrow(/run requires sql/)
		expect(() => ctx.handlers['ui.openConsole']({ connectionId: 'missing' })).toThrow(/Unknown connection/)
		expect(ctx.emitted).toHaveLength(0)
	})

	test('ui.openTable emits cli.command with the table coordinates', () => {
		ctx.handlers['ui.openTable']({ connectionId: ctx.connectionId, schema: 'public', table: 'users', where: 'id > 1', limit: 10 })

		expect(payloadsOn(ctx.emitted, 'cli.command')[0]).toMatchObject({
			kind: 'open-table',
			connectionId: ctx.connectionId,
			schema: 'public',
			table: 'users',
			where: 'id > 1',
			limit: 10,
		})
	})

	test('ui.openTable defaults the schema — SQLite paths omit it', () => {
		ctx.handlers['ui.openTable']({ connectionId: ctx.connectionId, table: 'users' })

		expect(payloadsOn(ctx.emitted, 'cli.command')[0]).toMatchObject({ kind: 'open-table', schema: '', table: 'users' })
	})

	test('ui.openTable validates table and limit', () => {
		expect(() => ctx.handlers['ui.openTable']({ connectionId: ctx.connectionId, table: ' ' })).toThrow(/table is required/)
		expect(() => ctx.handlers['ui.openTable']({ connectionId: ctx.connectionId, table: 'users', limit: 0 })).toThrow(/positive integer/)
		expect(ctx.emitted).toHaveLength(0)
	})

	test('ui.runCommand emits cli.command and rejects an empty id', () => {
		ctx.handlers['ui.runCommand']({ commandId: 'query.run' })

		expect(payloadsOn(ctx.emitted, 'cli.command')[0]).toMatchObject({ kind: 'run-command', commandId: 'query.run' })
		expect(() => ctx.handlers['ui.runCommand']({ commandId: '' })).toThrow(/commandId is required/)
	})

	test('ui.state returns an empty snapshot until the frontend publishes one', () => {
		expect(ctx.handlers['ui.state']()).toEqual({ tabs: [], activeTabId: null, activeConnectionId: null, updatedAt: 0 })
	})

	test('ui.state round-trips a snapshot set via ui.snapshot.set', () => {
		const snapshot: UiSnapshot = {
			tabs: [{ id: 'tab-1', type: 'sql', title: 'Console', connectionId: ctx.connectionId, sql: 'SELECT 1' }],
			activeTabId: 'tab-1',
			activeConnectionId: ctx.connectionId,
			updatedAt: 1_700_000_000_000,
		}

		ctx.handlers['ui.snapshot.set']({ snapshot })

		expect(ctx.handlers['ui.state']()).toEqual(snapshot)
	})
})
