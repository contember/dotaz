import type { Proposal, ProposalListParams, ProposalResolveParams, ProposalStatus, ProposeWriteParams } from '@dotaz/shared/types/rpc'

/** A pending proposal stops being actionable after this long (docs/agent-cli.md). */
export const PROPOSAL_TTL_MS = 60 * 60 * 1000

/** Upper bound on retained proposals — resolved ones are evicted oldest-first past this. */
export const MAX_PROPOSALS = 500

/** Each pending proposal opens a tab in the user's window, so an agent cannot queue more than this. */
export const MAX_PENDING_PROPOSALS = 20

/** Every status a `pending` proposal may transition into — `pending` itself is not one of them. */
const RESOLVED_STATUSES: readonly ProposalStatus[] = ['approved', 'rejected', 'executed', 'failed', 'cancelled', 'expired']

/** The app claims a proposal as `approved` before running it; only the run's outcome may follow. */
const AFTER_APPROVED: readonly ProposalStatus[] = ['executed', 'failed']

/** Still in flight: `wait()` keeps polling through these. */
function isSettled(status: ProposalStatus): boolean {
	return status !== 'pending' && status !== 'approved'
}

export interface ProposalStoreOptions {
	/** Lifetime of a pending proposal. */
	ttlMs?: number
	/** Injectable clock — tests advance it instead of waiting out the TTL. */
	now?: () => number
}

/** `final` hands over the current state even when it is not settled (the store is going away). */
type Waiter = (proposal: Proposal, final?: boolean) => void

/**
 * In-memory registry of writes the CLI submitted for user approval.
 * Never persisted — proposals belong to the backend process that created them.
 */
export class ProposalStore {
	private proposals = new Map<string, Proposal>()
	private waiters = new Map<string, Set<Waiter>>()
	private observers = new Set<(proposal: Proposal) => void>()
	private readonly ttlMs: number
	private readonly now: () => number
	private disposed = false

	constructor(opts?: ProposalStoreOptions) {
		this.ttlMs = opts?.ttlMs ?? PROPOSAL_TTL_MS
		this.now = opts?.now ?? (() => Date.now())
	}

	create(params: ProposeWriteParams): Proposal {
		this.assertUsable()
		this.sweep()
		const pending = [...this.proposals.values()].filter((p) => p.status === 'pending').length
		if (pending >= MAX_PENDING_PROPOSALS) {
			throw new Error(`${pending} proposals are already waiting for approval — wait for the user or cancel some first`)
		}
		const proposal: Proposal = {
			id: crypto.randomUUID(),
			connectionId: params.connectionId,
			database: params.database,
			sql: params.sql,
			reason: params.reason,
			status: 'pending',
			createdAt: this.now(),
		}
		this.proposals.set(proposal.id, proposal)
		this.notify(proposal)
		return { ...proposal }
	}

	get(id: string): Proposal | null {
		this.sweep()
		const proposal = this.proposals.get(id)
		return proposal ? { ...proposal } : null
	}

	list(filter?: ProposalListParams): Proposal[] {
		this.sweep()
		let items = [...this.proposals.values()]
		if (filter?.status) items = items.filter((p) => p.status === filter.status)
		if (filter?.connectionId) items = items.filter((p) => p.connectionId === filter.connectionId)
		return items.map((p) => ({ ...p }))
	}

	resolve(params: ProposalResolveParams): Proposal {
		this.assertUsable()
		this.sweep()
		if (!RESOLVED_STATUSES.includes(params.status)) {
			throw new Error(`Cannot resolve a proposal to status "${params.status}"`)
		}
		return this.transition(this.require(params.proposalId), params.status, params.result, params.error)
	}

	cancel(id: string): Proposal {
		this.assertUsable()
		this.sweep()
		return this.transition(this.require(id), 'cancelled')
	}

