import { createSignal, For, Show } from "solid-js";
import type { TabInfo, TabType } from "../../../shared/types/tab";
import "./TabBar.css";

interface TabBarProps {
	tabs: TabInfo[];
	activeTabId: string | null;
	onSelectTab: (id: string) => void;
	onCloseTab: (id: string) => void;
	onCloseOtherTabs?: (id: string) => void;
	onCloseAllTabs?: () => void;
	onRenameTab?: (id: string, title: string) => void;
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
	const [contextMenu, setContextMenu] = createSignal<{
		x: number;
		y: number;
		tabId: string;
	} | null>(null);
	const [editingTabId, setEditingTabId] = createSignal<string | null>(null);

	function handleContextMenu(e: MouseEvent, tabId: string) {
		e.preventDefault();
		setContextMenu({ x: e.clientX, y: e.clientY, tabId });
	}

	function closeContextMenu() {
		setContextMenu(null);
	}

	function handleDoubleClick(tab: TabInfo) {
		if (tab.type === "sql-console" && props.onRenameTab) {
			setEditingTabId(tab.id);
		}
	}

	function handleRenameKeyDown(e: KeyboardEvent, tabId: string) {
		if (e.key === "Enter") {
			const input = e.target as HTMLInputElement;
			const newTitle = input.value.trim();
			if (newTitle && props.onRenameTab) {
				props.onRenameTab(tabId, newTitle);
			}
			setEditingTabId(null);
		} else if (e.key === "Escape") {
			setEditingTabId(null);
		}
	}

	function handleRenameBlur(e: FocusEvent, tabId: string) {
		const input = e.target as HTMLInputElement;
		const newTitle = input.value.trim();
		if (newTitle && props.onRenameTab) {
			props.onRenameTab(tabId, newTitle);
		}
		setEditingTabId(null);
	}

	return (
		<div class="tab-bar" onClick={closeContextMenu}>
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
							onContextMenu={(e) => handleContextMenu(e, tab.id)}
							onDblClick={() => handleDoubleClick(tab)}
						>
							<span class="tab-bar__tab-icon">{tabIcon(tab.type)}</span>
							<Show
								when={editingTabId() === tab.id}
								fallback={
									<span class="tab-bar__tab-title">{tab.title}</span>
								}
							>
								<input
									class="tab-bar__tab-rename"
									type="text"
									value={tab.title}
									onKeyDown={(e) => handleRenameKeyDown(e, tab.id)}
									onBlur={(e) => handleRenameBlur(e, tab.id)}
									ref={(el) => setTimeout(() => { el.focus(); el.select(); })}
									onClick={(e) => e.stopPropagation()}
								/>
							</Show>
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

			<Show when={contextMenu()}>
				{(menu) => (
					<div
						class="tab-bar__context-menu"
						style={{
							left: `${menu().x}px`,
							top: `${menu().y}px`,
						}}
					>
						<button
							class="tab-bar__context-menu-item"
							onClick={() => {
								props.onCloseTab(menu().tabId);
								closeContextMenu();
							}}
						>
							Close
						</button>
						<Show when={props.onCloseOtherTabs}>
							<button
								class="tab-bar__context-menu-item"
								onClick={() => {
									props.onCloseOtherTabs!(menu().tabId);
									closeContextMenu();
								}}
							>
								Close Others
							</button>
						</Show>
						<Show when={props.onCloseAllTabs}>
							<button
								class="tab-bar__context-menu-item"
								onClick={() => {
									props.onCloseAllTabs!();
									closeContextMenu();
								}}
							>
								Close All
							</button>
						</Show>
					</div>
				)}
			</Show>
		</div>
	);
}
