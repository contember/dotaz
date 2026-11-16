import { createCliHandlerLookup } from '@dotaz/backend-shared/rpc/cli-surface'
import type { RpcHandler } from '@dotaz/backend-shared/rpc/dispatch'
import { createHandlers } from '@dotaz/backend-shared/rpc/rpc-handlers'
import { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { ProposalStore } from '@dotaz/backend-shared/services/proposal-store'
import {
	CHALLENGE_TTL_MS,
	MAX_OUTSTANDING_CHALLENGES,
	MAX_PAIRING_REQUESTS_PER_HOUR,
	PAIRING_COOLDOWN_MS,
	PAIRING_TTL_MS,
	RemoteApprovals,
} from '@dotaz/backend-shared/services/remote-approvals'
import { AppDatabase, type StoredApprover } from '@dotaz/backend-shared/storage/app-db'
import { approvalChallengeBytes, type SignedProposalFields } from '@dotaz/shared/remote-approval'
import type { ApprovalChallenge, ApprovalDecision, ApproversState, Proposal } from '@dotaz/shared/types/rpc'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlServer } from '../src/backend-desktop/control-server'
import { DotazClient } from '../src/cli-agent/client'
import { discoverEndpoint } from '../src/cli-agent/endpoint'
import { type AssertionOverrides, TestPasskey } from './passkey-helpers'

const RLO = String.fromCharCode(0x202e)

// ── End to end through the real handlers and a real SQLite database ──

interface Emitted {
	channel: string
	payload: unknown
}

async function setup() {
	AppDatabase.resetInstance()
	const appDb = AppDatabase.getInstance(':memory:')
	const cm = new ConnectionManager(appDb)
	const tempDir = mkdtempSync(join(tmpdir(), 'dotaz-remote-approvals-'))
	const emitted: Emitted[] = []
	const { handlers, adapter, sessionManager } = createHandlers(cm, undefined, appDb, undefined, {
		emitMessage: (channel, payload) => emitted.push({ channel, payload }),
		appVersion: '1.2.3',
		mode: 'desktop',
	})
	const connection = handlers['connections.create']({ name: 'Shop', config: { type: 'sqlite', path: join(tempDir, 'shop.db') } })
	const connectionId = connection.id
	await handlers['connections.connect']({ connectionId })
	await handlers['query.execute']({
		connectionId,
		queryId: 'seed',
		sql: "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO items (id, name) VALUES (1, 'a'), (2, 'b'), (3, 'c')",
	})
	/** What any process holding the endpoint token can reach, and nothing more. */
	const lookup = createCliHandlerLookup(handlers as unknown as Record<string, RpcHandler>)
	// CLI results are untyped on the wire.
	const cli = async (method: string, params?: unknown): Promise<any> => {
		const handler = lookup(method)
		if (!handler) throw new Error(`${method} is not on the CLI surface`)
		return handler(params)
	}
	return { adapter, appDb, cm, cli, connectionId, emitted, handlers, lookup, sessionManager, tempDir }
}

type Ctx = Awaited<ReturnType<typeof setup>>

async function names(ctx: Ctx): Promise<string[]> {
	const results = await ctx.handlers['query.execute']({ connectionId: ctx.connectionId, queryId: 'check', sql: 'SELECT name FROM items ORDER BY id' })
	return results[0].rows.map((row) => String(row.name))
}

/** Pair a key the way it is meant to happen: the CLI asks, the user confirms in the window. */
async function pair(ctx: Ctx, passkey: TestPasskey, label = 'Phone') {
	const { requestId, fingerprint } = await ctx.cli('approvers.request', passkey.pairingParams(label))
	return ctx.handlers['approvers.confirm']({ requestId, fingerprint })
}

async function propose(ctx: Ctx, sql: string, extra: Record<string, unknown> = {}): Promise<string> {
	const { proposalId } = await ctx.cli('agent.proposeWrite', { connectionId: ctx.connectionId, sql, ...extra })
	return proposalId
}

