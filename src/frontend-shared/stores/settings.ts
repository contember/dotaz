import { createStore } from "solid-js/store";
import type { FormatProfile, AiConfig } from "../../shared/types/settings";
import {
	DEFAULT_FORMAT_PROFILE,
	DEFAULT_AI_CONFIG,
	settingsToFormatProfile,
	formatProfileToSettings,
	settingsToAiConfig,
	aiConfigToSettings,
} from "../../shared/types/settings";
import { rpc } from "../lib/rpc";
import type { ConnectionMode, AutoPin, AutoUnpin } from "./session";

// ── Session config ────────────────────────────────────────

export interface SessionConfig {
	defaultConnectionMode: ConnectionMode;
	autoPin: AutoPin;
	autoUnpin: AutoUnpin;
}

const DEFAULT_SESSION_CONFIG: SessionConfig = {
	defaultConnectionMode: "pool",
	autoPin: "on-begin",
	autoUnpin: "never",
};

const CONNECTION_MODES: readonly ConnectionMode[] = ["pool", "pinned-per-tab", "single-session"];
const AUTO_PIN_VALUES: readonly AutoPin[] = ["on-begin", "on-set-session", "never"];
const AUTO_UNPIN_VALUES: readonly AutoUnpin[] = ["on-commit", "never"];

function isConnectionMode(v: string | undefined): v is ConnectionMode {
	return CONNECTION_MODES.includes(v as ConnectionMode);
}

function isAutoPin(v: string | undefined): v is AutoPin {
	return AUTO_PIN_VALUES.includes(v as AutoPin);
}

function isAutoUnpin(v: string | undefined): v is AutoUnpin {
	return AUTO_UNPIN_VALUES.includes(v as AutoUnpin);
}

function settingsToSessionConfig(settings: Record<string, string>): SessionConfig {
	const mode = settings["defaultConnectionMode"];
	const pin = settings["autoPin"];
	const unpin = settings["autoUnpin"];
	return {
		defaultConnectionMode: isConnectionMode(mode) ? mode : DEFAULT_SESSION_CONFIG.defaultConnectionMode,
		autoPin: isAutoPin(pin) ? pin : DEFAULT_SESSION_CONFIG.autoPin,
		autoUnpin: isAutoUnpin(unpin) ? unpin : DEFAULT_SESSION_CONFIG.autoUnpin,
	};
}

function sessionConfigToSettings(config: SessionConfig): Record<string, string> {
	return {
		defaultConnectionMode: config.defaultConnectionMode,
		autoPin: config.autoPin,
		autoUnpin: config.autoUnpin,
	};
}

// ── Store ─────────────────────────────────────────────────

interface SettingsState {
	formatProfile: FormatProfile;
	aiConfig: AiConfig;
	sessionConfig: SessionConfig;
	loaded: boolean;
}

const [state, setState] = createStore<SettingsState>({
	formatProfile: { ...DEFAULT_FORMAT_PROFILE },
	aiConfig: { ...DEFAULT_AI_CONFIG },
	sessionConfig: { ...DEFAULT_SESSION_CONFIG },
	loaded: false,
});

async function loadSettings() {
	try {
		const all = await rpc.settings.getAll();
		setState("formatProfile", settingsToFormatProfile(all));
		setState("aiConfig", settingsToAiConfig(all));
		setState("sessionConfig", settingsToSessionConfig(all));
		setState("loaded", true);
	} catch {
		// Silently use defaults
		setState("loaded", true);
	}
}

async function saveFormatProfile(profile: FormatProfile) {
	setState("formatProfile", profile);
	const entries = formatProfileToSettings(profile);
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value });
		} catch {
			console.debug("Failed to save setting", key);
		}
	}
}

async function saveAiConfig(config: AiConfig) {
	setState("aiConfig", config);
	const entries = aiConfigToSettings(config);
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value });
		} catch {
			console.debug("Failed to save setting", key);
		}
	}
}

async function saveSessionConfig(config: SessionConfig) {
	setState("sessionConfig", config);
	const entries = sessionConfigToSettings(config);
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value });
		} catch {
			console.debug("Failed to save setting", key);
		}
	}
}

export const settingsStore = {
	get formatProfile() {
		return state.formatProfile;
	},
	get aiConfig() {
		return state.aiConfig;
	},
	get sessionConfig() {
		return state.sessionConfig;
	},
	get loaded() {
		return state.loaded;
	},
	loadSettings,
	saveFormatProfile,
	saveAiConfig,
	saveSessionConfig,
};
