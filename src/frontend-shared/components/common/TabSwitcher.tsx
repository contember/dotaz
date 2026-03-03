import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { TabInfo, TabType } from '../../../shared/types/tab'
import { connectionsStore } from '../../stores/connections'
import { tabsStore } from '../../stores/tabs'
import type { IconName } from './Icon'
import Icon from './Icon'
import './CommandPalette.css'
import './TabSwitcher.css'

const TAB_ICONS: Record<TabType, IconName> = {
	'data-grid': 'grid',
	'sql-console': 'sql-console',
	'schema-viewer': 'schema',
	'comparison': 'compare',
	'row-detail': 'edit',
}

/** Simple fuzzy match: all characters of query appear in label in order (case-insensitive). */
function fuzzyMatch(label: string, query: string): boolean {
	const lowerLabel = label.toLowerCase()
	const lowerQuery = query.toLowerCase()
	let labelIdx = 0
	for (let i = 0; i < lowerQuery.length; i++) {
		const found = lowerLabel.indexOf(lowerQuery[i], labelIdx)
		if (found === -1) return false
		labelIdx = found + 1
	}
	return true
}

interface TabSwitcherProps {
	open: boolean
	onClose: () => void
}

export default function TabSwitcher(props: TabSwitcherProps) {
	const [query, setQuery] = createSignal('')
	const [selectedIndex, setSelectedIndex] = createSignal(0)

	let inputRef: HTMLInputElement | undefined
	let listRef: HTMLDivElement | undefined

	const filteredTabs = createMemo(() => {
		const q = query()
		const tabs = tabsStore.openTabs
		if (!q) return tabs
		return tabs.filter((tab) => fuzzyMatch(tab.title, q))
	})

	// Reset state when opened
	createEffect(() => {
		if (props.open) {
			setQuery('')
			setSelectedIndex(0)
			requestAnimationFrame(() => inputRef?.focus())
		}
	})

	// Clamp selectedIndex when filtered list changes
	createEffect(() => {
		const len = filteredTabs().length
		if (selectedIndex() >= len) {
			setSelectedIndex(Math.max(0, len - 1))
		}
	})

	function connectionName(connectionId: string): string | undefined {
		return connectionsStore.connections.find((c) => c.id === connectionId)?.name
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (!props.open) return

		if (e.key === 'Escape') {
			e.preventDefault()
			props.onClose()
			return
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setSelectedIndex((i) => Math.min(i + 1, filteredTabs().length - 1))
			scrollToSelected()
			return
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault()
			setSelectedIndex((i) => Math.max(i - 1, 0))
			scrollToSelected()
			return
		}

		if (e.key === 'Enter') {
			e.preventDefault()
			const items = filteredTabs()
			const idx = selectedIndex()
			if (items[idx]) {
				props.onClose()
				tabsStore.setActiveTab(items[idx].id)
			}
			return
		}
	}

	function scrollToSelected() {
		requestAnimationFrame(() => {
			const el = listRef?.querySelector('.command-palette__item--selected')
			el?.scrollIntoView({ block: 'nearest' })
		})
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			props.onClose()
		}
	}

	function handleItemClick(tab: TabInfo) {
		props.onClose()
		tabsStore.setActiveTab(tab.id)
	}

	onMount(() => {
		document.addEventListener('keydown', handleKeyDown)
	})

	onCleanup(() => {
		document.removeEventListener('keydown', handleKeyDown)
	})

	return (
		<Show when={props.open}>
			<div class="command-palette-overlay" onClick={handleOverlayClick}>
				<div class="command-palette">
					<div class="command-palette__input-wrap">
						<input
							ref={inputRef}
							class="command-palette__input"
							type="text"
							placeholder="Switch to tab..."
							value={query()}
							onInput={(e) => setQuery(e.currentTarget.value)}
						/>
					</div>
					<div class="command-palette__list" ref={listRef}>
						<Show when={filteredTabs().length === 0}>
							<div class="command-palette__empty">No matching tabs</div>
						</Show>
						<For each={filteredTabs()}>
							{(tab, i) => (
								<div
									class={`command-palette__item${i() === selectedIndex() ? ' command-palette__item--selected' : ''}${
										tab.id === tabsStore.activeTabId ? ' tab-switcher__item--active' : ''
									}`}
									onClick={() => handleItemClick(tab)}
									onMouseEnter={() => setSelectedIndex(i())}
								>
									<div class="command-palette__item-left">
										<Icon name={TAB_ICONS[tab.type]} size={14} class="tab-switcher__item-icon" />
										<span class="tab-switcher__item-title">{tab.title}</span>
									</div>
									<Show when={connectionName(tab.connectionId)}>
										<span class="tab-switcher__item-connection">{connectionName(tab.connectionId)}</span>
									</Show>
								</div>
							)}
						</For>
					</div>
				</div>
			</div>
		</Show>
	)
}
