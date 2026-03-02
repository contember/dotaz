export interface AppCapabilities {
	/** Can read/write files via path (desktop) */
	hasFileSystem: boolean;
	/** Can stream via HTTP endpoints (web) */
	hasHttpStreaming: boolean;
	/** Has native open/save dialogs (desktop) */
	hasNativeDialogs: boolean;
}

const defaults: AppCapabilities = {
	hasFileSystem: false,
	hasHttpStreaming: false,
	hasNativeDialogs: false,
};

let _capabilities: AppCapabilities = { ...defaults };

export function setCapabilities(c: AppCapabilities): void {
	_capabilities = { ...c };
}

export function getCapabilities(): Readonly<AppCapabilities> {
	return _capabilities;
}
