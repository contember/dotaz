import { approvalsCommand } from './approvals'
import { describeCommand } from './describe'
import { explainCommand } from './explain'
import { historyCommand } from './history'
import { lsCommand } from './ls'
import { proposeCommand } from './propose'
import { queryCommand } from './query'
import { rowsCommand } from './rows'
import { searchCommand } from './search'
import { statusCommand } from './status'
import type { Command } from './types'
import { uiCommand } from './ui'

export const COMMANDS: Record<string, Command> = {
	status: statusCommand,
	ls: lsCommand,
	describe: describeCommand,
	rows: rowsCommand,
	query: queryCommand,
	explain: explainCommand,
	search: searchCommand,
	history: historyCommand,
	propose: proposeCommand,
	approvals: approvalsCommand,
	ui: uiCommand,
}

export function findCommand(name: string): Command | undefined {
	return COMMANDS[name]
}
