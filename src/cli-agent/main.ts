#!/usr/bin/env bun
// `dotaz` — command-line client for the running Dotaz desktop app. See docs/agent-cli.md.

import { flagBool, flagString } from './args'
import { outputOptions, parseInvocation, timeoutMs } from './cli'
import { DotazClient } from './client'
import { findCommand } from './commands'
import { AppContext } from './context'
import { discoverEndpoint } from './endpoint'
import { CliError, EXIT, type ExitCode, messageOf } from './errors'
import { renderCommandHelp, renderRootHelp } from './help'
import { renderOutput } from './output'
import pkg from './package.json'

async function write(stream: typeof Bun.stdout | typeof Bun.stderr, text: string): Promise<void> {
	if (!text) return
	try {
		await Bun.write(stream, text)
	} catch {
		// Downstream closed the pipe (`| head`) — nothing useful left to do
	}
}

async function run(argv: string[]): Promise<ExitCode> {
	const invocation = parseInvocation(argv, (name) => findCommand(name)?.flags)

	if (flagBool(invocation.args, 'version')) {
		await write(Bun.stdout, `dotaz ${pkg.version}\n`)
		return EXIT.ok
	}

	if (!invocation.command) {
		await write(Bun.stdout, renderRootHelp(pkg.version))
		// No command at all is a usage error unless help was asked for explicitly
		return flagBool(invocation.args, 'help') ? EXIT.ok : EXIT.usage
	}

	const command = findCommand(invocation.command)
	if (!command) throw new CliError(EXIT.usage, `Unknown command "${invocation.command}"`)

	if (flagBool(invocation.args, 'help')) {
		await write(Bun.stdout, renderCommandHelp(command.name, { ...command.help, flags: command.flags }))
		return EXIT.ok
	}

	const output = outputOptions(invocation.args)
	const endpoint = discoverEndpoint({ explicitFile: flagString(invocation.args, 'endpoint') })
	const client = new DotazClient(endpoint.endpoint, timeoutMs(invocation.args))
	const app = new AppContext(client)

	const result = await command.run({ args: invocation.args, output, client, app, endpoint })
	const rendered = renderOutput(result.output, output)
	await write(Bun.stdout, rendered.stdout)
	await write(Bun.stderr, rendered.stderr)
	return result.exitCode ?? EXIT.ok
}

let exitCode: ExitCode = EXIT.ok
try {
	exitCode = await run(process.argv.slice(2))
} catch (err) {
	if (err instanceof CliError) {
		await write(Bun.stderr, `dotaz: ${err.message}\n`)
		if (err.hint) await write(Bun.stderr, `${err.hint}\n`)
		else if (err.exitCode === EXIT.usage) await write(Bun.stderr, 'Run `dotaz --help` for usage.\n')
		exitCode = err.exitCode
	} else {
		await write(Bun.stderr, `dotaz: unexpected error: ${messageOf(err)}\n`)
		exitCode = EXIT.internal
	}
}

process.exit(exitCode)
