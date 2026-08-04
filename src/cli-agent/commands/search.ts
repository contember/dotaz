import type { SearchScope } from '@dotaz/shared/types/rpc'
import { flagNumber, flagString, flagStrings, requirePositiveInt } from '../args'
import { decodeSearchResult } from '../decode'
import { usageError } from '../errors'
import { formatCell } from '../format'
import { resolveScope } from '../paths'
import type { Command } from './types'

/** The CLI spells the table scope in the singular; the RPC surface uses `tables`. */
function parseScope(raw: string | undefined): SearchScope {
	switch (raw ?? 'database') {
		case 'database':
			return 'database'
		case 'schema':
			return 'schema'
		case 'table':
		case 'tables':
			return 'tables'
		default:
			throw usageError(`Unknown --scope "${raw}" (expected database, schema or table)`)
	}
}

export const searchCommand: Command = {
	name: 'search',
	flags: {
		scope: { kind: 'string', placeholder: '<scope>', description: 'database (default), schema or table' },
		schema: { kind: 'string', placeholder: '<name>', description: 'Schema to search when --scope schema' },
		table: { kind: 'strings', placeholder: '<name>', description: 'Table to search when --scope table (repeatable)' },
		'per-table': { kind: 'number', placeholder: '<n>', description: 'Maximum matches per table' },
	},
	help: {
		usage: 'search <connection[/database]> <term> [--scope database|schema|table]',
		summary: 'search for a value across tables',
	},
	async run(ctx) {
		const [scopePath, term, ...extra] = ctx.args.positionals
		if (!scopePath || !term) throw usageError('search requires a connection path and a term', 'Example: dotaz search prod "acme"')
		if (extra.length > 0) throw usageError('search takes exactly one term — quote it')

		const scope = parseScope(flagString(ctx.args, 'scope'))
		const schemaName = flagString(ctx.args, 'schema')
		const tableNames = flagStrings(ctx.args, 'table')
		if (scope === 'schema' && !schemaName) throw usageError('--scope schema requires --schema <name>')
		if (scope === 'tables' && tableNames.length === 0) throw usageError('--scope table requires at least one --table <name>')

		const resolved = await resolveScope(scopePath, ctx.app)
		const result = await ctx.app.withReadOnlySession(resolved.connection.id, resolved.database, async (sessionId) => {
			return decodeSearchResult(
				await ctx.client.call('search.searchDatabase', {
					connectionId: resolved.connection.id,
					database: resolved.database,
					sessionId,
					searchTerm: term,
					scope,
					schemaName,
					tableNames: tableNames.length > 0 ? tableNames : undefined,
					resultsPerTable: requirePositiveInt('per-table', flagNumber(ctx.args, 'per-table')),
				}),
			)
		})

		const rows = result.matches.map((match) => ({
			schema: match.schema,
			table: match.table,
			column: match.column,
			value: formatCell(match.row[match.column]),
			row: formatCell(match.row),
		}))

		const notes = [`${result.totalMatches} match(es) across ${result.searchedTables} table(s) in ${result.elapsedMs}ms`]
		if (result.cancelled) notes.push('search was cancelled before it finished')

		return {
			output: {
				sections: [{
					columns: [{ name: 'schema' }, { name: 'table' }, { name: 'column' }, { name: 'value' }, { name: 'row' }],
					rows,
					empty: '(no matches)',
				}],
				json: {
					// Named `rows` so the --max-bytes cap knows which array it may shorten
					rows: result.matches,
					searchedTables: result.searchedTables,
					totalMatches: result.totalMatches,
					cancelled: result.cancelled,
					elapsedMs: result.elapsedMs,
				},
				notes,
			},
		}
	},
}
