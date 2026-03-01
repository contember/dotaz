import type { AppStateStorage } from "../app-state-storage";

let _storage: AppStateStorage | null = null;

export function setStorage(s: AppStateStorage): void {
	_storage = s;
}

function getStorage(): AppStateStorage {
	if (!_storage) throw new Error("Storage not initialized. Call setStorage() first.");
	return _storage;
}

export const storage: AppStateStorage = {
	get passConfigOnConnect() {
		return getStorage().passConfigOnConnect;
	},
	listConnections() {
		return getStorage().listConnections();
	},
	createConnection(name, config, rememberPassword?) {
		return getStorage().createConnection(name, config, rememberPassword);
	},
	updateConnection(id, name, config, rememberPassword?) {
		return getStorage().updateConnection(id, name, config, rememberPassword);
	},
	deleteConnection(id) {
		return getStorage().deleteConnection(id);
	},
	listHistory(params) {
		return getStorage().listHistory(params);
	},
	addHistoryEntry(entry) {
		return getStorage().addHistoryEntry(entry);
	},
	clearHistory(connectionId?) {
		return getStorage().clearHistory(connectionId);
	},
	listViewsByConnection(connectionId) {
		return getStorage().listViewsByConnection(connectionId);
	},
	saveView(params) {
		return getStorage().saveView(params);
	},
	updateView(params) {
		return getStorage().updateView(params);
	},
	deleteView(id) {
		return getStorage().deleteView(id);
	},
	getEncryptedConfig(id) {
		return getStorage().getEncryptedConfig(id);
	},
	getRememberPassword(id) {
		return getStorage().getRememberPassword(id);
	},
};
