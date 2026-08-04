import { randomUUID } from 'node:crypto'
import { flagNumber, flagStrings, requirePositiveInt } from '../args'
import { decodeQueryResults } from '../decode'
import { databaseError, usageError } from '../errors'
import { resolveScope } from '../paths'
import { firstResultError, queryNotes, queryResultJson, queryResultSections } from '../query-output'
import type { Command } from './types'

/** Trim result sets after the fact — rewriting the user's SQL to add LIMIT would change its meaning. */
function applyLimit(rows: Record<string, unknown>[], limit: number | undefined): Record<string, unknown>[] {
	return limit === undefined ? rows : rows.slice(0, limit)
}

export const queryCommand: Command = {
	name: 'query',
	flags: {
		param: { kind: 'strings', placeholder: '<value>', description: 'Bind a positional parameter (repeatable, values are sent as strings)' },
		limit: { kind: 'number', placeholder: '<n>', description: 'Print at most n rows per result set' },
	},
	help: {
		usage: 'query <connection[/database]> <sql> [--param value]… [--limit n]',
		summary: 'run a read-only query in a read-only session',
		notes: [
			'Writes are rejected by the database engine and exit with code 4 — use `dotaz propose`.',
			'--limit trims the printed rows; it does not modify the SQL you sent.',
		],
	},
	async run(ctx) {
		const [scopePath, sql, ...extra] = ctx.args.positionals
		if (!scopePath || !sql) {
			throw usageError('query requires a connection path and SQL', 'Example: dotaz query prod "SELECT count(*) FROM orders"')
		}
		if (extra.length > 0) throw usageError('query takes exactly one SQL string — quote it')

		const limit = requirePositiveInt('limit', flagNumber(ctx.args, 'limit'))
		const params = flagStrings(ctx.args, 'param')
		const scope = await resolveScope(scopePath, ctx.app)

		const results = await ctx.app.withReadOnlySession(scope.connection.id, scope.database, async (sessionId) => {
			return decodeQueryResults(
				await ctx.client.call('query.execute', {
					connectionId: scope.connection.id,
					database: scope.database,
					sessionId,
					queryId: randomUUID(),
					sql,
					params: params.length > 0 ? params : undefined,
				}),
			)
		})

		const failure = firstResultError(results)
		if (failure) throw databaseError(failure)

		const limited = results.map((result) => ({ ...result, rows: applyLimit(result.rows, limit) }))
		const notes = queryNotes(results)
		if (limit !== undefined && results.some((r) => r.rows.length > limit)) {
			notes.push(`--limit ${limit} applied to the printed rows`)
		}

		return {
			output: { sections: queryResultSections(limited), json: queryResultJson(limited), notes },
		}
	},
}
