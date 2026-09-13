import { flagNumber, flagString, requirePositiveInt } from '../args'
import { decodeHistory } from '../decode'
import { usageError } from '../errors'
import { resolveConnectionRef } from '../paths'
import type { Command } from './types'

export const DEFAULT_HISTORY_LIMIT = 20

export const historyCommand: Command = {
	name: 'history',
	flags: {
		conn: { kind: 'string', placeholder: '<connection>', description: 'Only entries for this connection' },
		limit: { kind: 'number', placeholder: '<n>', description: `Maximum entries (default ${DEFAULT_HISTORY_LIMIT})` },
		search: { kind: 'string', placeholder: '<text>', description: 'Only entries whose SQL contains this text' },
	},
	help: {
		usage: 'history [--conn <connection>] [--limit n]',
		summary: 'list queries recently executed in the app',
	},
	async run(ctx) {
		if (ctx.args.positionals.length > 0) throw usageError('history takes no positional arguments')

		const connRef = flagString(ctx.args, 'conn')
		const connection = connRef ? resolveConnectionRef(await ctx.app.listConnections(), connRef) : undefined
		const limit = requirePositiveInt('limit', flagNumber(ctx.args, 'limit')) ?? DEFAULT_HISTORY_LIMIT

		const entries = decodeHistory(
			await ctx.client.call('history.list', { connectionId: connection?.id, limit, search: flagString(ctx.args, 'search') }),
		)

		const names = new Map((await ctx.app.listConnections()).map((c) => [c.id, c.name]))
		const rows = entries.map((entry) => ({
			id: entry.id,
			executedAt: entry.executedAt,
			connection: names.get(entry.connectionId) ?? entry.connectionId,
			database: entry.database ?? null,
			status: entry.status,
			ms: entry.durationMs ?? null,
			rows: entry.rowCount ?? null,
			sql: entry.sql,
		}))

		return {
			output: {
				sections: [{
					columns: [{ name: 'id' }, { name: 'executedAt' }, { name: 'connection' }, { name: 'status' }, { name: 'ms' }, { name: 'rows' }, {
						name: 'sql',
					}],
					rows,
					empty: '(no history)',
				}],
				json: { rows: entries },
			},
		}
	},
}
