import { createSignal, Show } from "solid-js";
import Sidebar, { SidebarExpandButton } from "./Sidebar";
import Resizer from "./Resizer";
import TabBar from "./TabBar";
import StatusBar from "./StatusBar";
import type { TabInfo } from "../../../shared/types/tab";
import "./AppShell.css";

const MIN_WIDTH = 150;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 250;

export default function AppShell() {
	const [sidebarWidth, setSidebarWidth] = createSignal(DEFAULT_WIDTH);
	const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

	// Placeholder tab state — will be replaced by tab store (DOTAZ-011)
	const [tabs, setTabs] = createSignal<TabInfo[]>([]);
	const [activeTabId, setActiveTabId] = createSignal<string | null>(null);

	function handleResize(deltaX: number) {
		setSidebarWidth((w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + deltaX)));
	}

	function toggleCollapse() {
		setSidebarCollapsed((c) => !c);
	}

	function selectTab(id: string) {
		setActiveTabId(id);
	}

	function closeTab(id: string) {
		setTabs((prev) => prev.filter((t) => t.id !== id));
		if (activeTabId() === id) {
			const remaining = tabs();
			setActiveTabId(remaining.length > 0 ? remaining[0].id : null);
		}
	}

	return (
		<div class="app-shell">
			<div class="app-shell__body">
				<Show when={sidebarCollapsed()}>
					<SidebarExpandButton onClick={toggleCollapse} />
				</Show>

				<Sidebar
					width={sidebarWidth()}
					collapsed={sidebarCollapsed()}
					onToggleCollapse={toggleCollapse}
				/>

				<Show when={!sidebarCollapsed()}>
					<Resizer onResize={handleResize} />
				</Show>

				<div class="app-shell__main">
					<TabBar
						tabs={tabs()}
						activeTabId={activeTabId()}
						onSelectTab={selectTab}
						onCloseTab={closeTab}
					/>
					<main class="main-content" />
				</div>
			</div>

			<StatusBar />
		</div>
	);
}
