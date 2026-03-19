// Data format profile — controls how values are displayed in the grid.

export type DateFormat =
	| 'YYYY-MM-DD HH:mm:ss'
	| 'DD.MM.YYYY HH:mm:ss'
	| 'MM/DD/YYYY HH:mm:ss'
	| 'YYYY-MM-DD'
	| 'ISO 8601'

export type DecimalSeparator = '.' | ','

export type ThousandsSeparator = '' | ',' | '.' | ' '

export type NullDisplay = 'NULL' | '(empty)' | '\u2205' | string

export type BooleanDisplay = 'true/false' | '1/0' | 'yes/no' | '\u2713/\u2717'

export type BinaryDisplay = 'hex' | 'base64' | 'size'

export interface FormatProfile {
	dateFormat: DateFormat
	decimalSeparator: DecimalSeparator
	thousandsSeparator: ThousandsSeparator
	decimalPlaces: number
	nullDisplay: NullDisplay
	booleanDisplay: BooleanDisplay
	binaryDisplay: BinaryDisplay
}

export const DEFAULT_FORMAT_PROFILE: FormatProfile = {
	dateFormat: 'YYYY-MM-DD HH:mm:ss',
	decimalSeparator: '.',
	thousandsSeparator: '',
	decimalPlaces: -1, // -1 means "as-is" (no rounding)
	nullDisplay: 'NULL',
	booleanDisplay: 'true/false',
	binaryDisplay: 'size',
}

// ---- Appearance configuration ----

export type ColorTheme = 'dark' | 'light' | 'high-contrast' | 'nord' | 'solarized-dark' | 'monokai'

export interface AppearanceConfig {
	colorTheme: ColorTheme
}

export const DEFAULT_APPEARANCE_CONFIG: AppearanceConfig = {
	colorTheme: 'dark',
}

/** Setting key prefix for appearance configuration entries. */
export const APPEARANCE_PREFIX = 'appearance.'

/** Convert an AppearanceConfig to a Record<string, string> for storage. */
export function appearanceConfigToSettings(config: AppearanceConfig): Record<string, string> {
	return {
		[`${APPEARANCE_PREFIX}colorTheme`]: config.colorTheme,
	}
}

const COLOR_THEMES: readonly ColorTheme[] = ['dark', 'light', 'high-contrast', 'nord', 'solarized-dark', 'monokai']

function isColorTheme(v: string | undefined): v is ColorTheme {
	return COLOR_THEMES.includes(v as ColorTheme)
}

/** Reconstruct an AppearanceConfig from stored settings, falling back to defaults. */
export function settingsToAppearanceConfig(settings: Record<string, string>): AppearanceConfig {
	const theme = settings[`${APPEARANCE_PREFIX}colorTheme`]
	return {
		colorTheme: isColorTheme(theme) ? theme : DEFAULT_APPEARANCE_CONFIG.colorTheme,
	}
}

// ---- AI provider configuration ----

export type AiProvider = 'anthropic' | 'openai' | 'custom'

export interface AiConfig {
	provider: AiProvider
	apiKey: string
	model: string
	endpoint: string
}

export const DEFAULT_AI_CONFIG: AiConfig = {
	provider: 'anthropic',
	apiKey: '',
	model: 'claude-sonnet-4-20250514',
	endpoint: '',
}

/** Setting key prefix for AI configuration entries. */
export const AI_PREFIX = 'ai.'

/** Convert an AiConfig to a Record<string, string> for storage. */
export function aiConfigToSettings(config: AiConfig): Record<string, string> {
	return {
		[`${AI_PREFIX}provider`]: config.provider,
		[`${AI_PREFIX}apiKey`]: config.apiKey,
		[`${AI_PREFIX}model`]: config.model,
		[`${AI_PREFIX}endpoint`]: config.endpoint,
	}
}

// ---- Type guards for union types ----

const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'custom']

function isAiProvider(v: string | undefined): v is AiProvider {
	return AI_PROVIDERS.includes(v as AiProvider)
}

/** Reconstruct an AiConfig from stored settings, falling back to defaults. */
export function settingsToAiConfig(settings: Record<string, string>): AiConfig {
	const get = (key: string): string | undefined => settings[`${AI_PREFIX}${key}`]
	const provider = get('provider')
	return {
		provider: isAiProvider(provider) ? provider : DEFAULT_AI_CONFIG.provider,
		apiKey: get('apiKey') ?? DEFAULT_AI_CONFIG.apiKey,
		model: get('model') ?? DEFAULT_AI_CONFIG.model,
		endpoint: get('endpoint') ?? DEFAULT_AI_CONFIG.endpoint,
	}
}

// ---- Console configuration ----

export interface ConsoleConfig {
	defaultResultLimit: number // 0 = unlimited
	queryResponseTimeoutMs: number
}

export const DEFAULT_CONSOLE_CONFIG: ConsoleConfig = {
	defaultResultLimit: 500,
	queryResponseTimeoutMs: 300_000, // 5 minutes — safety net for fire-and-forget queries
}

/** Setting key prefix for console configuration entries. */
export const CONSOLE_PREFIX = 'console.'

