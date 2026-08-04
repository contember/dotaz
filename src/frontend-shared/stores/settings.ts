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
import { uiStore } from './ui'

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

// ── CLI config ────────────────────────────────────────────

export interface CliConfig {
	/** Whether local processes may drive this app through the CLI (see docs/agent-cli.md). */
	enabled: boolean
}

const DEFAULT_CLI_CONFIG: CliConfig = { enabled: false }

function settingsToCliConfig(settings: Record<string, string>): CliConfig {
	return {
		enabled: settings['cli.enabled'] === 'true',
	}
}

function cliConfigToSettings(config: CliConfig): Record<string, string> {
	return {
		'cli.enabled': String(config.enabled),
	}
}

// ── Connections list config ───────────────────────────────

export type ConnectionSortMode = 'manual' | 'name' | 'type' | 'status'

export interface ConnectionsConfig {
	sort: ConnectionSortMode
	/** Manual ordering — connection ids in display order. Ids not present sort last. */
	order: string[]
}

const DEFAULT_CONNECTIONS_CONFIG: ConnectionsConfig = { sort: 'manual', order: [] }

const CONNECTION_SORT_MODES: readonly ConnectionSortMode[] = ['manual', 'name', 'type', 'status']

function isConnectionSortMode(v: string | undefined): v is ConnectionSortMode {
	return CONNECTION_SORT_MODES.includes(v as ConnectionSortMode)
}

function settingsToConnectionsConfig(settings: Record<string, string>): ConnectionsConfig {
	const sort = settings['connections.sort']
	let order: string[] = []
	try {
		const raw = settings['connections.order']
		if (raw) {
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed)) {
				order = parsed.filter((x): x is string => typeof x === 'string')
			}
		}
	} catch {
		order = []
	}
	return {
		sort: isConnectionSortMode(sort) ? sort : DEFAULT_CONNECTIONS_CONFIG.sort,
		order,
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
	cliConfig: CliConfig
	connectionsConfig: ConnectionsConfig
	loaded: boolean
}

const [state, setState] = createStore<SettingsState>({
	formatProfile: { ...DEFAULT_FORMAT_PROFILE },
	aiConfig: { ...DEFAULT_AI_CONFIG },
	sessionConfig: { ...DEFAULT_SESSION_CONFIG },
	consoleConfig: { ...DEFAULT_CONSOLE_CONFIG },
	appearanceConfig: { ...DEFAULT_APPEARANCE_CONFIG },
	gridConfig: { ...DEFAULT_GRID_CONFIG },
	cliConfig: { ...DEFAULT_CLI_CONFIG },
	connectionsConfig: { ...DEFAULT_CONNECTIONS_CONFIG },
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
		setState('cliConfig', settingsToCliConfig(all))
		setState('connectionsConfig', settingsToConnectionsConfig(all))
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
		} catch (err) {
			uiStore.addToast('error', `Failed to save setting "${key}": ${err instanceof Error ? err.message : String(err)}`)
		}
	}
}

async function saveAiConfig(config: AiConfig) {
	setState('aiConfig', config)
	const entries = aiConfigToSettings(config)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch (err) {
			uiStore.addToast('error', `Failed to save setting "${key}": ${err instanceof Error ? err.message : String(err)}`)
		}
	}
}

async function saveSessionConfig(config: SessionConfig) {
	setState('sessionConfig', config)
	const entries = sessionConfigToSettings(config)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch (err) {
			uiStore.addToast('error', `Failed to save setting "${key}": ${err instanceof Error ? err.message : String(err)}`)
		}
	}
}

async function saveConsoleConfig(config: ConsoleConfig) {
	setState('consoleConfig', config)
	const entries = consoleConfigToSettings(config)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch (err) {
			uiStore.addToast('error', `Failed to save setting "${key}": ${err instanceof Error ? err.message : String(err)}`)
		}
	}
}

async function saveGridConfig(config: GridConfig) {
	setState('gridConfig', config)
	const entries = gridConfigToSettings(config)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch (err) {
			uiStore.addToast('error', `Failed to save setting "${key}": ${err instanceof Error ? err.message : String(err)}`)
		}
	}
}

async function saveCliConfig(config: CliConfig) {
	setState('cliConfig', config)
	const entries = cliConfigToSettings(config)
	for (const [key, value] of Object.entries(entries)) {
		try {
			await rpc.settings.set({ key, value })
		} catch (err) {
			uiStore.addToast('error', `Failed to save setting "${key}": ${err instanceof Error ? err.message : String(err)}`)
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
		} catch (err) {
			uiStore.addToast('error', `Failed to save setting "${key}": ${err instanceof Error ? err.message : String(err)}`)
		}
	}
}

async function setConnectionSort(mode: ConnectionSortMode) {
	setState('connectionsConfig', 'sort', mode)
	try {
		await rpc.settings.set({ key: 'connections.sort', value: mode })
	} catch (err) {
		uiStore.addToast('error', `Failed to save sort order: ${err instanceof Error ? err.message : String(err)}`)
	}
}

async function setConnectionOrder(order: string[]) {
	setState('connectionsConfig', 'order', order)
	try {
		await rpc.settings.set({ key: 'connections.order', value: JSON.stringify(order) })
	} catch (err) {
		uiStore.addToast('error', `Failed to save connection order: ${err instanceof Error ? err.message : String(err)}`)
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
	get cliConfig() {
		return state.cliConfig
	},
	get connectionsConfig() {
		return state.connectionsConfig
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
	saveCliConfig,
	setConnectionSort,
	setConnectionOrder,
	applyTheme,
}
