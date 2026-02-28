import { createStore } from "solid-js/store";
import type { TabInfo, TabType } from "../../shared/types/tab";

export interface TabState {
	openTabs: TabInfo[];
	activeTabId: string | null;
}

export interface OpenTabConfig {
	type: TabType;
	title: string;
	connectionId: string;
	schema?: string;
	table?: string;
}

const [state, setState] = createStore<TabState>({
	openTabs: [],
	activeTabId: null,
});

function openTab(config: OpenTabConfig): string {
	const id = crypto.randomUUID();
	const tab: TabInfo = {
		id,
		type: config.type,
		title: config.title,
		connectionId: config.connectionId,
		schema: config.schema,
		table: config.table,
		dirty: false,
	};
	setState("openTabs", (tabs) => [...tabs, tab]);
	setState("activeTabId", id);
	return id;
}

function setActiveTab(id: string) {
	const exists = state.openTabs.some((t) => t.id === id);
	if (exists) {
		setState("activeTabId", id);
	}
}

function closeTab(id: string) {
	const tab = state.openTabs.find((t) => t.id === id);
	if (!tab) return;

	if (tab.dirty) {
		const confirmed = window.confirm(
			`"${tab.title}" has unsaved changes. Close anyway?`,
		);
		if (!confirmed) return;
	}

	const idx = state.openTabs.findIndex((t) => t.id === id);
	setState("openTabs", (tabs) => tabs.filter((t) => t.id !== id));

	if (state.activeTabId === id) {
		const remaining = state.openTabs;
		// Prefer the tab to the right, then to the left, then null
		const nextTab = remaining[idx] ?? remaining[idx - 1] ?? null;
		setState("activeTabId", nextTab?.id ?? null);
	}
}

function closeOtherTabs(id: string) {
	const dirtyOthers = state.openTabs.filter(
		(t) => t.id !== id && t.dirty,
	);
	if (dirtyOthers.length > 0) {
		const confirmed = window.confirm(
			`${dirtyOthers.length} tab(s) have unsaved changes. Close them anyway?`,
		);
		if (!confirmed) return;
	}

	const kept = state.openTabs.find((t) => t.id === id);
	if (kept) {
		setState("openTabs", [kept]);
		setState("activeTabId", id);
	}
}

function closeAllTabs() {
	const dirtyTabs = state.openTabs.filter((t) => t.dirty);
	if (dirtyTabs.length > 0) {
		const confirmed = window.confirm(
			`${dirtyTabs.length} tab(s) have unsaved changes. Close all anyway?`,
		);
		if (!confirmed) return;
	}

	setState("openTabs", []);
	setState("activeTabId", null);
}

function reorderTabs(fromIndex: number, toIndex: number) {
	if (fromIndex === toIndex) return;
	const tabs = [...state.openTabs];
	if (fromIndex < 0 || fromIndex >= tabs.length) return;
	if (toIndex < 0 || toIndex >= tabs.length) return;

	const [moved] = tabs.splice(fromIndex, 1);
	tabs.splice(toIndex, 0, moved);
	setState("openTabs", tabs);
}

function renameTab(id: string, title: string) {
	const idx = state.openTabs.findIndex((t) => t.id === id);
	if (idx !== -1) {
		setState("openTabs", idx, "title", title);
	}
}

function setTabDirty(id: string, dirty: boolean) {
	const idx = state.openTabs.findIndex((t) => t.id === id);
	if (idx !== -1) {
		setState("openTabs", idx, "dirty", dirty);
	}
}

export const tabsStore = {
	get openTabs() {
		return state.openTabs;
	},
	get activeTabId() {
		return state.activeTabId;
	},
	get activeTab() {
		return state.openTabs.find((t) => t.id === state.activeTabId) ?? null;
	},
	openTab,
	setActiveTab,
	closeTab,
	closeOtherTabs,
	closeAllTabs,
	reorderTabs,
	renameTab,
	setTabDirty,
};