/**
 * Do what an approving page does: fetch a challenge, compute the signed bytes from the fields
 * it shows (optionally tampered with), and have the passkey sign them.
 */
async function sign(
	ctx: Ctx,
	passkey: TestPasskey,
	proposalId: string,
	decision: ApprovalDecision,
	opts: { shown?: (p: SignedProposalFields) => SignedProposalFields; overrides?: AssertionOverrides } = {},
) {
	const challenge: ApprovalChallenge = await ctx.cli('agent.approvals.challenge', { proposalId, decision })
	const shown = opts.shown ? opts.shown(challenge.proposal) : challenge.proposal
	const bytes = await approvalChallengeBytes(challenge.nonce, decision, shown)
	return { challenge, params: { proposalId, decision, nonce: challenge.nonce, ...passkey.assert(bytes, opts.overrides) } }
}

describe('Remote approvals (handlers, SQLite)', () => {
	let ctx: Ctx
	let passkey: TestPasskey

	beforeEach(async () => {
		ctx = await setup()
		passkey = new TestPasskey()
	})

	afterEach(async () => {
		ctx.adapter.dispose()
		await ctx.cm.disconnectAll()
		AppDatabase.resetInstance()
		rmSync(ctx.tempDir, { recursive: true, force: true })
	})

	// ── Pairing ─────────────────────────────────────────

	test('a pairing request from the CLI adds nothing until the user confirms it in the window', async () => {
		const request = await ctx.cli('approvers.request', passkey.pairingParams('Phone'))
		expect(request.fingerprint).toMatch(/^[A-Z2-7]{16}$/)
		expect(await ctx.cli('approvers.list')).toEqual([])

		// The window is told, so it can show the request.
		const pushed = ctx.emitted.filter((m) => m.channel === 'approvers.changed').map((m) => m.payload as ApproversState)
		expect(pushed.at(-1)?.request).toMatchObject({ requestId: request.requestId, fingerprint: request.fingerprint, label: 'Phone' })
		expect(pushed.at(-1)?.request).not.toHaveProperty('publicKey')

		ctx.handlers['approvers.confirm']({ requestId: request.requestId, fingerprint: request.fingerprint })
		const listed = await ctx.cli('approvers.list')
		expect(listed).toHaveLength(1)
		expect(listed[0]).toMatchObject({ label: 'Phone', credentialId: passkey.credentialId, fingerprint: request.fingerprint })
		expect(listed[0]).not.toHaveProperty('publicKey')
	})

	test('the CLI cannot confirm, decline or remove keys, see the pending request, or resolve proposals', () => {
		for (const method of ['approvers.confirm', 'approvers.decline', 'approvers.remove', 'approvers.pending', 'agent.proposals.resolve']) {
			expect(ctx.lookup(method)).toBeUndefined()
		}
	})

	test('confirming needs the fingerprint the window showed', async () => {
		const { requestId } = await ctx.cli('approvers.request', passkey.pairingParams())
		expect(() => ctx.handlers['approvers.confirm']({ requestId, fingerprint: 'AAAAAAAAAAAAAAAA' })).toThrow(/no longer waiting/)
		expect(await ctx.cli('approvers.list')).toEqual([])
	})

	test('a declined request is gone and adds nothing', async () => {
		const { requestId, fingerprint } = await ctx.cli('approvers.request', passkey.pairingParams())
		ctx.handlers['approvers.decline']({ requestId })
		expect(ctx.handlers['approvers.pending']()).toBeNull()
		expect(() => ctx.handlers['approvers.confirm']({ requestId, fingerprint })).toThrow(/no longer waiting/)
	})

	test('only one pairing request at a time, and a second one never replaces the first', async () => {
		const first = await ctx.cli('approvers.request', passkey.pairingParams('Mine'))
		await expect(ctx.cli('approvers.request', new TestPasskey().pairingParams('Mine'))).rejects.toMatchObject({ code: 'PAIRING_REFUSED' })
		expect(ctx.handlers['approvers.pending']()?.fingerprint).toBe(first.fingerprint)
	})

	test('pairing refuses keys and origins that could not be verified safely', async () => {
		const base = passkey.pairingParams()
		const bad: Array<Record<string, string>> = [
			{ ...base, origin: 'http://approve.example.com' },
			{ ...base, origin: 'https://evil.example.org' },
			{ ...base, origin: 'https://approve.example.com/path' },
			{ ...base, rpId: 'Example.COM' },
			{ ...base, label: 'two\nlines' },
			{ ...base, label: `hidden${RLO}text` },
			{ ...base, credentialId: 'c2hvcnQ' },
			{ ...base, credentialId: 'not base64!' },
			{ ...base, publicKey: 'pQECAyYgASFYIA' },
		]
		for (const params of bad) {
			await expect(ctx.cli('approvers.request', params)).rejects.toMatchObject({ code: 'PAIRING_REFUSED' })
		}
		// Any local program can serve a page on localhost or a loopback address, so neither may approve.
		const local: Array<[string, string]> = [
			['localhost', 'http://localhost:5173'],
			['localhost', 'https://localhost'],
			['app.localhost', 'https://app.localhost'],
			['127.0.0.1', 'https://127.0.0.1'],
		]
		for (const [rpId, origin] of local) {
			await expect(ctx.cli('approvers.request', new TestPasskey(rpId, origin).pairingParams())).rejects.toMatchObject({ code: 'PAIRING_REFUSED' })
		}
		expect(ctx.handlers['approvers.pending']()).toBeNull()
	})

	// ── Approving ───────────────────────────────────────

	test('with no paired keys nothing changes: challenges are refused', async () => {
		const proposalId = await propose(ctx, "UPDATE items SET name = 'x' WHERE id = 1")
		await expect(ctx.cli('agent.approvals.challenge', { proposalId, decision: 'approve' })).rejects.toMatchObject({
			code: 'APPROVAL_UNAVAILABLE',
		})
	})

	test('a signed approval runs exactly the stored SQL and reports counts, never rows', async () => {
		await pair(ctx, passkey, 'Phone')
		const proposalId = await propose(ctx, "UPDATE items SET name = 'secret-value' WHERE id IN (1, 2) RETURNING name", {
			reason: 'rename',
			requestedBy: 'agent T7',
		})
		const { challenge, params } = await sign(ctx, passkey, proposalId, 'approve')
		expect(challenge.proposal).toMatchObject({ connectionName: 'Shop', database: null, reason: 'rename', requestedBy: 'agent T7', statements: 1 })
		expect(challenge.allowCredentials).toEqual([passkey.credentialId])

		const result: Proposal = await ctx.cli('agent.approvals.redeem', params)

		expect(result).toMatchObject({ status: 'executed', resolvedVia: 'remote', approver: 'Phone', result: { affectedRows: 2, statements: 1 } })
		expect(JSON.stringify(result.result)).not.toContain('secret-value')
		expect(await names(ctx)).toEqual(['secret-value', 'secret-value', 'c'])
		// The run used its own session and gave it back.
		expect(ctx.sessionManager.listSessions(ctx.connectionId)).toEqual([])
	})

	test('a signed rejection rejects and runs nothing', async () => {
		await pair(ctx, passkey)
		const proposalId = await propose(ctx, 'DELETE FROM items')
		const { params } = await sign(ctx, passkey, proposalId, 'reject')

		const result: Proposal = await ctx.cli('agent.approvals.redeem', params)

		expect(result).toMatchObject({ status: 'rejected', resolvedVia: 'remote', approver: 'Phone' })
		expect(await names(ctx)).toEqual(['a', 'b', 'c'])
	})

	test('a signature over different SQL than Dotaz holds is refused and nothing runs', async () => {
		await pair(ctx, passkey)
		const proposalId = await propose(ctx, 'DELETE FROM items WHERE id = 3')
		// Someone in between showed the device a harmless-looking statement.
		const { params } = await sign(ctx, passkey, proposalId, 'approve', {
			shown: (p) => ({ ...p, sql: 'DELETE FROM items WHERE id = 3 AND 1 = 0' }),
		})

		await expect(ctx.cli('agent.approvals.redeem', params)).rejects.toMatchObject({ code: 'APPROVAL_REFUSED' })
		expect(ctx.handlers['agent.proposals.get']({ proposalId }).status).toBe('pending')
		expect(await names(ctx)).toEqual(['a', 'b', 'c'])
	})

	test('a signature over another connection name, database, reason or requester is refused', async () => {
		await pair(ctx, passkey)
		const proposalId = await propose(ctx, "UPDATE items SET name = 'x'", { reason: 'r', requestedBy: 'agent' })
		const tamperings: Array<(p: SignedProposalFields) => SignedProposalFields> = [
			(p) => ({ ...p, connectionName: 'Staging' }),
			(p) => ({ ...p, database: 'other' }),
			(p) => ({ ...p, reason: 'harmless' }),
			(p) => ({ ...p, requestedBy: 'trusted' }),
		]
		for (const shown of tamperings) {
			const { params } = await sign(ctx, passkey, proposalId, 'approve', { shown })
			await expect(ctx.cli('agent.approvals.redeem', params)).rejects.toMatchObject({ code: 'APPROVAL_REFUSED' })
		}
		expect(await names(ctx)).toEqual(['a', 'b', 'c'])
	})

	test('the CLI token alone cannot approve: a self-made key or signature is refused', async () => {
		await pair(ctx, passkey)
		const proposalId = await propose(ctx, 'DELETE FROM items')

		// Its own key, never confirmed in the window (asking right after a pairing is refused anyway)
		const attacker = new TestPasskey(passkey.rpId, passkey.origin)
		await expect(ctx.cli('approvers.request', attacker.pairingParams('Totally my phone'))).rejects.toMatchObject({ code: 'PAIRING_REFUSED' })
		const own = await sign(ctx, attacker, proposalId, 'approve')
		await expect(ctx.cli('agent.approvals.redeem', own.params)).rejects.toThrow(/not paired/)

		// The paired key's id, but a signature it did not make
		const forged = await sign(ctx, passkey, proposalId, 'approve', { overrides: { signWith: attacker.privateKey } })
		await expect(ctx.cli('agent.approvals.redeem', forged.params)).rejects.toThrow(/signature/)

		// Garbage
		const challenge = await ctx.cli('agent.approvals.challenge', { proposalId, decision: 'approve' })
		await expect(ctx.cli('agent.approvals.redeem', {
			proposalId,
			decision: 'approve',
			nonce: challenge.nonce,
			credentialId: passkey.credentialId,
			authenticatorData: 'AAAA',
			clientDataJSON: 'AAAA',
			signature: 'AAAA',
		})).rejects.toMatchObject({ code: 'APPROVAL_REFUSED' })

		expect(ctx.handlers['agent.proposals.get']({ proposalId }).status).toBe('pending')
		expect(await names(ctx)).toEqual(['a', 'b', 'c'])
	})

	test('an assertion without user verification, from another origin or RP, is refused', async () => {
		await pair(ctx, passkey)
		const proposalId = await propose(ctx, 'DELETE FROM items')
		const variants: AssertionOverrides[] = [
			{ flags: 0x01 },
			{ origin: 'http://localhost:9999' },
			{ rpId: 'example.com' },
			{ type: 'webauthn.create' },
			{ crossOrigin: true },
		]
		for (const overrides of variants) {
			const { params } = await sign(ctx, passkey, proposalId, 'approve', { overrides })
			await expect(ctx.cli('agent.approvals.redeem', params)).rejects.toMatchObject({ code: 'APPROVAL_REFUSED' })
		}
		expect(await names(ctx)).toEqual(['a', 'b', 'c'])
	})

	test('a nonce is good for one attempt: a replay, or a retry after a bad attempt, is refused', async () => {
		await pair(ctx, passkey)
		const first = await propose(ctx, "UPDATE items SET name = 'x' WHERE id = 1")
		const { params } = await sign(ctx, passkey, first, 'reject')
		await ctx.cli('agent.approvals.redeem', params)
		await expect(ctx.cli('agent.approvals.redeem', params)).rejects.toThrow(/already used/)

		const second = await propose(ctx, "UPDATE items SET name = 'y' WHERE id = 2")
		const good = await sign(ctx, passkey, second, 'approve')
		await expect(ctx.cli('agent.approvals.redeem', { ...good.params, signature: 'AAAA' })).rejects.toMatchObject({ code: 'APPROVAL_REFUSED' })
		await expect(ctx.cli('agent.approvals.redeem', good.params)).rejects.toThrow(/already used/)
		expect(await names(ctx)).toEqual(['a', 'b', 'c'])
	})

	test('a challenge cannot be moved to another proposal or decision', async () => {
		await pair(ctx, passkey)
		const target = await propose(ctx, 'DELETE FROM items')
		const decoy = await propose(ctx, "UPDATE items SET name = 'z' WHERE id = 3")
		const forReject = await sign(ctx, passkey, target, 'reject')
		await expect(ctx.cli('agent.approvals.redeem', { ...forReject.params, decision: 'approve' })).rejects.toThrow(/another proposal or decision/)
		const forDecoy = await sign(ctx, passkey, decoy, 'approve')
		await expect(ctx.cli('agent.approvals.redeem', { ...forDecoy.params, proposalId: target })).rejects.toThrow(/another proposal or decision/)
		expect(await names(ctx)).toEqual(['a', 'b', 'c'])
	})

	test('a key removed in the window can no longer approve', async () => {
		const approver = await pair(ctx, passkey)
		const proposalId = await propose(ctx, 'DELETE FROM items')
		const { params } = await sign(ctx, passkey, proposalId, 'approve')
		ctx.handlers['approvers.remove']({ id: approver.id })
		await expect(ctx.cli('agent.approvals.redeem', params)).rejects.toThrow(/not paired/)
		expect(await names(ctx)).toEqual(['a', 'b', 'c'])
	})

	test('a proposal the window already claimed cannot be approved remotely', async () => {
		await pair(ctx, passkey)
		const proposalId = await propose(ctx, 'DELETE FROM items')
		const { params } = await sign(ctx, passkey, proposalId, 'approve')
		ctx.handlers['agent.proposals.resolve']({ proposalId, status: 'approved' })

		await expect(ctx.cli('agent.approvals.redeem', params)).rejects.toThrow(/already approved/)
		expect(await names(ctx)).toEqual(['a', 'b', 'c'])
	})

	test('a remote run leaves the outcome to itself: the window cannot settle it', async () => {
		await pair(ctx, passkey)
		const proposalId = await propose(ctx, "UPDATE items SET name = 'x' WHERE id = 1")
		const { params } = await sign(ctx, passkey, proposalId, 'approve')
		await ctx.cli('agent.approvals.redeem', params)
		expect(() => ctx.handlers['agent.proposals.resolve']({ proposalId, status: 'failed', error: 'spoofed' })).toThrow(/already executed/)
	})

	test('a failing statement fails the proposal and rolls back the ones before it', async () => {
		await pair(ctx, passkey)
		const proposalId = await propose(ctx, "UPDATE items SET name = 'x' WHERE id = 1; INSERT INTO items (id, name) VALUES (2, 'dup')")
		const { params } = await sign(ctx, passkey, proposalId, 'approve')

		const result: Proposal = await ctx.cli('agent.approvals.redeem', params)

		expect(result.status).toBe('failed')
		expect(result.error).toMatch(/UNIQUE|constraint/i)
		expect(await names(ctx)).toEqual(['a', 'b', 'c'])
		expect(ctx.sessionManager.listSessions(ctx.connectionId)).toEqual([])
	})

	test('SQL with deceptive characters, over 64 KB or with its own transaction control is not approvable remotely, but rejectable', async () => {
		await pair(ctx, passkey)
		const sqls = [
			`DELETE FROM items WHERE name = 'a${RLO}'`,
			`UPDATE items SET name = '${'x'.repeat(64 * 1024)}' WHERE id = 1`,
			"BEGIN; UPDATE items SET name = 'x'; COMMIT",
		]
		for (const sql of sqls) {
			const proposalId = await propose(ctx, sql)
			await expect(ctx.cli('agent.approvals.challenge', { proposalId, decision: 'approve' })).rejects.toMatchObject({
				code: 'APPROVAL_REFUSED',
			})
			const { params } = await sign(ctx, passkey, proposalId, 'reject')
			expect((await ctx.cli('agent.approvals.redeem', params)).status).toBe('rejected')
		}
		const withReason = await propose(ctx, 'DELETE FROM items', { reason: `fine${RLO}` })
		await expect(ctx.cli('agent.approvals.challenge', { proposalId: withReason, decision: 'approve' })).rejects.toThrow(/reason/)
	})

	test('a disconnected or read-only connection refuses before anything is claimed', async () => {
		await pair(ctx, passkey)
		const proposalId = await propose(ctx, 'DELETE FROM items')
		const { params } = await sign(ctx, passkey, proposalId, 'approve')

		ctx.handlers['connections.setReadOnly']({ id: ctx.connectionId, readOnly: true })
		await expect(ctx.cli('agent.approvals.redeem', params)).rejects.toThrow(/read-only/)
		await expect(ctx.cli('agent.approvals.challenge', { proposalId, decision: 'approve' })).rejects.toThrow(/read-only/)
		ctx.handlers['connections.setReadOnly']({ id: ctx.connectionId, readOnly: false })

		await ctx.handlers['connections.disconnect']({ connectionId: ctx.connectionId })
		await expect(ctx.cli('agent.approvals.challenge', { proposalId, decision: 'approve' })).rejects.toThrow(/not connected/)
		expect(ctx.handlers['agent.proposals.get']({ proposalId }).status).toBe('pending')
	})

	test('over the real control socket: the token can ask and redeem, but only the window can pair', async () => {
		const userDataDir = mkdtempSync(join(tmpdir(), 'dotaz-remote-socket-'))
		const server = await startControlServer({
			handlers: ctx.handlers as unknown as Record<string, RpcHandler>,
			userDataDir,
			appVersion: '9.9.9',
			transport: 'unix',
		})
		try {
			const client = new DotazClient(discoverEndpoint({ explicitFile: server.endpointFile }).endpoint, 10_000)
			// Untyped wire payloads.
			const call = (method: string, params?: unknown) => client.call(method, params) as Promise<any>

			const request = await call('approvers.request', passkey.pairingParams('Laptop'))
			await expect(call('approvers.confirm', { requestId: request.requestId, fingerprint: request.fingerprint })).rejects.toThrow(/Unknown method/)
			expect(await call('approvers.list')).toEqual([])
			ctx.handlers['approvers.confirm']({ requestId: request.requestId, fingerprint: request.fingerprint })

			const { proposalId } = await call('agent.proposeWrite', {
				connectionId: ctx.connectionId,
				sql: "UPDATE items SET name = 'via-socket' WHERE id = 3",
			})
			const challenge: ApprovalChallenge = await call('agent.approvals.challenge', { proposalId, decision: 'approve' })
			const bytes = await approvalChallengeBytes(challenge.nonce, 'approve', challenge.proposal)
			const result = await call('agent.approvals.redeem', { proposalId, decision: 'approve', nonce: challenge.nonce, ...passkey.assert(bytes) })

			expect(result).toMatchObject({ status: 'executed', resolvedVia: 'remote', approver: 'Laptop', result: { affectedRows: 1 } })
			expect(await names(ctx)).toEqual(['a', 'b', 'via-socket'])
		} finally {
			await server.stop()
			rmSync(userDataDir, { recursive: true, force: true })
		}
	})

	test('requestedBy is stored as given and must be one safe line', async () => {
		const proposalId = await propose(ctx, 'DELETE FROM items', { requestedBy: '  agent T7  ' })
		expect(ctx.handlers['agent.proposals.get']({ proposalId })).toMatchObject({ requestedBy: 'agent T7', connectionName: 'Shop' })
		await expect(propose(ctx, 'DELETE FROM items', { requestedBy: 'two\nlines' })).rejects.toThrow(/requestedBy/)
		await expect(propose(ctx, 'DELETE FROM items', { requestedBy: 'x'.repeat(121) })).rejects.toThrow(/requestedBy/)
	})
})

