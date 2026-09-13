// Minimal argv parser — pure, so command wiring stays testable without a running app.

import { usageError } from './errors'

export type FlagKind =
	| 'boolean'
	| 'string'
	| 'number'
	/** Repeatable string flag, e.g. `--param a --param b`. */
	| 'strings'
	/** `--wait` (bare) or `--wait 30` — the value is optional. */
	| 'optionalNumber'

export interface FlagSpec {
	kind: FlagKind
	/** Single-character alias, given without the leading dash. */
	alias?: string
	/** Placeholder shown in `--help`, e.g. `<n>`. */
	placeholder?: string
	description: string
}

export type FlagSpecs = Record<string, FlagSpec>

export type FlagValue = boolean | string | number | string[]

export interface ParsedArgs {
	positionals: string[]
	flags: Map<string, FlagValue>
}

function specFor(specs: FlagSpecs, name: string): FlagSpec {
	const spec = specs[name]
	if (!spec) throw usageError(`Unknown option: --${name}`)
	return spec
}

function specForAlias(specs: FlagSpecs, alias: string): { name: string; spec: FlagSpec } {
	for (const [name, spec] of Object.entries(specs)) {
		if (spec.alias === alias) return { name, spec }
	}
	throw usageError(`Unknown option: -${alias}`)
}

function parseNumber(name: string, raw: string): number {
	const value = Number(raw)
	if (!Number.isFinite(value)) throw usageError(`--${name} expects a number, got "${raw}"`)
	return value
}

function parseBoolean(name: string, raw: string): boolean {
	if (raw === 'true') return true
	if (raw === 'false') return false
	throw usageError(`--${name} is a switch and only accepts true/false, got "${raw}"`)
}

function looksLikeNumber(token: string): boolean {
	return token.length > 0 && Number.isFinite(Number(token))
}

export function parseArgs(argv: string[], specs: FlagSpecs): ParsedArgs {
	const positionals: string[] = []
	const flags = new Map<string, FlagValue>()

	const assign = (name: string, spec: FlagSpec, inlineValue: string | undefined, next: () => string | undefined): void => {
		switch (spec.kind) {
			case 'boolean':
				flags.set(name, inlineValue === undefined ? true : parseBoolean(name, inlineValue))
				return
			case 'string': {
				const raw = inlineValue ?? next()
				if (raw === undefined) throw usageError(`--${name} requires a value`)
				flags.set(name, raw)
				return
			}
			case 'number': {
				const raw = inlineValue ?? next()
				if (raw === undefined) throw usageError(`--${name} requires a value`)
				flags.set(name, parseNumber(name, raw))
				return
			}
			case 'strings': {
				const raw = inlineValue ?? next()
				if (raw === undefined) throw usageError(`--${name} requires a value`)
				const existing = flags.get(name)
				flags.set(name, Array.isArray(existing) ? [...existing, raw] : [raw])
				return
			}
			case 'optionalNumber': {
				if (inlineValue !== undefined) {
					flags.set(name, parseNumber(name, inlineValue))
					return
				}
				const peeked = next()
				if (peeked === undefined) {
					flags.set(name, true)
					return
				}
				flags.set(name, parseNumber(name, peeked))
				return
			}
		}
	}

	let i = 0
	while (i < argv.length) {
		const token = argv[i]

		if (token === '--') {
			positionals.push(...argv.slice(i + 1))
			break
		}

		if (token.startsWith('--')) {
			const eq = token.indexOf('=')
			const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
			const inlineValue = eq === -1 ? undefined : token.slice(eq + 1)
			const spec = specFor(specs, name)
			// `optionalNumber` only swallows the next token when it actually is a number
			const consumesNext = spec.kind === 'optionalNumber'
				? (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-') && looksLikeNumber(argv[i + 1]))
				: spec.kind !== 'boolean'
			assign(name, spec, inlineValue, () => (consumesNext ? argv[++i] : undefined))
			i++
			continue
		}

		if (token.startsWith('-') && token.length > 1) {
			const { name, spec } = specForAlias(specs, token.slice(1))
			const consumesNext = spec.kind === 'optionalNumber'
				? (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-') && looksLikeNumber(argv[i + 1]))
				: spec.kind !== 'boolean'
			assign(name, spec, undefined, () => (consumesNext ? argv[++i] : undefined))
			i++
			continue
		}

		positionals.push(token)
		i++
	}

	return { positionals, flags }
}

export function flagBool(args: ParsedArgs, name: string): boolean {
	const value = args.flags.get(name)
	return value === true
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
	const value = args.flags.get(name)
	return typeof value === 'string' ? value : undefined
}

export function flagNumber(args: ParsedArgs, name: string): number | undefined {
	const value = args.flags.get(name)
	return typeof value === 'number' ? value : undefined
}

export function flagStrings(args: ParsedArgs, name: string): string[] {
	const value = args.flags.get(name)
	return Array.isArray(value) ? value : []
}

/** `{ present: false }` when the flag was absent, `{ present: true, value }` when it carried a number. */
export function flagOptionalNumber(args: ParsedArgs, name: string): { present: boolean; value?: number } {
	const value = args.flags.get(name)
	if (value === undefined) return { present: false }
	if (typeof value === 'number') return { present: true, value }
	return { present: true }
}

export function requirePositiveInt(name: string, value: number | undefined): number | undefined {
	if (value === undefined) return undefined
	if (!Number.isInteger(value) || value <= 0) throw usageError(`--${name} must be a positive integer`)
	return value
}

export function requireNonNegativeInt(name: string, value: number | undefined): number | undefined {
	if (value === undefined) return undefined
	if (!Number.isInteger(value) || value < 0) throw usageError(`--${name} must be a non-negative integer`)
	return value
}
