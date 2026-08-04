import { flagBool, flagNumber, flagString, requirePositiveInt } from '../args'
import { decodeUiSnapshot } from '../decode'
import { usageError } from '../errors'
import { requireTable, resolvePath, resolveScope } from '../paths'
import type { Command, CommandContext, CommandResult } from './types'

const SUBCOMMANDS = ['state', 'open', 'console', 'command'] as const

async function state(ctx: CommandContext): Promise<CommandResult> {
	const snapshot = decodeUiSnapshot(await ctx.client.call('ui.state'))
	const names = new Map((await ctx.app.listConnections()).map((c) => [c.id, c.name]))
	const rows = snapshot.tabs.map((tab) => ({
		active: tab.id === snapshot.activeTabId,
		type: tab.type,
		title: tab.title,
		connection: names.get(tab.connectionId) ?? tab.connectionId,
		database: tab.database ?? null,
		schema: tab.schema ?? null,
		table: tab.table ?? null,
		sql: tab.sql ?? null,
	}))

	return {
		output: {
			sections: [{
				columns: [{ name: 'active' }, { name: 'type' }, { name: 'title' }, { name: 'connection' }, { name: 'database' }, { name: 'schema' }, {
					name: 'table',
				}, { name: 'sql' }],
				rows,
				empty: '(no open tabs)',
			}],
			json: snapshot,
			notes: [
				`active connection: ${snapshot.activeConnectionId ? names.get(snapshot.activeConnectionId) ?? snapshot.activeConnectionId : 'none'}`,
			],
		},
	}
}

function ok(action: string, detail: Record<string, unknown>): CommandResult {
	const row = { action, ...detail }
	return {
		output: {
			sections: [{ kind: 'kv', columns: Object.keys(row).map((name) => ({ name })), rows: [row] }],
			json: { ok: true, ...row },
		},
	}
}

export const uiCommand: Command = {
	name: 'ui',
	flags: {
		where: { kind: 'string', placeholder: '<sql>', description: 'Filter applied to the opened grid (raw SQL fragment)' },
		limit: { kind: 'number', placeholder: '<n>', description: 'Page size for the opened grid' },
		sql: { kind: 'string', placeholder: '<sql>', description: 'Prefill the SQL console with this statement' },
		run: { kind: 'boolean', description: 'Also run the prefilled SQL — read-only statements only' },
	},
	help: {
		usage: 'ui state | open <path> [--where sql] | console <conn[/db]> [--sql text] [--run] | command <command-id>',
		summary: 'read and drive what the user has open in the app',
		notes: ['`ui console --run` refuses non-read-only SQL and exits 4 — use `dotaz propose` for writes.'],
	},
	async run(ctx) {
		const [sub, target, ...extra] = ctx.args.positionals
		if (!sub) throw usageError(`ui requires a subcommand (${SUBCOMMANDS.join(', ')})`)
		if (extra.length > 0) throw usageError(`ui ${sub} takes at most one argument`)

		switch (sub) {
			case 'state':
				if (target) throw usageError('ui state takes no arguments')
				return state(ctx)

			case 'open': {
				if (!target) throw usageError('ui open requires a table path', 'Example: dotaz ui open prod/app/public/orders')
				const resolved = requireTable(await resolvePath(target, ctx.app), target)
				await ctx.client.call('ui.openTable', {
					connectionId: resolved.connection.id,
					database: resolved.database,
					schema: resolved.schema,
					table: resolved.table,
					where: flagString(ctx.args, 'where'),
					limit: requirePositiveInt('limit', flagNumber(ctx.args, 'limit')),
				})
				return ok('open-table', {
					connection: resolved.connection.name,
					database: resolved.database ?? null,
					schema: resolved.schema,
					table: resolved.table,
				})
			}

			case 'console': {
				if (!target) throw usageError('ui console requires a connection path', 'Example: dotaz ui console prod --sql "SELECT 1"')
				const scope = await resolveScope(target, ctx.app)
				const sql = flagString(ctx.args, 'sql')
				const run = flagBool(ctx.args, 'run')
				if (run && !sql) throw usageError('--run needs --sql')
				await ctx.client.call('ui.openConsole', { connectionId: scope.connection.id, database: scope.database, sql, run })
				return ok('open-console', { connection: scope.connection.name, database: scope.database ?? null, run })
			}

			case 'command': {
				if (!target) throw usageError('ui command requires a command id')
				await ctx.client.call('ui.runCommand', { commandId: target })
				return ok('run-command', { commandId: target })
			}

			default:
				throw usageError(`Unknown ui subcommand "${sub}"`, `Expected one of: ${SUBCOMMANDS.join(', ')}`)
		}
	},
}
