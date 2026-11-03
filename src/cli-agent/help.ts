// Help text. Kept in one place so `--help` and the per-command help stay in sync.

import type { FlagSpecs } from './args'

export const GLOBAL_FLAGS: FlagSpecs = {
	json: { kind: 'boolean', description: 'Shorthand for --format json' },
	format: { kind: 'string', placeholder: '<fmt>', description: 'Output format: table (default), json, jsonl, csv, md' },
	'max-bytes': { kind: 'number', placeholder: '<n>', description: 'Cap row output at n bytes (default 65536)' },
	timeout: { kind: 'number', placeholder: '<ms>', description: 'RPC timeout in milliseconds (default 30000)' },
	endpoint: { kind: 'string', placeholder: '<file>', description: 'Path to an endpoint file (or set DOTAZ_ENDPOINT)' },
	instance: { kind: 'number', placeholder: '<pid>', description: 'Talk to a specific running Dotaz instance' },
	quiet: { kind: 'boolean', alias: 'q', description: 'Suppress diagnostics on stderr' },
	help: { kind: 'boolean', alias: 'h', description: 'Show help for this command' },
	version: { kind: 'boolean', alias: 'V', description: 'Print the CLI version' },
}

export interface CommandHelp {
	usage: string
	summary: string
	flags?: FlagSpecs
	notes?: string[]
}

function renderFlags(flags: FlagSpecs): string[] {
	const entries = Object.entries(flags).map(([name, spec]) => {
		const alias = spec.alias ? `-${spec.alias}, ` : '    '
		const value = spec.placeholder ? ` ${spec.placeholder}` : ''
		return [`  ${alias}--${name}${value}`, spec.description]
	})
	const width = Math.max(...entries.map(([left]) => left.length))
	return entries.map(([left, right]) => `${left.padEnd(width)}  ${right}`)
}

export function renderCommandHelp(name: string, help: CommandHelp): string {
	const lines = [`dotaz ${name} — ${help.summary}`, '', `Usage: dotaz ${help.usage}`]
	if (help.flags && Object.keys(help.flags).length > 0) {
		lines.push('', 'Options:', ...renderFlags(help.flags))
	}
	lines.push('', 'Global options:', ...renderFlags(GLOBAL_FLAGS))
	if (help.notes && help.notes.length > 0) lines.push('', ...help.notes)
	return `${lines.join('\n')}\n`
}

const COMMAND_SUMMARY: [string, string][] = [
	['status', 'Is the app running, is CLI access enabled'],
	['ls [path]', 'Connections → databases → schemas → tables'],
	['describe <path>', 'Columns, primary key, indexes, foreign keys both ways'],
	['rows <path>', 'Read rows from a table'],
	['query <conn[/db]> <sql>', 'Run a read-only query'],
	['explain <conn[/db]> <sql>', 'Show the query plan'],
	['search <conn[/db]> <term>', 'Search values across tables'],
	['history', 'Recent queries executed in the app'],
	['bookmarks list', 'Queries the user saved in the app'],
	['propose <conn[/db]> <sql>', 'Submit a write for the user to approve'],
	['approvals <sub>', 'list | status <id> | wait <id> | cancel <id>'],
	['ui <sub>', 'state | open <path> | console <conn[/db]> | command <id>'],
]

export function renderRootHelp(version: string): string {
	const width = Math.max(...COMMAND_SUMMARY.map(([usage]) => usage.length))
	return [
		`dotaz ${version} — command-line client for the running Dotaz desktop app`,
		'',
		'Usage: dotaz <command> [options]',
		'',
		'Commands:',
		...COMMAND_SUMMARY.map(([usage, summary]) => `  ${usage.padEnd(width)}  ${summary}`),
		'',
		'Global options:',
		...renderFlags(GLOBAL_FLAGS),
		'',
		'Paths address objects as connection/database/schema/table. A connection matches by id,',
		'by exact name, or by a unique case-insensitive prefix. Drivers without databases or',
		'schemas (SQLite) accept the shortened form connection/table.',
		'',
		'Exit codes: 0 ok · 2 usage · 3 database · 4 read-only (use `dotaz propose`) ·',
		'5 Dotaz not running or CLI access disabled · 6 timeout · 7 proposal pending · 8 rejected',
		'',
		'Run `dotaz <command> --help` for command-specific options.',
		'',
	].join('\n')
}
