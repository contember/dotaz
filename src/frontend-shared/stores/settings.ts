import type { AiConfig, AppearanceConfig, ColorTheme, ConsoleConfig, FormatProfile } from '@dotaz/shared/types/settings'
import {
	aiConfigToSettings,
	appearanceConfigToSettings,
	consoleConfigToSettings,
	DEFAULT_AI_CONFIG,
	DEFAULT_APPEARANCE_CONFIG,
	DEFAULT_CONSOLE_CONFIG,
	DEFAULT_FORMAT_PROFILE,
	formatProfileToSettings,
	settingsToAiConfig,
	settingsToAppearanceConfig,
	settingsToConsoleConfig,
	settingsToFormatProfile,
} from '@dotaz/shared/types/settings'
import { createStore } from 'solid-js/store'
import { rpc } from '../lib/rpc'
import type { AutoPin, AutoUnpin, ConnectionMode } from './session'

// ── Session config ────────────────────────────────────────

export interface SessionConfig {
	defaultConnectionMode: ConnectionMode
	autoPin: AutoPin
	autoUnpin: AutoUnpin
}

const DEFAULT_SESSION_CONFIG: SessionConfig = {
	defaultConnectionMode: 'pool',
	autoPin: 'on-begin',
	autoUnpin: 'never',
}

const CONNECTION_MODES: readonly ConnectionMode[] = ['pool', 'pinned-per-tab', 'single-session']
const AUTO_PIN_VALUES: readonly AutoPin[] = ['on-begin', 'on-set-session', 'never']
const AUTO_UNPIN_VALUES: readonly AutoUnpin[] = ['on-commit', 'never']

function isConnectionMode(v: string | undefined): v is ConnectionMode {
	return CONNECTION_MODES.includes(v as ConnectionMode)
}

function isAutoPin(v: string | undefined): v is AutoPin {
	return AUTO_PIN_VALUES.includes(v as AutoPin)
}

function isAutoUnpin(v: string | undefined): v is AutoUnpin {
	return AUTO_UNPIN_VALUES.includes(v as AutoUnpin)
}

function settingsToSessionConfig(settings: Record<string, string>): SessionConfig {
	const mode = settings.defaultConnectionMode
	const pin = settings.autoPin
	const unpin = settings.autoUnpin
	return {
		defaultConnectionMode: isConnectionMode(mode) ? mode : DEFAULT_SESSION_CONFIG.defaultConnectionMode,
		autoPin: isAutoPin(pin) ? pin : DEFAULT_SESSION_CONFIG.autoPin,
		autoUnpin: isAutoUnpin(unpin) ? unpin : DEFAULT_SESSION_CONFIG.autoUnpin,
	}
}

function sessionConfigToSettings(config: SessionConfig): Record<string, string> {
	return {
		defaultConnectionMode: config.defaultConnectionMode,
		autoPin: config.autoPin,
		autoUnpin: config.autoUnpin,
	}
}

// ── Grid config ───────────────────────────────────────────

export interface GridConfig {
	autoCount: boolean
}

const DEFAULT_GRID_CONFIG: GridConfig = { autoCount: false }

function settingsToGridConfig(settings: Record<string, string>): GridConfig {
	return {
		autoCount: settings['grid.autoCount'] === 'true',
	}
}

function gridConfigToSettings(config: GridConfig): Record<string, string> {
	return {
		'grid.autoCount': String(config.autoCount),
	}
}

// ── Theme application ─────────────────────────────────────

function applyTheme(theme: ColorTheme) {
	if (theme === 'dark') {
		delete document.documentElement.dataset.theme
	} else {
		document.documentElement.dataset.theme = theme
	}
}

// ── Store ─────────────────────────────────────────────────

interface SettingsState {
	formatProfile: FormatProfile
	aiConfig: AiConfig
	sessionConfig: SessionConfig
	consoleConfig: ConsoleConfig
	appearanceConfig: AppearanceConfig
	gridConfig: GridConfig
	loaded: boolean
}

const [state, setState] = createStore<SettingsState>({
	formatProfile: { ...DEFAULT_FORMAT_PROFILE },
	aiConfig: { ...DEFAULT_AI_CONFIG },
	sessionConfig: { ...DEFAULT_SESSION_CONFIG },
	consoleConfig: { ...DEFAULT_CONSOLE_CONFIG },
	appearanceConfig: { ...DEFAULT_APPEARANCE_CONFIG },
	gridConfig: { ...DEFAULT_GRID_CONFIG },
	loaded: false,
})

async function loadSettings() {
	try {
		const all = await rpc.settings.getAll()
		setState('formatProfile', settingsToFormatProfile(all))
		setState('aiConfig', settingsToAiConfig(all))
		setState('sessionConfig', settingsToSessionConfig(all))
		setState('consoleConfig', settingsToConsoleConfig(all))
		setState('gridConfig', settingsToGridConfig(all))
		const appearance = settingsToAppearanceConfig(all)
		setState('appearanceConfig', appearance)
		applyTheme(appearance.colorTheme)
		setState('loaded', true)
	} catch {
		// Silently use defaults
		setState('loaded', true)
	}
}

async function saveFormatProfile(profile: FormatProfile) {
	setState('formatProfile', profile)
	const entries = formatProfileToSettings(profile)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch {
			console.debug('Failed to save setting', key)
		}
	}
}

async function saveAiConfig(config: AiConfig) {
	setState('aiConfig', config)
	const entries = aiConfigToSettings(config)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch {
			console.debug('Failed to save setting', key)
		}
	}
}

async function saveSessionConfig(config: SessionConfig) {
	setState('sessionConfig', config)
	const entries = sessionConfigToSettings(config)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch {
			console.debug('Failed to save setting', key)
		}
	}
}

async function saveConsoleConfig(config: ConsoleConfig) {
	setState('consoleConfig', config)
	const entries = consoleConfigToSettings(config)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch {
			console.debug('Failed to save setting', key)
		}
	}
}

async function saveGridConfig(config: GridConfig) {
	setState('gridConfig', config)
	const entries = gridConfigToSettings(config)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch {
			console.debug('Failed to save setting', key)
		}
	}
}

async function saveAppearanceConfig(config: AppearanceConfig) {
	setState('appearanceConfig', config)
	applyTheme(config.colorTheme)
	const entries = appearanceConfigToSettings(config)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch {
			console.debug('Failed to save setting', key)
		}
	}
}

export const settingsStore = {
	get formatProfile() {
		return state.formatProfile
	},
	get aiConfig() {
		return state.aiConfig
	},
	get sessionConfig() {
		return state.sessionConfig
	},
	get consoleConfig() {
		return state.consoleConfig
	},
	get appearanceConfig() {
		return state.appearanceConfig
	},
	get gridConfig() {
		return state.gridConfig
	},
	get loaded() {
		return state.loaded
	},
	loadSettings,
	saveFormatProfile,
	saveAiConfig,
	saveSessionConfig,
	saveConsoleConfig,
	saveAppearanceConfig,
	saveGridConfig,
	applyTheme,
}
