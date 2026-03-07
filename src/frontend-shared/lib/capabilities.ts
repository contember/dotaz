export interface AppCapabilities {
	/** Can read/write files via path (desktop) */
	hasFileSystem: boolean
	/** Can stream via HTTP endpoints (web) */
	hasHttpStreaming: boolean
	/** Has native open/save dialogs (desktop) */
	hasNativeDialogs: boolean
	/** Running in demo mode (browser-only, no persistent state) */
	isDemo: boolean
}

const defaults: AppCapabilities = {
	hasFileSystem: false,
	hasHttpStreaming: false,
	hasNativeDialogs: false,
	isDemo: false,
}

let _capabilities: AppCapabilities = { ...defaults }

export function setCapabilities(c: Partial<AppCapabilities> & Omit<AppCapabilities, 'isDemo'>): void {
	_capabilities = { ...defaults, ...c }
}

export function getCapabilities(): Readonly<AppCapabilities> {
	return _capabilities
}
