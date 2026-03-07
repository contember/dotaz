import { commandRegistry } from '../commands'
import { platformShortcut } from '../keyboard'
import type { AppCommandActions } from '../app-commands'
import { navigationStore } from '../../stores/navigation'
import { tabsStore } from '../../stores/tabs'

export function registerNavigationCommands(actions: AppCommandActions): void {
	commandRegistry.register({
		id: 'command-palette',
		label: 'Command Palette',
		shortcut: 'Ctrl+Shift+P',
		category: 'Navigation',
		handler: () => actions.toggleModal('palette'),
	})

	commandRegistry.register({
		id: 'tab-switcher',
		label: 'Switch Tab',
		shortcut: platformShortcut('tab-switcher'),
		category: 'Navigation',
		handler: () => actions.toggleModal('tab-switcher'),
	})

	commandRegistry.register({
		id: 'close-tab',
		label: 'Close Tab',
		shortcut: platformShortcut('close-tab'),
		category: 'Navigation',
		handler: () => {
			const tab = tabsStore.activeTab
			if (tab) tabsStore.closeTab(tab.id)
		},
	})

	commandRegistry.register({
		id: 'close-all-tabs',
		label: 'Close All Tabs',
		category: 'Navigation',
		handler: () => tabsStore.closeAllTabs(),
	})

	commandRegistry.register({
		id: 'next-tab',
		label: 'Next Tab',
		shortcut: platformShortcut('next-tab'),
		category: 'Navigation',
		handler: () => tabsStore.activateNextTab(),
	})

	commandRegistry.register({
		id: 'prev-tab',
		label: 'Previous Tab',
		shortcut: platformShortcut('prev-tab'),
		category: 'Navigation',
		handler: () => tabsStore.activatePrevTab(),
	})

	commandRegistry.register({
		id: 'navigate-back',
		label: 'Navigate Back',
		shortcut: 'Alt+ArrowLeft',
		category: 'Navigation',
		handler: () => navigationStore.goBack(),
	})

	commandRegistry.register({
		id: 'navigate-forward',
		label: 'Navigate Forward',
		shortcut: 'Alt+ArrowRight',
		category: 'Navigation',
		handler: () => navigationStore.goForward(),
	})

	commandRegistry.register({
		id: 'focus-navigator-filter',
		label: 'Filter in Navigator',
		shortcut: 'Ctrl+Shift+L',
		category: 'Navigation',
		handler: () => {
			if (actions.sidebarCollapsed()) actions.toggleCollapse()
			window.dispatchEvent(new CustomEvent('dotaz:focus-navigator-filter'))
		},
	})
}
