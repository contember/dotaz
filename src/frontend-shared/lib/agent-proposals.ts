// Pure helpers for CLI write proposals (see docs/agent-cli.md).

import type { QueryResult } from '@dotaz/shared/types/query'

export interface ProposalRunOutcome {
	status: 'executed' | 'failed'
	result: { affectedRows: number; statements: number }
	error?: string
}

/**
 * Reduce the result sets of an approved proposal run into the shape the CLI expects.
 * A per-statement error fails the whole proposal — the agent must not read a partial
 * failure as success.
 */
export function summarizeProposalRun(results: QueryResult[]): ProposalRunOutcome {
	let affectedRows = 0
	for (const result of results) {
		affectedRows += result.affectedRows ?? 0
	}
	const failed = results.find((r) => r.error)
	return {
		status: failed ? 'failed' : 'executed',
		result: { affectedRows, statements: results.length },
		...(failed ? { error: failed.error } : {}),
	}
}

/** Tab title for a proposal console — must read as "an agent wrote this". */
export function proposalTabTitle(label: string): string {
	return `Agent SQL — ${label}`
}
