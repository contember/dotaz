import { For, Show } from "solid-js";
import type { TabInfo, TabType } from "../../../shared/types/tab";
import "./TabBar.css";

interface TabBarProps {
	tabs: TabInfo[];
	activeTabId: string | null;
	onSelectTab: (id: string) => void;
	onCloseTab: (id: string) => void;
}

function tabIcon(type: TabType): string {
	switch (type) {
		case "data-grid":
			return "\u229E"; // ⊞ grid icon
		case "sql-console":
			return "\u276F"; // ❯ terminal-like
		case "schema-viewer":
			return "\u2630"; // ☰ list icon
	}
}

export default function TabBar(props: TabBarProps) {
	return (
		<div class="tab-bar">
			<div class="tab-bar__tabs">
				<For each={props.tabs}>
					{(tab) => (
						<div
							class="tab-bar__tab"
							classList={{
								"tab-bar__tab--active": tab.id === props.activeTabId,
								"tab-bar__tab--dirty": tab.dirty,
							}}
							onClick={() => props.onSelectTab(tab.id)}
						>
							<span class="tab-bar__tab-icon">{tabIcon(tab.type)}</span>
							<span class="tab-bar__tab-title">{tab.title}</span>
							<Show when={tab.dirty}>
								<span class="tab-bar__tab-dirty">&bull;</span>
							</Show>
							<button
								class="tab-bar__tab-close"
								onClick={(e) => {
									e.stopPropagation();
									props.onCloseTab(tab.id);
								}}
								title="Close tab"
							>
								&times;
							</button>
						</div>
					)}
				</For>
			</div>
		</div>
	);
}
