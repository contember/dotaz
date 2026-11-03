import type { FlagSpecs, ParsedArgs } from '../args'
import type { DotazClient } from '../client'
import type { AppContext } from '../context'
import type { EndpointSource } from '../endpoint'
import type { ExitCode } from '../errors'
import type { CommandHelp } from '../help'
import type { CommandOutput, OutputOptions } from '../output'

export interface CommandContext {
	args: ParsedArgs
	output: OutputOptions
	client: DotazClient
	app: AppContext
	endpoint: EndpointSource
}

export interface CommandResult {
	output: CommandOutput
	/** Defaults to 0 — set by commands that report state through the exit code. */
	exitCode?: ExitCode
}

export interface Command {
	name: string
	help: CommandHelp
	flags: FlagSpecs
	run(ctx: CommandContext): Promise<CommandResult>
}
