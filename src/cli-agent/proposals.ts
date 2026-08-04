// Proposal helpers shared by `propose` and `approvals` — including the status → exit code map.

import type { Proposal, ProposalStatus } from '@dotaz/shared/types/rpc'
import type { CallOptions } from './client'
import { ConnectionLostError } from './client'
import { decodeProposal } from './decode'
import { CliError, EXIT, type ExitCode } from './errors'
import type { CommandOutput } from './output'

export const DEFAULT_WAIT_SECONDS = 300

/** One long-poll slice. The backend clamps its own wait, so we re-issue until the deadline. */
export const WAIT_SLICE_MS = 30_000

/** Extra HTTP budget on top of the long-poll window, so the socket never aborts first. */
const WAIT_SLACK_MS = 5_000

export function exitCodeForProposal(status: ProposalStatus): ExitCode {
	switch (status) {
		case 'executed':
			return EXIT.ok
		case 'failed':
			return EXIT.database
		case 'rejected':
		case 'cancelled':
			return EXIT.rejected
		case 'pending':
		case 'approved':
		case 'expired':
			return EXIT.pending
	}
}

export function proposalNote(proposal: Proposal): string {
	switch (proposal.status) {
		case 'pending':
			return `Proposal ${proposal.id} is waiting for approval in the Dotaz window.`
		case 'approved':
			return `Proposal ${proposal.id} was approved but has not finished executing yet.`
		case 'executed':
			return `Proposal ${proposal.id} was executed (${proposal.result?.affectedRows ?? 0} row(s) affected).`
		case 'failed':
			return `Proposal ${proposal.id} failed: ${proposal.error ?? 'unknown error'}`
		case 'rejected':
			return `Proposal ${proposal.id} was rejected by the user.`
		case 'cancelled':
			return `Proposal ${proposal.id} was cancelled.`
		case 'expired':
			return `Proposal ${proposal.id} expired without a decision.`
	}
}

export function proposalOutput(proposal: Proposal): CommandOutput {
	const row = {
		id: proposal.id,
		status: proposal.status,
		connectionId: proposal.connectionId,
		database: proposal.database ?? null,
		reason: proposal.reason ?? null,
		createdAt: new Date(proposal.createdAt).toISOString(),
		resolvedAt: proposal.resolvedAt ? new Date(proposal.resolvedAt).toISOString() : null,
		affectedRows: proposal.result?.affectedRows ?? null,
		error: proposal.error ?? null,
		sql: proposal.sql,
	}
	return {
		sections: [{ kind: 'kv', columns: Object.keys(row).map((name) => ({ name })), rows: [row] }],
		json: proposal,
		notes: [proposalNote(proposal)],
	}
}

/** Just enough of `DotazClient` to poll with — a narrow surface keeps the wait testable. */
export interface ProposalPoller {
	call(method: string, params?: unknown, opts?: CallOptions): Promise<unknown>
}

/**
 * Proposals only ever live in the app's memory, so an app that quits takes them with it.
 * That is a different answer from "the user has not decided yet" and deserves its own message.
 */
function appClosedError(proposalId: string): CliError {
	return new CliError(
		EXIT.notRunning,
		`Dotaz closed while proposal ${proposalId} was still pending — the proposal is gone.`,
		'Proposals are never persisted. Start Dotaz again and submit the write with `dotaz propose`.',
	)
}

/**
 * Long-poll until the proposal leaves `pending` or the deadline passes.
 * Returns the last known proposal either way — the caller maps status to an exit code.
 */
export async function waitForProposal(client: ProposalPoller, proposalId: string, timeoutMs: number): Promise<Proposal> {
	const deadline = Date.now() + timeoutMs
	let proposal = decodeProposal(await client.call('agent.proposals.get', { proposalId }))

	while (proposal.status === 'pending') {
		const remaining = deadline - Date.now()
		if (remaining <= 0) break
		const slice = Math.min(remaining, WAIT_SLICE_MS)
		try {
			proposal = decodeProposal(
				await client.call('agent.proposals.wait', { proposalId, timeoutMs: slice }, { timeoutMs: slice + WAIT_SLACK_MS }),
			)
		} catch (err) {
			// The app answered a moment ago, so a dead socket now means it quit under us
			if (err instanceof ConnectionLostError) throw appClosedError(proposalId)
			throw err
		}
	}

	return proposal
}
