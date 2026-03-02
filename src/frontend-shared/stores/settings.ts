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

interface SettingsState {
	formatProfile: FormatProfile;
	aiConfig: AiConfig;
	loaded: boolean;
}

const [state, setState] = createStore<SettingsState>({
	formatProfile: { ...DEFAULT_FORMAT_PROFILE },
	aiConfig: { ...DEFAULT_AI_CONFIG },
	loaded: false,
});

async function loadSettings() {
	try {
		const all = await rpc.settings.getAll();
		setState("formatProfile", settingsToFormatProfile(all));
		setState("aiConfig", settingsToAiConfig(all));
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

export const settingsStore = {
	get formatProfile() {
		return state.formatProfile;
	},
	get aiConfig() {
		return state.aiConfig;
	},
	get loaded() {
		return state.loaded;
	},
	loadSettings,
	saveFormatProfile,
	saveAiConfig,
};
