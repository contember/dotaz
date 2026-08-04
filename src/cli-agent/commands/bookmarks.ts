import type { QueryBookmark } from '@dotaz/shared/types/rpc'
import { flagString } from '../args'
import { isRecord } from '../decode'
import { databaseError, usageError } from '../errors'
import { resolveConnectionRef } from '../paths'
import type { Command } from './types'

const SUBCOMMANDS = ['list'] as const

function str(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback
}

function optStr(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function decodeBookmarks(payload: unknown): QueryBookmark[] {
	if (!Array.isArray(payload)) throw databaseError('Dotaz returned an unexpected payload for bookmarks.list')
	return payload.map((entry) => {
		const obj = isRecord(entry) ? entry : {}
		return {
			id: str(obj.id),
			connectionId: str(obj.connectionId),
			database: optStr(obj.database),
			name: str(obj.name),
			description: str(obj.description),
			sql: str(obj.sql),
			createdAt: str(obj.createdAt),
			updatedAt: str(obj.updatedAt),
		}
	}).filter((bookmark) => bookmark.id.length > 0)
}

export const bookmarksCommand: Command = {
	name: 'bookmarks',
	flags: {
		conn: { kind: 'string', placeholder: '<connection>', description: 'Only bookmarks of this connection' },
		search: { kind: 'string', placeholder: '<text>', description: 'Only bookmarks whose name or SQL contains this text' },
	},
	help: {
		usage: 'bookmarks list [--conn <connection>] [--search <text>]',
		summary: 'list the queries the user saved in the app',
		notes: ['Bookmarks belong to a connection; without --conn every connection is asked in turn.'],
	},
	async run(ctx) {
		const [sub, ...extra] = ctx.args.positionals
		if (!sub) throw usageError(`bookmarks requires a subcommand (${SUBCOMMANDS.join(', ')})`)
		if (sub !== 'list') throw usageError(`Unknown bookmarks subcommand "${sub}"`, `Expected one of: ${SUBCOMMANDS.join(', ')}`)
		if (extra.length > 0) throw usageError('bookmarks list takes no positional arguments')

		const connections = await ctx.app.listConnections()
		const connRef = flagString(ctx.args, 'conn')
		// bookmarks.list is per connection — fan out so a bare `bookmarks list` still shows everything
		const targets = connRef ? [resolveConnectionRef(connections, connRef)] : connections
		const search = flagString(ctx.args, 'search')

		const bookmarks: QueryBookmark[] = []
		for (const connection of targets) {
			bookmarks.push(...decodeBookmarks(await ctx.client.call('bookmarks.list', { connectionId: connection.id, search })))
		}

		const names = new Map(connections.map((c) => [c.id, c.name]))
		const rows = bookmarks.map((bookmark) => ({
			id: bookmark.id,
			name: bookmark.name,
			connection: names.get(bookmark.connectionId) ?? bookmark.connectionId,
			database: bookmark.database ?? null,
			updatedAt: bookmark.updatedAt,
			sql: bookmark.sql,
		}))

		return {
			output: {
				sections: [{
					columns: [{ name: 'id' }, { name: 'name' }, { name: 'connection' }, { name: 'database' }, { name: 'updatedAt' }, { name: 'sql' }],
					rows,
					empty: '(no bookmarks)',
				}],
				json: { rows: bookmarks },
			},
		}
	},
}
