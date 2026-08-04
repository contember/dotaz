import { describe, expect, test } from 'bun:test'
import {
	flagBool,
	flagNumber,
	flagOptionalNumber,
	flagString,
	flagStrings,
	parseArgs,
	requireNonNegativeInt,
	requirePositiveInt,
} from '../src/cli-agent/args'
import { extractCommand, outputOptions, parseInvocation, timeoutMs } from '../src/cli-agent/cli'
import { findCommand } from '../src/cli-agent/commands'
import { CliError, EXIT } from '../src/cli-agent/errors'

const SPECS = {
	where: { kind: 'string' as const, description: '' },
	limit: { kind: 'number' as const, description: '' },
	param: { kind: 'strings' as const, description: '' },
	analyze: { kind: 'boolean' as const, description: '' },
	wait: { kind: 'optionalNumber' as const, description: '' },
	quiet: { kind: 'boolean' as const, alias: 'q', description: '' },
	format: { kind: 'string' as const, alias: 'f', description: '' },
}

function exitCodeOf(fn: () => unknown): number | undefined {
	try {
		fn()
		return undefined
	} catch (err) {
		return err instanceof CliError ? err.exitCode : undefined
	}
}

describe('parseArgs', () => {
	test('collects positionals in order', () => {
		const args = parseArgs(['prod/app', 'SELECT 1'], SPECS)
		expect(args.positionals).toEqual(['prod/app', 'SELECT 1'])
	})

	test('reads string flags in both spellings', () => {
		expect(flagString(parseArgs(['--where', "a='b'"], SPECS), 'where')).toBe("a='b'")
		expect(flagString(parseArgs(["--where=a='b'"], SPECS), 'where')).toBe("a='b'")
	})

	test('reads number flags and rejects non-numbers', () => {
		expect(flagNumber(parseArgs(['--limit', '20'], SPECS), 'limit')).toBe(20)
		expect(exitCodeOf(() => parseArgs(['--limit', 'twenty'], SPECS))).toBe(EXIT.usage)
	})

	test('repeatable flags accumulate', () => {
		expect(flagStrings(parseArgs(['--param', 'a', '--param', 'b'], SPECS), 'param')).toEqual(['a', 'b'])
	})

	test('boolean flags need no value', () => {
		expect(flagBool(parseArgs(['--analyze'], SPECS), 'analyze')).toBe(true)
		expect(flagBool(parseArgs([], SPECS), 'analyze')).toBe(false)
		expect(flagBool(parseArgs(['--analyze=false'], SPECS), 'analyze')).toBe(false)
	})

	test('short aliases work', () => {
		const args = parseArgs(['-q', '-f', 'csv'], SPECS)
		expect(flagBool(args, 'quiet')).toBe(true)
		expect(flagString(args, 'format')).toBe('csv')
	})

	test('optional-number flag takes a value only when one is present', () => {
		expect(flagOptionalNumber(parseArgs(['--wait'], SPECS), 'wait')).toEqual({ present: true })
		expect(flagOptionalNumber(parseArgs(['--wait', '30'], SPECS), 'wait')).toEqual({ present: true, value: 30 })
		expect(flagOptionalNumber(parseArgs([], SPECS), 'wait')).toEqual({ present: false })
	})

	test('optional-number flag does not swallow a following positional', () => {
		const args = parseArgs(['--wait', 'prod'], SPECS)
		expect(flagOptionalNumber(args, 'wait')).toEqual({ present: true })
		expect(args.positionals).toEqual(['prod'])
	})

	test('-- stops flag parsing', () => {
		const args = parseArgs(['--analyze', '--', '--where', 'x'], SPECS)
		expect(args.positionals).toEqual(['--where', 'x'])
	})

	test('unknown flags are a usage error', () => {
		expect(exitCodeOf(() => parseArgs(['--nope'], SPECS))).toBe(EXIT.usage)
		expect(exitCodeOf(() => parseArgs(['-z'], SPECS))).toBe(EXIT.usage)
	})

	test('missing values are a usage error', () => {
		expect(exitCodeOf(() => parseArgs(['--where'], SPECS))).toBe(EXIT.usage)
	})
})

