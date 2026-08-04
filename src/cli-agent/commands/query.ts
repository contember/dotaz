import { flagNumber, flagStrings, requirePositiveInt } from '../args'
import { executeQuery } from '../client'
import { decodeQueryResults } from '../decode'
import { databaseError, usageError } from '../errors'
import { resolveScope } from '../paths'
import { firstResultError, queryNotes, queryResultJson, queryResultSections } from '../query-output'
import { applySqlLimit, type SqlLimit } from '../sql'
import type { Command } from './types'

/** Backstop for the statements we could not rewrite — the rows arrived, we just do not print them all. */
function trimRows(rows: Record<string, unknown>[], limit: number | undefined): Record<string, unknown>[] {
	return limit === undefined ? rows : rows.slice(0, limit)
}

/** The agent has to be able to tell a truncated view from a truncated query. */
function limitNote(limit: number, applied: SqlLimit): string {
	if (applied.mode === 'sql') return `--limit ${limit} was pushed into the SQL — the database returned at most ${limit} row(s).`
	return `--limit ${limit} trimmed the printed rows only (${applied.reason}) — the database still ran the full query.`
}

export const queryCommand: Command = {
	name: 'query',
	flags: {
		param: { kind: 'strings', placeholder: '<value>', description: 'Bind a positional parameter (repeatable, values are sent as strings)' },
		limit: { kind: 'number', placeholder: '<n>', description: 'Return at most n rows (appended to the SQL when that is safe — see below)' },
	},
	help: {
		usage: 'query <connection[/database]> <sql> [--param value]… [--limit n]',
		summary: 'run a read-only query in a read-only session',
		notes: [
			'Writes are rejected by the database engine and exit with code 4 — use `dotaz propose`.',
			'',
			'--limit n has two outcomes, and the CLI always says which one you got:',
			'  · pushed into the SQL — `LIMIT n` is appended to the statement and the database returns',
			'    at most n rows. This happens only for a single read-only SELECT (or WITH … SELECT)',
			'    that does not already limit itself.',
			'  · printed rows trimmed — the SQL is sent unchanged, the database executes the whole',
			'    query and streams every row back; only the output is cut to n. This is what you get',
			'    for multi-statement input, a non-SELECT, an existing LIMIT/FETCH/TOP or OFFSET, and',
			'    for locking or INTO clauses.',
			'The outcome is stated on stderr, and under --json as `limit.appliedTo` ("sql" or "rows").',
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
		const applied = limit === undefined ? undefined : applySqlLimit(sql, limit, scope.connection.type)
		const effectiveSql = applied?.sql ?? sql

		const results = await ctx.app.withReadOnlySession(scope.connection.id, scope.database, async (sessionId) => {
			return decodeQueryResults(
				await executeQuery(ctx.client, {
					connectionId: scope.connection.id,
					database: scope.database,
					sessionId,
					sql: effectiveSql,
					params: params.length > 0 ? params : undefined,
				}),
			)
		})

		const failure = firstResultError(results)
		if (failure) throw databaseError(failure)

		const trimmed = results.map((result) => ({ ...result, rows: trimRows(result.rows, limit) }))
		const notes = queryNotes(results)
		if (limit !== undefined && applied) {
			notes.push(limitNote(limit, applied))
			if (applied.mode === 'sql') notes.push(effectiveSql)
		}

		return {
			output: {
				sections: queryResultSections(trimmed),
				json: {
					...queryResultJson(trimmed),
					...(applied ? { limit: { requested: limit, appliedTo: applied.mode, sql: effectiveSql, reason: applied.reason ?? null } } : {}),
				},
				notes,
			},
		}
	},
}
