// Data format profile — controls how values are displayed in the grid.

export type DateFormat =
	| "YYYY-MM-DD HH:mm:ss"
	| "DD.MM.YYYY HH:mm:ss"
	| "MM/DD/YYYY HH:mm:ss"
	| "YYYY-MM-DD"
	| "ISO 8601";

export type DecimalSeparator = "." | ",";

export type ThousandsSeparator = "" | "," | "." | " ";

export type NullDisplay = "NULL" | "(empty)" | "\u2205" | string;

export type BooleanDisplay = "true/false" | "1/0" | "yes/no" | "\u2713/\u2717";

export type BinaryDisplay = "hex" | "base64" | "size";

export interface FormatProfile {
	dateFormat: DateFormat;
	decimalSeparator: DecimalSeparator;
	thousandsSeparator: ThousandsSeparator;
	decimalPlaces: number;
	nullDisplay: NullDisplay;
	booleanDisplay: BooleanDisplay;
	binaryDisplay: BinaryDisplay;
}

export const DEFAULT_FORMAT_PROFILE: FormatProfile = {
	dateFormat: "YYYY-MM-DD HH:mm:ss",
	decimalSeparator: ".",
	thousandsSeparator: "",
	decimalPlaces: -1, // -1 means "as-is" (no rounding)
	nullDisplay: "NULL",
	booleanDisplay: "true/false",
	binaryDisplay: "size",
};

// ---- AI provider configuration ----

export type AiProvider = "anthropic" | "openai" | "custom";

export interface AiConfig {
	provider: AiProvider;
	apiKey: string;
	model: string;
	endpoint: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
	provider: "anthropic",
	apiKey: "",
	model: "claude-sonnet-4-20250514",
	endpoint: "",
};

/** Setting key prefix for AI configuration entries. */
export const AI_PREFIX = "ai.";

/** Convert an AiConfig to a Record<string, string> for storage. */
export function aiConfigToSettings(config: AiConfig): Record<string, string> {
	return {
		[`${AI_PREFIX}provider`]: config.provider,
		[`${AI_PREFIX}apiKey`]: config.apiKey,
		[`${AI_PREFIX}model`]: config.model,
		[`${AI_PREFIX}endpoint`]: config.endpoint,
	};
}

/** Reconstruct an AiConfig from stored settings, falling back to defaults. */
export function settingsToAiConfig(settings: Record<string, string>): AiConfig {
	const get = (key: string): string | undefined => settings[`${AI_PREFIX}${key}`];
	return {
		provider: (get("provider") as AiProvider) ?? DEFAULT_AI_CONFIG.provider,
		apiKey: get("apiKey") ?? DEFAULT_AI_CONFIG.apiKey,
		model: get("model") ?? DEFAULT_AI_CONFIG.model,
		endpoint: get("endpoint") ?? DEFAULT_AI_CONFIG.endpoint,
	};
}

/** Setting key prefix for format profile entries. */
export const FORMAT_PREFIX = "format.";

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
	};
}

/** Reconstruct a FormatProfile from stored settings, falling back to defaults. */
export function settingsToFormatProfile(settings: Record<string, string>): FormatProfile {
	const get = (key: string): string | undefined => settings[`${FORMAT_PREFIX}${key}`];
	return {
		dateFormat: (get("dateFormat") as DateFormat) ?? DEFAULT_FORMAT_PROFILE.dateFormat,
		decimalSeparator: (get("decimalSeparator") as DecimalSeparator) ?? DEFAULT_FORMAT_PROFILE.decimalSeparator,
		thousandsSeparator: (get("thousandsSeparator") as ThousandsSeparator) ?? DEFAULT_FORMAT_PROFILE.thousandsSeparator,
		decimalPlaces: get("decimalPlaces") !== undefined ? Number(get("decimalPlaces")) : DEFAULT_FORMAT_PROFILE.decimalPlaces,
		nullDisplay: get("nullDisplay") ?? DEFAULT_FORMAT_PROFILE.nullDisplay,
		booleanDisplay: (get("booleanDisplay") as BooleanDisplay) ?? DEFAULT_FORMAT_PROFILE.booleanDisplay,
		binaryDisplay: (get("binaryDisplay") as BinaryDisplay) ?? DEFAULT_FORMAT_PROFILE.binaryDisplay,
	};
}