// ── Clock-dependent rules and races, on the service with an injected clock ──

function memoryStorage() {
	const approvers: StoredApprover[] = []
	return {
		approvers,
		listRemoteApprovers: () => approvers.map((a) => ({ ...a })),
		addRemoteApprover: (a: StoredApprover) => void approvers.push({ ...a }),
		removeRemoteApprover: (id: string) => {
			const index = approvers.findIndex((a) => a.id === id)
			if (index < 0) return false
			approvers.splice(index, 1)
			return true
		},
	}
}

function service(opts: { execute?: (p: Proposal) => Promise<{ affectedRows: number; statements: number }> } = {}) {
	const clock = { now: 1_800_000_000_000 }
	const proposals = new ProposalStore({ now: () => clock.now })
	const storage = memoryStorage()
	let runs = 0
	const approvals = new RemoteApprovals({
		storage,
		proposals,
		connectionBlock: () => null,
		execute: opts.execute ?? (async () => {
			runs++
			return { affectedRows: 1, statements: 1 }
		}),
		now: () => clock.now,
	})
	const passkey = new TestPasskey()
	const pairKey = async () => {
		const { requestId, fingerprint } = await approvals.requestApprover(passkey.pairingParams())
		approvals.confirmRequest(requestId, fingerprint)
	}
	const newProposal = () => proposals.create({ connectionId: 'c1', connectionName: 'main', sql: 'DELETE FROM t' })
	const signed = async (proposalId: string, decision: ApprovalDecision = 'approve') => {
		const challenge = await approvals.challenge({ proposalId, decision })
		const bytes = await approvalChallengeBytes(challenge.nonce, decision, challenge.proposal)
		return { proposalId, decision, nonce: challenge.nonce, ...passkey.assert(bytes) }
	}
	return { approvals, clock, proposals, storage, passkey, pairKey, newProposal, signed, runs: () => runs }
}

