import { commandRegistry } from '../commands'
import type { AppCommandActions } from '../app-commands'
import { uiStore } from '../../stores/ui'

export function registerViewCommands(actions: AppCommandActions): void {
	commandRegistry.register({
		id: 'toggle-sidebar',
		label: 'Toggle Sidebar',
		shortcut: 'Ctrl+B',
		category: 'View',
		handler: () => actions.toggleCollapse(),
	})

	commandRegistry.register({
		id: 'zoom-in',
		label: 'Zoom In',
		category: 'View',
		shortcut: 'Ctrl+=',
		handler: () => {
			const current = parseFloat(document.documentElement.style.zoom || '1')
			document.documentElement.style.zoom = String(
				Math.min(current + 0.1, 2),
			)
		},
	})

	commandRegistry.register({
		id: 'zoom-out',
		label: 'Zoom Out',
		category: 'View',
		shortcut: 'Ctrl+-',
		handler: () => {
			const current = parseFloat(document.documentElement.style.zoom || '1')
			document.documentElement.style.zoom = String(
				Math.max(current - 0.1, 0.5),
			)
		},
	})

	commandRegistry.register({
		id: 'zoom-reset',
		label: 'Reset Zoom',
		category: 'View',
		shortcut: 'Ctrl+0',
		handler: () => {
			document.documentElement.style.zoom = '1'
		},
	})

	commandRegistry.register({
		id: 'settings',
		label: 'Settings',
		category: 'View',
		handler: () => actions.setModal({ type: 'settings', section: 'data-format' }),
	})

	commandRegistry.register({
		id: 'settings-data-format',
		label: 'Settings: Data Format',
		category: 'View',
		handler: () => actions.setModal({ type: 'settings', section: 'data-format' }),
	})

	commandRegistry.register({
		id: 'ai-settings',
		label: 'Settings: AI',
		category: 'View',
		handler: () => actions.setModal({ type: 'settings', section: 'ai' }),
	})

	commandRegistry.register({
		id: 'session-settings',
		label: 'Settings: Session',
		category: 'View',
		handler: () => actions.setModal({ type: 'settings', section: 'session' }),
	})

	commandRegistry.register({
		id: 'about',
		label: 'About Dotaz',
		category: 'Help',
		handler: () => {
			uiStore.addToast('info', 'Dotaz — Desktop Database Client')
		},
	})

	commandRegistry.register({
		id: 'keyboard-shortcuts',
		label: 'Keyboard Shortcuts',
		shortcut: 'Ctrl+/',
		category: 'Help',
		handler: () => actions.toggleModal('keyboard-shortcuts'),
	})
}
