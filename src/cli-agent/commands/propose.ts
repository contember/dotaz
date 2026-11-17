import { flagOptionalNumber, flagString } from '../args'
import { decodeProposal, decodeProposalId } from '../decode'
import { EXIT, usageError } from '../errors'
import { resolveScope } from '../paths'
import { DEFAULT_WAIT_SECONDS, exitCodeForProposal, proposalOutput, waitForProposal } from '../proposals'
import type { Command } from './types'

/** Environment fallback for `--by`, so a supervisor can label every proposal its agents make. */
const REQUESTED_BY_ENV = 'DOTAZ_REQUESTED_BY'

export const proposeCommand: Command = {
	name: 'propose',
	flags: {
		reason: { kind: 'string', placeholder: '<text>', description: 'Why the write is needed — shown to the user' },
		by: {
			kind: 'string',
			placeholder: '<label>',
			description: `Who is asking, shown to the approver as unverified (default $${REQUESTED_BY_ENV})`,
		},
		wait: { kind: 'optionalNumber', placeholder: '[sec]', description: `Block until the user decides (default ${DEFAULT_WAIT_SECONDS}s)` },
	},
	help: {
		usage: 'propose <connection[/database]> <sql> [--reason text] [--by label] [--wait [sec]]',
		summary: 'submit a write for the user to approve in the app',
		notes: [
			'The CLI never executes writes. Without --wait it prints the proposal id and exits 7.',
			'Exit codes: 0 executed · 3 failed during execution · 7 still pending · 8 rejected.',
		],
	},
	async run(ctx) {
		const [scopePath, sql, ...extra] = ctx.args.positionals
		if (!scopePath || !sql) {
			throw usageError('propose requires a connection path and SQL', 'Example: dotaz propose prod "UPDATE orders SET status=\'paid\' WHERE id=42"')
		}
		if (extra.length > 0) throw usageError('propose takes exactly one SQL string — quote it')

		const scope = await resolveScope(scopePath, ctx.app)
		const proposalId = decodeProposalId(
			await ctx.client.call('agent.proposeWrite', {
				connectionId: scope.connection.id,
				database: scope.database,
				sql,
				reason: flagString(ctx.args, 'reason'),
				requestedBy: flagString(ctx.args, 'by') ?? (process.env[REQUESTED_BY_ENV] || undefined),
			}),
		)

		const wait = flagOptionalNumber(ctx.args, 'wait')
		if (!wait.present) {
			const proposal = decodeProposal(await ctx.client.call('agent.proposals.get', { proposalId }))
			const output = proposalOutput(proposal)
			output.notes = [
				...(output.notes ?? []),
				`Waiting for the user: dotaz approvals wait ${proposalId}`,
			]
			return { output, exitCode: EXIT.pending }
		}

		const seconds = wait.value ?? DEFAULT_WAIT_SECONDS
		if (seconds <= 0) throw usageError('--wait needs a positive number of seconds')
		const proposal = await waitForProposal(ctx.client, proposalId, seconds * 1000)
		return { output: proposalOutput(proposal), exitCode: exitCodeForProposal(proposal.status) }
	},
}
