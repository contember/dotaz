import { createHandlers } from '@dotaz/backend-shared/rpc/rpc-handlers'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { AppDatabase } from '@dotaz/backend-shared/storage/app-db'
import type { SqliteConnectionConfig } from '@dotaz/shared/types/connection'
import type { UiSnapshot } from '@dotaz/shared/types/rpc'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sqliteConfig: SqliteConnectionConfig = { type: 'sqlite', path: ':memory:' }

interface Emitted {
	channel: string
	payload: unknown
}

function setup() {
	AppDatabase.resetInstance()
	const appDb = AppDatabase.getInstance(':memory:')
	const cm = new ConnectionManager(appDb)
	const tempDir = mkdtempSync(join(tmpdir(), 'dotaz-agent-handlers-'))
	const emitted: Emitted[] = []
	const { handlers, adapter, sessionManager } = createHandlers(cm, undefined, appDb, undefined, {
		emitMessage: (channel, payload) => emitted.push({ channel, payload }),
		appVersion: '1.2.3',
		mode: 'desktop',
	})
	const connection = handlers['connections.create']({ name: 'Test SQLite', config: { type: 'sqlite', path: join(tempDir, 'test.db') } })
	return { adapter, appDb, cm, connectionId: connection.id, emitted, handlers, sessionManager, tempDir }
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
		rmSync(ctx.tempDir, { recursive: true, force: true })
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

	// ── backend-owned read sessions ─────────────────────

	test('agent data methods own and release their read-only sessions', async () => {
		await ctx.handlers['connections.connect']({ connectionId: ctx.connectionId })
		await ctx.handlers['query.execute']({
			connectionId: ctx.connectionId,
			queryId: 'seed-schema',
			sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
		})
		await ctx.handlers['query.execute']({
			connectionId: ctx.connectionId,
			queryId: 'seed-row',
			sql: "INSERT INTO items (name) VALUES ('Widget')",
		})

		const schema = await ctx.handlers['agent.schema']({ connectionId: ctx.connectionId })
		expect(Object.values(schema.tables).flat().some((table) => table.name === 'items')).toBe(true)
		expect(ctx.sessionManager.listSessions(ctx.connectionId)).toEqual([])

		const results = await ctx.handlers['agent.query']({
			connectionId: ctx.connectionId,
			queryId: 'agent-read',
			sql: 'SELECT name FROM items',
		})
		expect(results[0].rows).toEqual([{ name: 'Widget' }])
		expect(ctx.sessionManager.listSessions(ctx.connectionId)).toEqual([])

		const search = await ctx.handlers['agent.search']({
			connectionId: ctx.connectionId,
			searchTerm: 'Widget',
			scope: 'database',
			resultsPerTable: 10,
		})
		expect(search.totalMatches).toBe(1)
		expect(ctx.sessionManager.listSessions(ctx.connectionId)).toEqual([])

		await expect(ctx.handlers['agent.query']({
			connectionId: ctx.connectionId,
			queryId: 'agent-write',
			sql: "UPDATE items SET name = 'Changed'",
		})).rejects.toThrow(/read-only/)
		expect(ctx.sessionManager.listSessions(ctx.connectionId)).toEqual([])
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

	// This guard is the whole of invariant I1 on the auto-run path — the frontend does not
	// re-check. Every case here reached the database before the review that added them.
	test.each([
		['a plain write', 'DELETE FROM orders'],
		['a data-modifying CTE', "WITH x AS (INSERT INTO users(name) VALUES ('p') RETURNING id) SELECT * FROM x"],
		['a deleting CTE', 'WITH x AS (DELETE FROM orders RETURNING id) SELECT * FROM x'],
		['SELECT … INTO', 'SELECT * INTO stolen FROM users'],
		['INTO OUTFILE', "SELECT * FROM users INTO OUTFILE '/tmp/users'"],
		['a GUC rewrite', "SELECT set_config('default_transaction_read_only','off',false)"],
		['a pragma with an argument', 'PRAGMA query_only(0)'],
		['a trailing statement', 'SELECT 1; DELETE FROM orders'],
	])('ui.openConsole refuses to auto-run %s', (_label, sql) => {
		expect(() => ctx.handlers['ui.openConsole']({ connectionId: ctx.connectionId, sql, run: true }))
			.toThrow(/Only read-only SQL can be auto-run/)
		expect(ctx.emitted).toHaveLength(0)
	})

	test('ui.openConsole still prefills a write when it is not asked to run it', () => {
		ctx.handlers['ui.openConsole']({ connectionId: ctx.connectionId, sql: 'DELETE FROM orders' })

		expect(payloadsOn(ctx.emitted, 'cli.command')[0]).toMatchObject({ kind: 'open-console', sql: 'DELETE FROM orders' })
	})

	test('ui.openTable rejects a where fragment that is not a boolean expression', () => {
		const bad = [
			'1=1); DELETE FROM orders; --',
			'id > 1; DROP TABLE users',
			'id > 1 -- ',
			'id > 1 /* x */',
			'id > 1)',
		]
		for (const where of bad) {
			expect(() => ctx.handlers['ui.openTable']({ connectionId: ctx.connectionId, table: 'users', where }))
				.toThrow(/where /)
		}
		expect(ctx.emitted).toHaveLength(0)
	})

	test('ui.openTable accepts ordinary filters, including quoted literals', () => {
		for (const where of ["status='new'", "name = 'a;b'", 'id > 1 AND (a = 2 OR b = 3)', "note = 'it''s fine'"]) {
			expect(() => ctx.handlers['ui.openTable']({ connectionId: ctx.connectionId, table: 'users', where })).not.toThrow()
		}
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
