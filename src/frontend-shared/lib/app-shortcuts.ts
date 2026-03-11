import { keyboardManager, platformShortcut } from './keyboard'

export function registerAppShortcuts(): void {
	// Global shortcuts
	keyboardManager.register('Ctrl+Shift+P', 'command-palette')
	keyboardManager.register('Ctrl+B', 'toggle-sidebar')

	keyboardManager.register('Ctrl+/', 'keyboard-shortcuts')

	// Platform-aware shortcuts (Ctrl-based in desktop, Alt-based in browser)
	for (
		const cmdId of [
			'new-sql-console',
			'close-tab',
			'next-tab',
			'prev-tab',
			'tab-switcher',
		] as const
	) {
		keyboardManager.register(platformShortcut(cmdId), cmdId)
	}
	keyboardManager.register('Ctrl+Shift+L', 'focus-navigator-filter')
	keyboardManager.register('Alt+ArrowLeft', 'navigate-back')
	keyboardManager.register('Alt+ArrowRight', 'navigate-forward')

	// SQL console context
	keyboardManager.register('Ctrl+Enter', 'run-query', 'sql-console')
	keyboardManager.register('Ctrl+Shift+F', 'format-sql', 'sql-console')
	keyboardManager.register('Ctrl+D', 'bookmark-query', 'sql-console')
	keyboardManager.register(
		'Ctrl+Shift+Enter',
		'commit-transaction',
		'sql-console',
	)
	keyboardManager.register(
		'Ctrl+Shift+R',
		'rollback-transaction',
		'sql-console',
	)
	keyboardManager.register('Ctrl+G', 'ai-generate-sql', 'sql-console')

	// Data grid context
	keyboardManager.register('Ctrl+Enter', 'add-new-row', 'data-grid')
	keyboardManager.register('F5', 'refresh-data', 'data-grid')
	keyboardManager.register('F2', 'inline-edit', 'data-grid')
	keyboardManager.register('Delete', 'delete-rows', 'data-grid')
	keyboardManager.register('Ctrl+S', 'save-view', 'data-grid')
	keyboardManager.register('Ctrl+Shift+T', 'toggle-transpose', 'data-grid')
	keyboardManager.register(
		'Ctrl+Shift+E',
		'toggle-value-editor',
		'data-grid',
	)
	keyboardManager.register('Ctrl+Z', 'undo', 'data-grid')
	keyboardManager.register('Ctrl+Shift+Z', 'redo', 'data-grid')
}
