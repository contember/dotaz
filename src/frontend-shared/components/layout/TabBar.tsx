import { createSignal, For, Show } from 'solid-js'
import type { TabInfo, TabType } from '../../../shared/types/tab'
import ContextMenu from '../common/ContextMenu'
import type { ContextMenuEntry } from '../common/ContextMenu'
import Icon, { type IconName } from '../common/Icon'
import './TabBar.css'

export interface TabStatus {
	color?: string
	readOnly?: boolean
	inTransaction?: boolean
}

interface TabBarProps {
	tabs: TabInfo[]
	activeTabId: string | null
	pinnedTabIds?: Set<string>
	tabStatuses?: Map<string, TabStatus>
	onSelectTab: (id: string) => void
	onCloseTab: (id: string) => void
	onCloseOtherTabs?: (id: string) => void
	onCloseAllTabs?: () => void
	onDuplicateTab?: (id: string) => void
	onRenameTab?: (id: string, title: string) => void
}

const TAB_ICONS: Record<TabType, IconName> = {
	'data-grid': 'grid',
	'sql-console': 'sql-console',
	'schema-viewer': 'schema',
	'comparison': 'compare',
	'row-detail': 'edit',
}

export default function TabBar(props: TabBarProps) {
	const [contextMenu, setContextMenu] = createSignal<
		{
			x: number
			y: number
			tabId: string
		} | null
	>(null)
	const [editingTabId, setEditingTabId] = createSignal<string | null>(null)

	function handleContextMenu(e: MouseEvent, tabId: string) {
		e.preventDefault()
		setContextMenu({ x: e.clientX, y: e.clientY, tabId })
	}

	function closeContextMenu() {
		setContextMenu(null)
	}

	function handleDoubleClick(tab: TabInfo) {
		if (tab.type === 'sql-console' && props.onRenameTab) {
			setEditingTabId(tab.id)
		}
	}

	function handleRenameKeyDown(e: KeyboardEvent, tabId: string) {
		if (e.key === 'Enter') {
			const input = e.target as HTMLInputElement
			const newTitle = input.value.trim()
			if (newTitle && props.onRenameTab) {
				props.onRenameTab(tabId, newTitle)
			}
			setEditingTabId(null)
		} else if (e.key === 'Escape') {
			setEditingTabId(null)
		}
	}

	function handleRenameBlur(e: FocusEvent, tabId: string) {
		const input = e.target as HTMLInputElement
		const newTitle = input.value.trim()
		if (newTitle && props.onRenameTab) {
			props.onRenameTab(tabId, newTitle)
		}
		setEditingTabId(null)
	}

	function startRename(tabId: string) {
		setEditingTabId(tabId)
	}

	const contextMenuItems = (): ContextMenuEntry[] => {
		const menu = contextMenu()
		if (!menu) return []
		const tab = props.tabs.find((t) => t.id === menu.tabId)
		if (!tab) return []

		const items: ContextMenuEntry[] = [
			{
				label: 'Close',
				action: () => props.onCloseTab(menu.tabId),
			},
			{
				label: 'Close Others',
				action: () => props.onCloseOtherTabs?.(menu.tabId),
				disabled: props.tabs.length <= 1,
			},
			{
				label: 'Close All',
				action: () => props.onCloseAllTabs?.(),
			},
			'separator',
			{
				label: 'Duplicate Tab',
				action: () => props.onDuplicateTab?.(menu.tabId),
				disabled: !props.onDuplicateTab,
			},
		]

		if (tab.type === 'sql-console' && props.onRenameTab) {
			items.push({
				label: 'Rename',
				action: () => startRename(menu.tabId),
			})
		}

		return items
	}

	return (
		<div class="tab-bar">
			<div class="tab-bar__tabs">
				<For each={props.tabs}>
					{(tab) => {
						const status = () => props.tabStatuses?.get(tab.id)
						return (
							<div
								class="tab-bar__tab"
								classList={{
									'tab-bar__tab--active': tab.id === props.activeTabId,
									'tab-bar__tab--dirty': tab.dirty,
									'tab-bar__tab--pinned': props.pinnedTabIds?.has(tab.id),
									'tab-bar__tab--colored': !!status()?.color,
								}}
								style={{ 'border-bottom-color': status()?.color || undefined }}
								onClick={() => props.onSelectTab(tab.id)}
								onMouseDown={(e) => {
									if (e.button === 1) {
										e.preventDefault()
										props.onCloseTab(tab.id)
									}
								}}
								onContextMenu={(e) => handleContextMenu(e, tab.id)}
								onDblClick={() => handleDoubleClick(tab)}
							>
								<Icon name={TAB_ICONS[tab.type]} size={14} class="tab-bar__tab-icon" />
								<Show
									when={editingTabId() === tab.id}
									fallback={
										<Show
											when={tab.viewName}
											fallback={<span class="tab-bar__tab-title">{tab.title}</span>}
										>
											<span class="tab-bar__tab-title tab-bar__tab-title--view">
												<span class="tab-bar__tab-title-table">{tab.title}</span>
												<span class="tab-bar__tab-title-view">{tab.viewName}</span>
											</span>
										</Show>
									}
								>
									<input
										class="tab-bar__tab-rename"
										type="text"
										value={tab.title}
										onKeyDown={(e) => handleRenameKeyDown(e, tab.id)}
										onBlur={(e) => handleRenameBlur(e, tab.id)}
										ref={(el) =>
											setTimeout(() => {
												el.focus()
												el.select()
											})}
										onClick={(e) => e.stopPropagation()}
									/>
								</Show>
								<Show when={tab.viewModified}>
									<span class="tab-bar__tab-modified" title="View modified">&bull;</span>
								</Show>
								<Show when={tab.dirty}>
									<span class="tab-bar__tab-dirty">&bull;</span>
								</Show>
								<Show when={props.pinnedTabIds?.has(tab.id)}>
									<Icon name="pin" size={10} class="tab-bar__tab-pin" />
								</Show>
								<Show when={status()?.readOnly}>
									<span class="tab-bar__tab-badge tab-bar__tab-badge--ro" title="Read-only connection">RO</span>
								</Show>
								<Show when={status()?.inTransaction}>
									<span class="tab-bar__tab-badge tab-bar__tab-badge--tx" title="Active transaction">TX</span>
								</Show>
								<button
									class="tab-bar__tab-close"
									onClick={(e) => {
										e.stopPropagation()
										props.onCloseTab(tab.id)
									}}
									title="Close tab"
								>
									<Icon name="close" size={10} />
								</button>
							</div>
						)
					}}
				</For>
			</div>

			<Show when={contextMenu()}>
				{(menu) => (
					<ContextMenu
						x={menu().x}
						y={menu().y}
						items={contextMenuItems()}
						onClose={closeContextMenu}
					/>
				)}
			</Show>
		</div>
	)
}
