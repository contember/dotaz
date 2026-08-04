import { flagBool } from '../args'
import { executeQuery } from '../client'
import { decodeQueryResults } from '../decode'
import { databaseError, usageError } from '../errors'
import { resolveScope } from '../paths'
import { firstResultError, queryResultJson, queryResultSections } from '../query-output'
import { buildExplainSql } from '../sql'
import type { Command } from './types'

export const explainCommand: Command = {
	name: 'explain',
	flags: {
		analyze: { kind: 'boolean', description: 'Execute the statement and report actual timings (not supported on SQLite)' },
	},
	help: {
		usage: 'explain <connection[/database]> <sql> [--analyze]',
		summary: 'show the query plan for a statement',
		notes: ['--analyze really runs the statement — the read-only session still blocks writes.'],
	},
	async run(ctx) {
		const [scopePath, sql, ...extra] = ctx.args.positionals
		if (!scopePath || !sql) {
			throw usageError('explain requires a connection path and SQL', 'Example: dotaz explain prod "SELECT * FROM orders WHERE id = 1"')
		}
		if (extra.length > 0) throw usageError('explain takes exactly one SQL string — quote it')

		const scope = await resolveScope(scopePath, ctx.app)
		const explainSql = buildExplainSql(scope.connection.type, sql, flagBool(ctx.args, 'analyze'))

		const results = await ctx.app.withReadOnlySession(scope.connection.id, scope.database, async (sessionId) => {
			return decodeQueryResults(
				await executeQuery(ctx.client, {
					connectionId: scope.connection.id,
					database: scope.database,
					sessionId,
					sql: explainSql,
				}),
			)
		})

		const failure = firstResultError(results)
		if (failure) throw databaseError(failure)

		return {
			output: {
				sections: queryResultSections(results),
				json: { sql: explainSql, ...queryResultJson(results) },
				notes: [explainSql],
			},
		}
	},
}
