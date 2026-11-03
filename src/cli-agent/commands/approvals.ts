import { flagNumber, flagString } from '../args'
import { decodeProposal, decodeProposals, PROPOSAL_STATUSES } from '../decode'
import { EXIT, usageError } from '../errors'
import { resolveConnectionRef } from '../paths'
import { DEFAULT_WAIT_SECONDS, exitCodeForProposal, proposalOutput, waitForProposal } from '../proposals'
import type { Command, CommandContext, CommandResult } from './types'

const SUBCOMMANDS = ['list', 'status', 'wait', 'cancel'] as const

function sqlPreview(sql: string): string {
	return sql.replace(/\s+/g, ' ').trim()
}

async function list(ctx: CommandContext): Promise<CommandResult> {
	const status = flagString(ctx.args, 'status')
	if (status !== undefined && !PROPOSAL_STATUSES.some((s) => s === status)) {
		throw usageError(`Unknown --status "${status}"`, `Expected one of: ${PROPOSAL_STATUSES.join(', ')}`)
	}
	const connRef = flagString(ctx.args, 'conn')
	const connection = connRef ? resolveConnectionRef(await ctx.app.listConnections(), connRef) : undefined

	const proposals = decodeProposals(
		await ctx.client.call('agent.proposals.list', { status, connectionId: connection?.id }),
	)
	const names = new Map((await ctx.app.listConnections()).map((c) => [c.id, c.name]))
	const rows = proposals.map((p) => ({
		id: p.id,
		status: p.status,
		connection: names.get(p.connectionId) ?? p.connectionId,
		createdAt: new Date(p.createdAt).toISOString(),
		sql: sqlPreview(p.sql),
	}))

	return {
		output: {
			sections: [{
				columns: [{ name: 'id' }, { name: 'status' }, { name: 'connection' }, { name: 'createdAt' }, { name: 'sql' }],
				rows,
				empty: '(no proposals)',
			}],
			json: { rows: proposals },
		},
	}
}

export const approvalsCommand: Command = {
	name: 'approvals',
	flags: {
		status: { kind: 'string', placeholder: '<status>', description: 'Filter `list` by status (pending, executed, rejected, …)' },
		conn: { kind: 'string', placeholder: '<connection>', description: 'Filter `list` by connection' },
		// Named --wait like `propose --wait`; the global --timeout stays the RPC deadline
		wait: { kind: 'number', placeholder: '<sec>', description: `Seconds to block in \`wait\` (default ${DEFAULT_WAIT_SECONDS})` },
	},
	help: {
		usage: 'approvals list | status <id> | wait <id> [--wait sec] | cancel <id>',
		summary: 'inspect and wait on write proposals',
		notes: [
			'`status` and `wait` also report through the exit code: 0 executed · 3 failed · 7 pending · 8 rejected.',
		],
	},
	async run(ctx) {
		const [sub, id, ...extra] = ctx.args.positionals
		if (!sub) throw usageError(`approvals requires a subcommand (${SUBCOMMANDS.join(', ')})`)
		if (extra.length > 0) throw usageError(`approvals ${sub} takes at most one proposal id`)

		switch (sub) {
			case 'list':
				if (id) throw usageError('approvals list takes no proposal id')
				return list(ctx)

			case 'status': {
				if (!id) throw usageError('approvals status requires a proposal id')
				const proposal = decodeProposal(await ctx.client.call('agent.proposals.get', { proposalId: id }))
				return { output: proposalOutput(proposal), exitCode: exitCodeForProposal(proposal.status) }
			}

			case 'wait': {
				if (!id) throw usageError('approvals wait requires a proposal id')
				const seconds = flagNumber(ctx.args, 'wait') ?? DEFAULT_WAIT_SECONDS
				if (!(seconds > 0)) throw usageError('--wait must be a positive number of seconds')
				const proposal = await waitForProposal(ctx.client, id, seconds * 1000)
				return { output: proposalOutput(proposal), exitCode: exitCodeForProposal(proposal.status) }
			}

			case 'cancel': {
				if (!id) throw usageError('approvals cancel requires a proposal id')
				await ctx.client.call('agent.proposals.cancel', { proposalId: id })
				return {
					output: {
						sections: [{ kind: 'kv', columns: [{ name: 'id' }, { name: 'status' }], rows: [{ id, status: 'cancelled' }] }],
						json: { id, status: 'cancelled' },
					},
					exitCode: EXIT.ok,
				}
			}

			default:
				throw usageError(`Unknown approvals subcommand "${sub}"`, `Expected one of: ${SUBCOMMANDS.join(', ')}`)
		}
	},
}
