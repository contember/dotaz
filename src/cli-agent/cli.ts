// Command dispatch. Kept apart from main.ts so the argument handling is testable without
// touching process state.

import { flagBool, flagNumber, type FlagSpecs, flagString, parseArgs, type ParsedArgs } from './args'
import { DEFAULT_TIMEOUT_MS } from './client'
import { usageError } from './errors'
import { DEFAULT_MAX_BYTES, type OutputFormat, parseFormat } from './format'
import { GLOBAL_FLAGS } from './help'
import type { OutputOptions } from './output'

export interface Invocation {
	command?: string
	args: ParsedArgs
	specs: FlagSpecs
}

function globalSpecFor(token: string): { name: string; spec: FlagSpecs[string] } | undefined {
	if (token.startsWith('--')) {
		const name = token.slice(2).split('=')[0]
		const spec = GLOBAL_FLAGS[name]
		return spec ? { name, spec } : undefined
	}
	const alias = token.slice(1)
	for (const [name, spec] of Object.entries(GLOBAL_FLAGS)) {
		if (spec.alias === alias) return { name, spec }
	}
	return undefined
}

/**
 * Pull the command name out of argv so global flags may appear before it
 * (`dotaz --json ls` as well as `dotaz ls --json`).
 */
export function extractCommand(argv: string[]): { command?: string; rest: string[] } {
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i]
		if (token === '--') break
		if (token.startsWith('-') && token.length > 1) {
			const match = globalSpecFor(token)
			// An unknown flag before the command belongs to a command we have not identified yet
			if (!match) break
			const needsValue = match.spec.kind !== 'boolean' && !token.includes('=')
			if (needsValue) i++
			continue
		}
		return { command: token, rest: [...argv.slice(0, i), ...argv.slice(i + 1)] }
	}
	return { rest: argv }
}

export function mergeSpecs(commandFlags: FlagSpecs): FlagSpecs {
	// Command flags win — `approvals wait --timeout` is seconds, not the global milliseconds
	return { ...GLOBAL_FLAGS, ...commandFlags }
}

export function outputOptions(args: ParsedArgs): OutputOptions {
	const explicit = flagString(args, 'format')
	const format: OutputFormat = explicit ? parseFormat(explicit) : flagBool(args, 'json') ? 'json' : 'table'
	const maxBytes = flagNumber(args, 'max-bytes') ?? DEFAULT_MAX_BYTES
	if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw usageError('--max-bytes must be a positive integer')
	return { format, maxBytes, quiet: flagBool(args, 'quiet') }
}

export function timeoutMs(args: ParsedArgs): number {
	const value = flagNumber(args, 'timeout')
	if (value === undefined) return DEFAULT_TIMEOUT_MS
	if (!Number.isFinite(value) || value <= 0) throw usageError('--timeout must be a positive number of milliseconds')
	return value
}

/** Split argv into the command and its parsed arguments, without contacting the app. */
export function parseInvocation(argv: string[], flagsFor: (command: string) => FlagSpecs | undefined): Invocation {
	const { command, rest } = extractCommand(argv)
	if (!command) return { args: parseArgs(rest, GLOBAL_FLAGS), specs: GLOBAL_FLAGS }

	const commandFlags = flagsFor(command)
	if (!commandFlags) throw usageError(`Unknown command "${command}"`, 'Run `dotaz --help` for the command list.')

	const specs = mergeSpecs(commandFlags)
	return { command, args: parseArgs(rest, specs), specs }
}