describe('Remote approvals (service)', () => {
	test('a challenge expires after two minutes', async () => {
		const s = service()
		await s.pairKey()
		const proposal = s.newProposal()
		const params = await s.signed(proposal.id)
		s.clock.now += CHALLENGE_TTL_MS
		await expect(s.approvals.redeem(params)).rejects.toThrow(/expired/)
		expect(s.runs()).toBe(0)
	})

	test(`at most ${MAX_OUTSTANDING_CHALLENGES} challenges are outstanding`, async () => {
		const s = service()
		await s.pairKey()
		const proposal = s.newProposal()
		for (let i = 0; i < MAX_OUTSTANDING_CHALLENGES; i++) await s.approvals.challenge({ proposalId: proposal.id, decision: 'approve' })
		await expect(s.approvals.challenge({ proposalId: proposal.id, decision: 'approve' })).rejects.toThrow(/Too many/)
		s.clock.now += CHALLENGE_TTL_MS
		await expect(s.approvals.challenge({ proposalId: proposal.id, decision: 'approve' })).resolves.toHaveProperty('nonce')
	})

	test('a pairing request expires after five minutes', async () => {
		const s = service()
		const passkey = new TestPasskey()
		const { requestId, fingerprint } = await s.approvals.requestApprover(passkey.pairingParams())
		s.clock.now += PAIRING_TTL_MS
		expect(s.approvals.pendingRequest()).toBeNull()
		expect(() => s.approvals.confirmRequest(requestId, fingerprint)).toThrow(/no longer waiting/)
		s.approvals.dispose()
	})

	test('a new pairing request cannot take the place of a settled or expired one right away', async () => {
		const s = service()
		const first = await s.approvals.requestApprover(new TestPasskey().pairingParams())
		s.approvals.declineRequest(first.requestId)
		await expect(s.approvals.requestApprover(new TestPasskey().pairingParams())).rejects.toThrow(/just settled/)

		s.clock.now += PAIRING_COOLDOWN_MS
		await s.approvals.requestApprover(new TestPasskey().pairingParams())
		s.clock.now += PAIRING_TTL_MS
		expect(s.approvals.pendingRequest()).toBeNull()
		await expect(s.approvals.requestApprover(new TestPasskey().pairingParams())).rejects.toThrow(/just settled/)
		s.approvals.dispose()
	})

	test('an already paired key cannot be paired again', async () => {
		const s = service()
		await s.pairKey()
		s.clock.now += PAIRING_COOLDOWN_MS
		await expect(s.approvals.requestApprover(s.passkey.pairingParams())).rejects.toThrow(/already paired/)
	})

	test(`at most ${MAX_PAIRING_REQUESTS_PER_HOUR} pairing requests per hour`, async () => {
		const s = service()
		for (let i = 0; i < MAX_PAIRING_REQUESTS_PER_HOUR; i++) {
			const { requestId } = await s.approvals.requestApprover(new TestPasskey().pairingParams())
			s.approvals.declineRequest(requestId)
			s.clock.now += PAIRING_COOLDOWN_MS
		}
		await expect(s.approvals.requestApprover(new TestPasskey().pairingParams())).rejects.toThrow(/per hour/)
		s.clock.now += 60 * 60 * 1000
		await expect(s.approvals.requestApprover(new TestPasskey().pairingParams())).resolves.toHaveProperty('requestId')
		s.approvals.dispose()
	})

	test('two valid approvals racing for one proposal run it once', async () => {
		const s = service()
		await s.pairKey()
		const proposal = s.newProposal()
		const [a, b] = [await s.signed(proposal.id), await s.signed(proposal.id)]

		const outcomes = await Promise.allSettled([s.approvals.redeem(a), s.approvals.redeem(b)])

		expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
		expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1)
		expect(s.runs()).toBe(1)
		expect(s.proposals.get(proposal.id)?.status).toBe('executed')
	})

	test('while a remote run is in flight the window can neither claim nor settle it', async () => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const s = service({
			execute: async () => {
				await gate
				return { affectedRows: 4, statements: 1 }
			},
		})
		await s.pairKey()
		const proposal = s.newProposal()
		const running = s.approvals.redeem(await s.signed(proposal.id))
		while (s.proposals.get(proposal.id)?.status !== 'approved') await Bun.sleep(1)

		expect(() => s.proposals.resolve({ proposalId: proposal.id, status: 'approved' })).toThrow(/already approved/)
		expect(() => s.proposals.resolve({ proposalId: proposal.id, status: 'executed' })).toThrow(/approved remotely/)
		expect(() => s.proposals.cancel(proposal.id)).toThrow(/already approved/)

		release()
		expect(await running).toMatchObject({ status: 'executed', result: { affectedRows: 4 } })
	})

	test('a key with another algorithm cannot even ask to be paired', async () => {
		const s = service()
		await expect(s.approvals.requestApprover({ ...new TestPasskey().pairingParams(), publicKey: 'pAEDAzkBACBZAQA' })).rejects.toThrow(/Invalid key/)
		expect(s.storage.approvers).toHaveLength(0)
	})
})
