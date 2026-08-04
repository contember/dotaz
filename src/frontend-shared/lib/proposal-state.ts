// Pure decision logic for CLI write proposals (see docs/agent-cli.md).
//
// Deliberately free of store imports so it stays unit-testable — and so importing it does not
// drag the tab store into a test that only wants these functions.

import type { Proposal, ProposalStatus } from '@dotaz/shared/types/rpc'

/**
 * Where a proposal is in the approve/reject flow. `resolved` keeps the outcome on screen;
 * `invalidated` marks a proposal that left `pending` without this window resolving it.
 */
export type ProposalPhase = 'pending' | 'checking' | 'running' | 'resolved' | 'invalidated'

/** The backend no longer knows this proposal — cancelled and swept, or from a previous run. */
export const PROPOSAL_GONE_REASON = 'This proposal no longer exists — the agent may have cancelled it. Nothing was run.'

/** The proposal was settled somewhere else while this banner was still offering it. */
export const PROPOSAL_ALREADY_RESOLVED_REASON = 'This proposal was already resolved outside this window.'

/** Banner copy for a proposal that left `pending` without this window doing it. */
export function invalidationReason(status: Exclude<ProposalStatus, 'pending'>): string {
	switch (status) {
		case 'cancelled':
			return 'The agent cancelled this proposal. Nothing was run.'
		case 'expired':
			return 'This proposal expired after an hour without approval. Nothing was run.'
		case 'rejected':
			return 'This proposal was rejected in another window.'
		case 'approved':
			return 'This proposal was already approved in another window.'
		case 'executed':
			return 'This proposal was already executed in another window.'
		case 'failed':
			return 'This proposal was already run in another window, and it failed.'
	}
}

/** What an incoming `cli.proposal` message means for this window. */
export type ProposalMessageAction =
	| { kind: 'ignore' }
	| { kind: 'open' }
	| { kind: 'focus' }
	| { kind: 'invalidate'; reason: string }

/**
 * Decide what a proposal state change does to the app's own state. The backend reports every
 * transition — creation, resolution, cancellation and expiry — so most of them are not ours.
 */
export function decideProposalMessage(entry: { phase: ProposalPhase } | undefined, proposal: Proposal): ProposalMessageAction {
	if (proposal.status === 'pending') return entry ? { kind: 'focus' } : { kind: 'open' }
	// A proposal this window never opened is not its business — no tab, no banner.
	if (!entry) return { kind: 'ignore' }
	switch (entry.phase) {
		case 'running':
			// The statement is already in flight; its real outcome settles the proposal.
			return { kind: 'ignore' }
		case 'resolved':
		case 'invalidated':
			// Already terminal — never overwrite an outcome this window produced.
			return { kind: 'ignore' }
		case 'pending':
		case 'checking':
			return { kind: 'invalidate', reason: invalidationReason(proposal.status) }
	}
}

/** The backend refuses to touch a proposal that already left `pending` — expected, not a failure. */
const STALE_PROPOSAL_ERROR = /Proposal (?:.+ is already (?:approved|rejected|executed|failed|cancelled|expired)|not found)/i

export function isStaleProposalError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err)
	return STALE_PROPOSAL_ERROR.test(message)
}
