// Exit codes are part of the CLI contract — see docs/agent-cli.md.

export const EXIT = {
	ok: 0,
	/** Unexpected internal failure — not part of the documented contract. */
	internal: 1,
	usage: 2,
	database: 3,
	readOnly: 4,
	notRunning: 5,
	timeout: 6,
	pending: 7,
	rejected: 8,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

export class CliError extends Error {
	readonly exitCode: ExitCode
	readonly hint?: string

	constructor(exitCode: ExitCode, message: string, hint?: string) {
		super(message)
		this.name = 'CliError'
		this.exitCode = exitCode
		this.hint = hint
	}
}

export function usageError(message: string, hint?: string): CliError {
	return new CliError(EXIT.usage, message, hint)
}

export const START_DOTAZ_HINT = 'Start Dotaz and enable Settings → Allow CLI access (or set DOTAZ_CLI=1 before launching).'

export function notRunningError(message: string): CliError {
	return new CliError(EXIT.notRunning, message, START_DOTAZ_HINT)
}

export function databaseError(message: string, hint?: string): CliError {
	return new CliError(EXIT.database, message, hint)
}

export function timeoutError(message: string): CliError {
	return new CliError(EXIT.timeout, message)
}

/** Read-only violations always point at the one supported way to write. */
export function readOnlyError(message: string): CliError {
	return new CliError(EXIT.readOnly, message, 'The CLI session is read-only. Submit the statement with `dotaz propose <conn> "<sql>"` instead.')
}

export function messageOf(err: unknown): string {
	if (err instanceof Error) return err.message
	return String(err)
}
