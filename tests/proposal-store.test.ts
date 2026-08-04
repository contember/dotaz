import { MAX_PROPOSALS, PROPOSAL_TTL_MS, ProposalStore } from '@dotaz/backend-shared/services/proposal-store'
import { describe, expect, test } from 'bun:test'

/** Store with a clock the test controls — expiry is never waited out for real. */
function withClock(ttlMs = PROPOSAL_TTL_MS) {
	const clock = { now: 1_700_000_000_000 }
	const store = new ProposalStore({ ttlMs, now: () => clock.now })
	return { store, clock }
}

function createProposal(store: ProposalStore, overrides: Partial<{ connectionId: string; sql: string; database: string; reason: string }> = {}) {
	return store.create({
		connectionId: overrides.connectionId ?? 'conn-1',
		database: overrides.database,
		sql: overrides.sql ?? 'DELETE FROM users WHERE id = 1',
		reason: overrides.reason,
	})
}

describe('ProposalStore', () => {
	describe('create / get', () => {
		test('create returns a pending proposal', () => {
			const { store, clock } = withClock()
			const proposal = createProposal(store, { reason: 'cleanup' })

			expect(proposal.id).toBeTruthy()
			expect(proposal.status).toBe('pending')
			expect(proposal.connectionId).toBe('conn-1')
			expect(proposal.sql).toBe('DELETE FROM users WHERE id = 1')
			expect(proposal.reason).toBe('cleanup')
			expect(proposal.createdAt).toBe(clock.now)
			expect(proposal.resolvedAt).toBeUndefined()
			store.dispose()
		})

		test('get returns the stored proposal, null for unknown id', () => {
			const { store } = withClock()
			const created = createProposal(store)

			expect(store.get(created.id)?.id).toBe(created.id)
			expect(store.get('nope')).toBeNull()
			store.dispose()
		})

		test('returned proposals are copies — mutating them does not corrupt the store', () => {
			const { store } = withClock()
			const created = createProposal(store)
			created.status = 'executed'

			expect(store.get(created.id)?.status).toBe('pending')
			store.dispose()
		})
	})

	describe('resolve / cancel', () => {
		test('resolves to executed with a result', () => {
			const { store, clock } = withClock()
			const created = createProposal(store)
			clock.now += 5_000

			const resolved = store.resolve({ proposalId: created.id, status: 'executed', result: { affectedRows: 3, statements: 1 } })

			expect(resolved.status).toBe('executed')
			expect(resolved.result).toEqual({ affectedRows: 3, statements: 1 })
			expect(resolved.resolvedAt).toBe(clock.now)
			store.dispose()
		})

		test('resolves to rejected', () => {
			const { store } = withClock()
			const created = createProposal(store)

			expect(store.resolve({ proposalId: created.id, status: 'rejected' }).status).toBe('rejected')
			store.dispose()
		})

		test('resolves to failed with an error message', () => {
			const { store } = withClock()
			const created = createProposal(store)

			const resolved = store.resolve({ proposalId: created.id, status: 'failed', error: 'syntax error' })

			expect(resolved.status).toBe('failed')
			expect(resolved.error).toBe('syntax error')
			store.dispose()
		})

		test('cancel moves pending to cancelled', () => {
			const { store } = withClock()
			const created = createProposal(store)

			expect(store.cancel(created.id).status).toBe('cancelled')
			store.dispose()
		})

		test('resolving twice throws', () => {
			const { store } = withClock()
			const created = createProposal(store)
			store.resolve({ proposalId: created.id, status: 'executed' })

			expect(() => store.resolve({ proposalId: created.id, status: 'rejected' })).toThrow(/already executed/)
			expect(() => store.cancel(created.id)).toThrow(/already executed/)
			store.dispose()
		})

		test('resolving to pending is an illegal transition', () => {
			const { store } = withClock()
			const created = createProposal(store)

			expect(() => store.resolve({ proposalId: created.id, status: 'pending' })).toThrow(/Cannot resolve/)
			expect(store.get(created.id)?.status).toBe('pending')
			store.dispose()
		})

		test('resolving an unknown proposal throws', () => {
			const { store } = withClock()

			expect(() => store.resolve({ proposalId: 'nope', status: 'executed' })).toThrow(/not found/)
			expect(() => store.cancel('nope')).toThrow(/not found/)
			store.dispose()
		})
	})

	describe('expiry', () => {
		test('pending proposals expire after the TTL', () => {
			const { store, clock } = withClock(60_000)
			const created = createProposal(store)

			clock.now += 59_999
			expect(store.get(created.id)?.status).toBe('pending')

			clock.now += 2
			const expired = store.get(created.id)
			expect(expired?.status).toBe('expired')
			expect(expired?.resolvedAt).toBe(clock.now)
			store.dispose()
		})

		test('expiry never rewrites an already resolved status', () => {
			const { store, clock } = withClock(60_000)
			const created = createProposal(store)
			store.resolve({ proposalId: created.id, status: 'executed' })

			clock.now += 59_000
			expect(store.get(created.id)?.status).toBe('executed')
			store.dispose()
		})

		test('resolved proposals are evicted once the retention window passes', () => {
			const { store, clock } = withClock(60_000)
			const created = createProposal(store)
			store.resolve({ proposalId: created.id, status: 'executed' })

			clock.now += 60_001
			expect(store.get(created.id)).toBeNull()
			store.dispose()
		})

		test('resolved proposals are evicted oldest-first past the cap', () => {
			const { store } = withClock(60_000)
			for (let i = 0; i < MAX_PROPOSALS + 10; i++) {
				const proposal = createProposal(store)
				store.resolve({ proposalId: proposal.id, status: 'executed' })
			}

			expect(store.list().length).toBeLessThanOrEqual(MAX_PROPOSALS)
			store.dispose()
		})

		test('the cap never evicts a pending proposal', () => {
			const { store } = withClock(60_000)
			const pending = createProposal(store)
			for (let i = 0; i < MAX_PROPOSALS + 10; i++) {
				const proposal = createProposal(store)
				store.resolve({ proposalId: proposal.id, status: 'executed' })
			}

			expect(store.get(pending.id)?.status).toBe('pending')
			store.dispose()
		})

		test('an expired proposal can no longer be resolved', () => {
			const { store, clock } = withClock(60_000)
			const created = createProposal(store)
			clock.now += 60_001

			expect(() => store.resolve({ proposalId: created.id, status: 'executed' })).toThrow(/already expired/)
			store.dispose()
		})

		test('default TTL is one hour', () => {
			expect(PROPOSAL_TTL_MS).toBe(60 * 60 * 1000)
		})
	})

	describe('list', () => {
		test('filters by status and connectionId', () => {
			const { store } = withClock()
			const a = createProposal(store, { connectionId: 'conn-1', sql: 'DELETE FROM a' })
			createProposal(store, { connectionId: 'conn-1', sql: 'DELETE FROM b' })
			createProposal(store, { connectionId: 'conn-2', sql: 'DELETE FROM c' })
			store.resolve({ proposalId: a.id, status: 'executed' })

			expect(store.list()).toHaveLength(3)
			expect(store.list({ status: 'pending' })).toHaveLength(2)
			expect(store.list({ status: 'executed' }).map((p) => p.id)).toEqual([a.id])
			expect(store.list({ connectionId: 'conn-2' })).toHaveLength(1)
			expect(store.list({ status: 'pending', connectionId: 'conn-1' })).toHaveLength(1)
			store.dispose()
		})

		test('lists expired proposals after a sweep', () => {
			const { store, clock } = withClock(60_000)
			createProposal(store)
			clock.now += 60_001

			expect(store.list({ status: 'expired' })).toHaveLength(1)
			expect(store.list({ status: 'pending' })).toHaveLength(0)
			store.dispose()
		})
	})

	describe('wait', () => {
		test('returns immediately when already resolved', async () => {
			const { store } = withClock()
			const created = createProposal(store)
			store.resolve({ proposalId: created.id, status: 'rejected' })

			expect((await store.wait(created.id, 50)).status).toBe('rejected')
			expect(store.waiterCount()).toBe(0)
			store.dispose()
		})

		test('resolves as soon as the status leaves pending', async () => {
			const { store } = withClock()
			const created = createProposal(store)

			const pending = store.wait(created.id, 5_000)
			expect(store.waiterCount()).toBe(1)
			store.resolve({ proposalId: created.id, status: 'executed', result: { affectedRows: 1 } })

			const result = await pending
			expect(result.status).toBe('executed')
			expect(result.result).toEqual({ affectedRows: 1 })
			expect(store.waiterCount()).toBe(0)
			store.dispose()
		})

		test('times out and returns the still-pending proposal', async () => {
			const { store } = withClock()
			const created = createProposal(store)

			const result = await store.wait(created.id, 20)

			expect(result.status).toBe('pending')
			expect(store.waiterCount()).toBe(0)
			store.dispose()
		})

		test('concurrent waiters all resolve and none leak', async () => {
			const { store } = withClock()
			const created = createProposal(store)

			const waits = [store.wait(created.id, 5_000), store.wait(created.id, 5_000), store.wait(created.id, 5_000)]
			expect(store.waiterCount()).toBe(3)
			store.cancel(created.id)

			const results = await Promise.all(waits)
			expect(results.map((p) => p.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
			expect(store.waiterCount()).toBe(0)
			store.dispose()
		})

		test('waiting on an unknown proposal rejects', async () => {
			const { store } = withClock()

			await expect(store.wait('nope', 10)).rejects.toThrow(/not found/)
			expect(store.waiterCount()).toBe(0)
			store.dispose()
		})

		test('expiry wakes a waiter', async () => {
			const { store, clock } = withClock(60_000)
			const created = createProposal(store)

			const pending = store.wait(created.id, 5_000)
			clock.now += 60_001
			store.list() // any access sweeps

			expect((await pending).status).toBe('expired')
			expect(store.waiterCount()).toBe(0)
			store.dispose()
		})
	})

	describe('dispose', () => {
		test('resolves in-flight waits and clears them', async () => {
			const { store } = withClock()
			const created = createProposal(store)

			const pending = store.wait(created.id, 60_000)
			store.dispose()

			expect((await pending).status).toBe('pending')
			expect(store.waiterCount()).toBe(0)
		})

		test('a disposed store rejects further use', () => {
			const { store } = withClock()
			store.dispose()

			expect(() => createProposal(store)).toThrow(/disposed/)
			expect(() => store.resolve({ proposalId: 'x', status: 'executed' })).toThrow(/disposed/)
			expect(store.list()).toEqual([])
		})
	})
})