	/**
	 * Resolves once the proposal is settled — past `pending` and `approved` — or on timeout
	 * (returns the current state).
	 * `async` so a bad id rejects instead of throwing synchronously — the body still registers
	 * its waiter before returning.
	 */
	async wait(id: string, timeoutMs: number): Promise<Proposal> {
		this.assertUsable()
		this.sweep()
		const current = this.require(id)
		if (isSettled(current.status)) return { ...current }

		return new Promise<Proposal>((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined
			const waiter: Waiter = (proposal, final) => {
				if (!final && !isSettled(proposal.status)) return
				if (timer !== undefined) clearTimeout(timer)
				this.removeWaiter(id, waiter)
				resolve({ ...proposal })
			}
			this.addWaiter(id, waiter)
			timer = setTimeout(() => {
				this.removeWaiter(id, waiter)
				this.sweep()
				const latest = this.proposals.get(id)
				resolve({ ...(latest ?? current) })
			}, timeoutMs)
		})
	}

	/** In-flight `wait()` calls — exposed so tests can assert nothing leaks. */
	waiterCount(): number {
		let count = 0
		for (const set of this.waiters.values()) count += set.size
		return count
	}

	dispose(): void {
		this.disposed = true
		// Hand every long-poll the last known state so no caller is left hanging.
		for (const [id, waiters] of [...this.waiters]) {
			const proposal = this.proposals.get(id)
			if (!proposal) continue
			for (const waiter of [...waiters]) waiter(proposal, true)
		}
		this.waiters.clear()
		this.observers.clear()
		this.proposals.clear()
	}

	// ── Internals ────────────────────────────────────────

	private require(id: string): Proposal {
		const proposal = this.proposals.get(id)
		if (!proposal) throw new Error(`Proposal not found: ${id}`)
		return proposal
	}

	private transition(
		proposal: Proposal,
		status: ProposalStatus,
		result?: Proposal['result'],
		error?: string,
	): Proposal {
		const allowed = proposal.status === 'pending' || (proposal.status === 'approved' && AFTER_APPROVED.includes(status))
		if (!allowed) {
			throw new Error(`Proposal ${proposal.id} is already ${proposal.status}`)
		}
		proposal.status = status
		proposal.resolvedAt = this.now()
		if (result !== undefined) proposal.result = result
		if (error !== undefined) proposal.error = error
		this.notify(proposal)
		return { ...proposal }
	}

	/** Lazy expiry — cheaper than a background timer and nothing keeps the process alive. */
	private sweep(): void {
		const now = this.now()
		const cutoff = now - this.ttlMs
		for (const [id, proposal] of this.proposals) {
			if (proposal.status === 'pending') {
				if (proposal.createdAt > cutoff) continue
				proposal.status = 'expired'
				proposal.resolvedAt = now
				this.notify(proposal)
				continue
			}
			// Resolved proposals are kept only long enough for the CLI to read the outcome
			if ((proposal.resolvedAt ?? proposal.createdAt) <= cutoff) this.proposals.delete(id)
		}
		this.evictOverflow()
	}

	/** A caller submitting proposals in a loop must not grow this map without bound. */
	private evictOverflow(): void {
		if (this.proposals.size <= MAX_PROPOSALS) return
		// Map preserves insertion order, so the oldest resolved entries come first
		for (const [id, proposal] of this.proposals) {
			if (this.proposals.size <= MAX_PROPOSALS) return
			if (!isSettled(proposal.status)) continue
			this.proposals.delete(id)
		}
	}

	/**
	 * Observe every state change, including expiry. The app uses this to invalidate an
	 * approval banner whose proposal was resolved behind its back.
	 */
	onChange(observer: (proposal: Proposal) => void): () => void {
		this.observers.add(observer)
		return () => this.observers.delete(observer)
	}

	private notify(proposal: Proposal): void {
		for (const observer of [...this.observers]) observer({ ...proposal })
		const waiters = this.waiters.get(proposal.id)
		if (!waiters) return
		for (const waiter of [...waiters]) waiter(proposal)
	}

	private addWaiter(id: string, waiter: Waiter): void {
		const existing = this.waiters.get(id)
		if (existing) {
			existing.add(waiter)
			return
		}
		this.waiters.set(id, new Set([waiter]))
	}

	private removeWaiter(id: string, waiter: Waiter): void {
		const waiters = this.waiters.get(id)
		if (!waiters) return
		waiters.delete(waiter)
		if (waiters.size === 0) this.waiters.delete(id)
	}

	private assertUsable(): void {
		if (this.disposed) throw new Error('ProposalStore has been disposed')
	}
}
