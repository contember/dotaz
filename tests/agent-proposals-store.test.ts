import {
	decideProposalMessage,
	invalidationReason,
	isStaleProposalError,
	type ProposalPhase,
	sqlMatchesProposal,
} from '@dotaz/frontend-shared/lib/proposal-state'
import type { Proposal, ProposalStatus } from '@dotaz/shared/types/rpc'
import { describe, expect, test } from 'bun:test'

function proposal(status: ProposalStatus): Proposal {
	return { id: 'p1', connectionId: 'c1', sql: 'delete from users', status, createdAt: 1717430000000 }
}

function entry(phase: ProposalPhase): { phase: ProposalPhase } {
	return { phase }
}

describe('decideProposalMessage', () => {
	test('opens a tab for a new pending proposal', () => {
		expect(decideProposalMessage(undefined, proposal('pending'))).toEqual({ kind: 'open' })
	})

	test('focuses the existing tab when the same pending proposal arrives twice', () => {
		expect(decideProposalMessage(entry('pending'), proposal('pending'))).toEqual({ kind: 'focus' })
	})

	test('ignores a non-pending proposal the app never opened', () => {
		for (const status of ['cancelled', 'expired', 'executed', 'rejected', 'failed', 'approved'] as const) {
			expect(decideProposalMessage(undefined, proposal(status))).toEqual({ kind: 'ignore' })
		}
	})

	test('invalidates a pending banner when the agent cancels', () => {
		const action = decideProposalMessage(entry('pending'), proposal('cancelled'))
		expect(action).toEqual({ kind: 'invalidate', reason: invalidationReason('cancelled') })
	})

	test('invalidates a pending banner on expiry', () => {
		const action = decideProposalMessage(entry('pending'), proposal('expired'))
		expect(action.kind).toBe('invalidate')
		expect(action.kind === 'invalidate' && action.reason).toContain('expired')
	})

	test('invalidates a pending banner when another window resolved it', () => {
		const action = decideProposalMessage(entry('pending'), proposal('executed'))
		expect(action.kind).toBe('invalidate')
		expect(action.kind === 'invalidate' && action.reason).toContain('another window')
	})

	test('invalidates while the app is still checking whether it may run', () => {
		expect(decideProposalMessage(entry('checking'), proposal('cancelled')).kind).toBe('invalidate')
	})

	test('leaves a running entry alone — the statement is already in flight', () => {
		expect(decideProposalMessage(entry('running'), proposal('cancelled'))).toEqual({ kind: 'ignore' })
	})

	test('keeps the outcome this window produced', () => {
		expect(decideProposalMessage(entry('resolved'), proposal('cancelled'))).toEqual({ kind: 'ignore' })
		expect(decideProposalMessage(entry('resolved'), proposal('executed'))).toEqual({ kind: 'ignore' })
	})

	test('an already invalidated banner is not invalidated again', () => {
		expect(decideProposalMessage(entry('invalidated'), proposal('expired'))).toEqual({ kind: 'ignore' })
	})
})

describe('invalidationReason', () => {
	test('every terminal status gets its own copy', () => {
		const reasons = (['cancelled', 'expired', 'rejected', 'approved', 'executed', 'failed'] as const)
			.map((status) => invalidationReason(status))
		expect(new Set(reasons).size).toBe(reasons.length)
		for (const reason of reasons) expect(reason.length).toBeGreaterThan(0)
	})

	test('names the agent for a cancellation and says nothing ran', () => {
		expect(invalidationReason('cancelled')).toContain('agent cancelled')
		expect(invalidationReason('cancelled')).toContain('Nothing was run')
	})
})

describe('isStaleProposalError', () => {
	test('recognizes the backend refusing an already resolved proposal', () => {
		expect(isStaleProposalError(new Error('Proposal 7f3 is already cancelled'))).toBe(true)
		expect(isStaleProposalError(new Error('agent.proposals.resolve: Proposal 7f3 is already expired'))).toBe(true)
		expect(isStaleProposalError(new Error('Proposal 7f3 is already executed'))).toBe(true)
	})

	test('recognizes a proposal the backend no longer knows', () => {
		expect(isStaleProposalError(new Error('agent.proposals.get: Proposal not found: 7f3'))).toBe(true)
	})

	test('leaves real failures to the toast', () => {
		expect(isStaleProposalError(new Error('Failed to fetch'))).toBe(false)
		expect(isStaleProposalError(new Error('connection closed'))).toBe(false)
		expect(isStaleProposalError(undefined)).toBe(false)
	})
})

// The run listener matches on the tab alone, so this is what stops "the user ran something in
// this tab" from being reported to the agent as "your write executed".
describe('sqlMatchesProposal', () => {
	const proposed = "UPDATE orders SET status='paid' WHERE id=42"

	test('accepts the proposal SQL, including editor reformatting', () => {
		expect(sqlMatchesProposal(proposed, proposed)).toBe(true)
		expect(sqlMatchesProposal(`  ${proposed}  `, proposed)).toBe(true)
		expect(sqlMatchesProposal(`${proposed};`, proposed)).toBe(true)
		expect(sqlMatchesProposal("UPDATE orders SET status='paid'\n  WHERE id=42", proposed)).toBe(true)
	})

	test('rejects an edited buffer', () => {
		expect(sqlMatchesProposal("UPDATE orders SET status='paid' WHERE id=43", proposed)).toBe(false)
		expect(sqlMatchesProposal("UPDATE orders SET status='paid'", proposed)).toBe(false)
		expect(sqlMatchesProposal('', proposed)).toBe(false)
	})

	test('rejects one statement of a multi-statement proposal run on its own', () => {
		const multi = 'DELETE FROM a; DELETE FROM b'
		expect(sqlMatchesProposal('DELETE FROM a', multi)).toBe(false)
		expect(sqlMatchesProposal(multi, multi)).toBe(true)
	})
})