/** Convert a ConsoleConfig to a Record<string, string> for storage. */
export function consoleConfigToSettings(config: ConsoleConfig): Record<string, string> {
	return {
		[`${CONSOLE_PREFIX}defaultResultLimit`]: String(config.defaultResultLimit),
		[`${CONSOLE_PREFIX}queryResponseTimeout`]: String(config.queryResponseTimeoutMs),
	}
}

/** Reconstruct a ConsoleConfig from stored settings, falling back to defaults. */
export function settingsToConsoleConfig(settings: Record<string, string>): ConsoleConfig {
	const raw = settings[`${CONSOLE_PREFIX}defaultResultLimit`]
	const parsed = raw !== undefined ? Number(raw) : NaN
	const rawTimeout = settings[`${CONSOLE_PREFIX}queryResponseTimeout`]
	const parsedTimeout = rawTimeout !== undefined ? Number(rawTimeout) : NaN
	return {
		defaultResultLimit: !Number.isNaN(parsed) && parsed >= 0 ? parsed : DEFAULT_CONSOLE_CONFIG.defaultResultLimit,
		queryResponseTimeoutMs: !Number.isNaN(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_CONSOLE_CONFIG.queryResponseTimeoutMs,
	}
}

/** Setting key prefix for format profile entries. */
export const FORMAT_PREFIX = 'format.'

/** Convert a FormatProfile to a Record<string, string> for storage. */
export function formatProfileToSettings(profile: FormatProfile): Record<string, string> {
	return {
		[`${FORMAT_PREFIX}dateFormat`]: profile.dateFormat,
		[`${FORMAT_PREFIX}decimalSeparator`]: profile.decimalSeparator,
		[`${FORMAT_PREFIX}thousandsSeparator`]: profile.thousandsSeparator,
		[`${FORMAT_PREFIX}decimalPlaces`]: String(profile.decimalPlaces),
		[`${FORMAT_PREFIX}nullDisplay`]: profile.nullDisplay,
		[`${FORMAT_PREFIX}booleanDisplay`]: profile.booleanDisplay,
		[`${FORMAT_PREFIX}binaryDisplay`]: profile.binaryDisplay,
	}
}

// ---- Type guards for format profile union types ----

const DATE_FORMATS: readonly DateFormat[] = [
	'YYYY-MM-DD HH:mm:ss',
	'DD.MM.YYYY HH:mm:ss',
	'MM/DD/YYYY HH:mm:ss',
	'YYYY-MM-DD',
	'ISO 8601',
]

const DECIMAL_SEPARATORS: readonly DecimalSeparator[] = ['.', ',']

const THOUSANDS_SEPARATORS: readonly ThousandsSeparator[] = ['', ',', '.', ' ']

const BOOLEAN_DISPLAYS: readonly BooleanDisplay[] = ['true/false', '1/0', 'yes/no', '\u2713/\u2717']

const BINARY_DISPLAYS: readonly BinaryDisplay[] = ['hex', 'base64', 'size']

function isDateFormat(v: string | undefined): v is DateFormat {
	return DATE_FORMATS.includes(v as DateFormat)
}

function isDecimalSeparator(v: string | undefined): v is DecimalSeparator {
	return DECIMAL_SEPARATORS.includes(v as DecimalSeparator)
}

function isThousandsSeparator(v: string | undefined): v is ThousandsSeparator {
	return THOUSANDS_SEPARATORS.includes(v as ThousandsSeparator)
}

function isBooleanDisplay(v: string | undefined): v is BooleanDisplay {
	return BOOLEAN_DISPLAYS.includes(v as BooleanDisplay)
}

function isBinaryDisplay(v: string | undefined): v is BinaryDisplay {
	return BINARY_DISPLAYS.includes(v as BinaryDisplay)
}

/** Reconstruct a FormatProfile from stored settings, falling back to defaults. */
export function settingsToFormatProfile(settings: Record<string, string>): FormatProfile {
	const get = (key: string): string | undefined => settings[`${FORMAT_PREFIX}${key}`]
	const dateFormat = get('dateFormat')
	const decimalSeparator = get('decimalSeparator')
	const thousandsSeparator = get('thousandsSeparator')
	const booleanDisplay = get('booleanDisplay')
	const binaryDisplay = get('binaryDisplay')
	return {
		dateFormat: isDateFormat(dateFormat) ? dateFormat : DEFAULT_FORMAT_PROFILE.dateFormat,
		decimalSeparator: isDecimalSeparator(decimalSeparator) ? decimalSeparator : DEFAULT_FORMAT_PROFILE.decimalSeparator,
		thousandsSeparator: isThousandsSeparator(thousandsSeparator) ? thousandsSeparator : DEFAULT_FORMAT_PROFILE.thousandsSeparator,
		decimalPlaces: get('decimalPlaces') !== undefined ? Number(get('decimalPlaces')) : DEFAULT_FORMAT_PROFILE.decimalPlaces,
		nullDisplay: get('nullDisplay') ?? DEFAULT_FORMAT_PROFILE.nullDisplay,
		booleanDisplay: isBooleanDisplay(booleanDisplay) ? booleanDisplay : DEFAULT_FORMAT_PROFILE.booleanDisplay,
		binaryDisplay: isBinaryDisplay(binaryDisplay) ? binaryDisplay : DEFAULT_FORMAT_PROFILE.binaryDisplay,
	}
}
