import { flagNumber, flagString, requireNonNegativeInt, requirePositiveInt } from '../args'
import { executeQuery } from '../client'
import { decodeQueryResults } from '../decode'
import { databaseError, usageError } from '../errors'
import { requireTable, resolvePath } from '../paths'
import { firstResultError, queryNotes, queryResultJson, queryResultSections } from '../query-output'
import { buildRowsQuery, dialectFor, parseColumnList, parseOrderBy } from '../sql'
import type { Command } from './types'

export const DEFAULT_ROW_LIMIT = 50

export const rowsCommand: Command = {
	name: 'rows',
	flags: {
		where: { kind: 'string', placeholder: '<sql>', description: 'Raw SQL boolean expression, inserted verbatim into WHERE (…)' },
		order: { kind: 'string', placeholder: '<spec>', description: 'Sort spec, e.g. "created_at:desc,id" (identifiers are quoted)' },
		limit: { kind: 'number', placeholder: '<n>', description: `Maximum rows to read (default ${DEFAULT_ROW_LIMIT})` },
		offset: { kind: 'number', placeholder: '<n>', description: 'Rows to skip (default 0)' },
		columns: { kind: 'string', placeholder: '<list>', description: 'Comma-separated column list (default all columns)' },
	},
	help: {
		usage: 'rows <connection[/database][/schema]/table> [options]',
		summary: 'read rows from a table through a read-only session',
		notes: [
			'--where is passed to the database verbatim — it is the one place the CLI does not quote',
			'for you. Everything else (table, schema, columns, sort keys) uses dialect quoting.',
		],
	},
	async run(ctx) {
		const [path, ...extra] = ctx.args.positionals
		if (!path) throw usageError('rows requires a table path', 'Example: dotaz rows prod/app/public/orders --limit 20')
		if (extra.length > 0) throw usageError('rows takes exactly one path')

		const resolved = requireTable(await resolvePath(path, ctx.app), path)
		const limit = requirePositiveInt('limit', flagNumber(ctx.args, 'limit')) ?? DEFAULT_ROW_LIMIT
		const offset = requireNonNegativeInt('offset', flagNumber(ctx.args, 'offset')) ?? 0

		const { sql, params } = buildRowsQuery({
			schema: resolved.schema,
			table: resolved.table,
			dialect: dialectFor(resolved.connection.type),
			columns: parseColumnList(flagString(ctx.args, 'columns')),
			where: flagString(ctx.args, 'where'),
			sort: parseOrderBy(flagString(ctx.args, 'order')),
			limit,
			offset,
		})

		const results = decodeQueryResults(
			await executeQuery(ctx.client, {
				connectionId: resolved.connection.id,
				database: resolved.database,
				sql,
				params,
			}),
		)

		const failure = firstResultError(results)
		if (failure) throw databaseError(failure)

		return {
			output: {
				sections: queryResultSections(results),
				json: { sql, ...queryResultJson(results) },
				notes: [sql, ...queryNotes(results)],
			},
		}
	},
}