describe('integer guards', () => {
	test('positive int', () => {
		expect(requirePositiveInt('limit', 5)).toBe(5)
		expect(requirePositiveInt('limit', undefined)).toBeUndefined()
		expect(exitCodeOf(() => requirePositiveInt('limit', 0))).toBe(EXIT.usage)
		expect(exitCodeOf(() => requirePositiveInt('limit', 1.5))).toBe(EXIT.usage)
	})

	test('non-negative int', () => {
		expect(requireNonNegativeInt('offset', 0)).toBe(0)
		expect(exitCodeOf(() => requireNonNegativeInt('offset', -1))).toBe(EXIT.usage)
	})
})

describe('extractCommand', () => {
	test('finds a leading command', () => {
		expect(extractCommand(['ls', 'prod'])).toEqual({ command: 'ls', rest: ['prod'] })
	})

	test('skips global flags placed before the command', () => {
		expect(extractCommand(['--json', 'ls', 'prod'])).toEqual({ command: 'ls', rest: ['--json', 'prod'] })
		expect(extractCommand(['--format', 'csv', 'rows', 'a/b'])).toEqual({ command: 'rows', rest: ['--format', 'csv', 'a/b'] })
	})

	test('reports no command when argv holds only flags', () => {
		expect(extractCommand(['--help'])).toEqual({ rest: ['--help'] })
	})
})

describe('parseInvocation', () => {
	const flagsFor = (name: string) => findCommand(name)?.flags

	test('parses command flags after the command', () => {
		const invocation = parseInvocation(['rows', 'prod/app/public/orders', '--limit', '5'], flagsFor)
		expect(invocation.command).toBe('rows')
		expect(invocation.args.positionals).toEqual(['prod/app/public/orders'])
		expect(flagNumber(invocation.args, 'limit')).toBe(5)
	})

	test('command flags shadow global ones — approvals --timeout is seconds', () => {
		const invocation = parseInvocation(['approvals', 'wait', 'p1', '--timeout', '10'], flagsFor)
		expect(invocation.specs.timeout?.placeholder).toBe('<sec>')
	})

	test('unknown command is a usage error', () => {
		expect(exitCodeOf(() => parseInvocation(['bogus'], flagsFor))).toBe(EXIT.usage)
	})
})

describe('outputOptions', () => {
	const flagsFor = (name: string) => findCommand(name)?.flags

	test('defaults to an aligned table with a 64 KiB cap', () => {
		const opts = outputOptions(parseInvocation(['ls'], flagsFor).args)
		expect(opts).toEqual({ format: 'table', maxBytes: 65536, quiet: false })
	})

	test('--json is shorthand for --format json', () => {
		expect(outputOptions(parseInvocation(['ls', '--json'], flagsFor).args).format).toBe('json')
	})

	test('--format wins over --json', () => {
		expect(outputOptions(parseInvocation(['ls', '--json', '--format', 'csv'], flagsFor).args).format).toBe('csv')
	})

	test('unknown formats and bad caps are usage errors', () => {
		expect(exitCodeOf(() => outputOptions(parseInvocation(['ls', '--format', 'yaml'], flagsFor).args))).toBe(EXIT.usage)
		expect(exitCodeOf(() => outputOptions(parseInvocation(['ls', '--max-bytes', '0'], flagsFor).args))).toBe(EXIT.usage)
	})

	test('--timeout must be positive', () => {
		expect(timeoutMs(parseInvocation(['ls'], flagsFor).args)).toBe(30_000)
		expect(timeoutMs(parseInvocation(['ls', '--timeout', '1000'], flagsFor).args)).toBe(1000)
		expect(exitCodeOf(() => timeoutMs(parseInvocation(['ls', '--timeout', '-1'], flagsFor).args))).toBe(EXIT.usage)
	})
})
