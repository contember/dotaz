import { app, Menu } from 'electron'

export function createApplicationMenu(backendPort: number): void {
	const isMac = process.platform === 'darwin'

	function sendMenuAction(action: string): void {
		fetch(`http://127.0.0.1:${backendPort}/api/menu-action`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action }),
		}).catch((err) => {
			console.error('Failed to send menu action:', err.message)
		})
	}

	const template: Electron.MenuItemConstructorOptions[] = [
		// App menu (macOS only)
		...(isMac
			? [{
				label: app.name,
				submenu: [
					{ label: 'About Dotaz', click: () => sendMenuAction('about') },
					{ type: 'separator' as const },
					{ role: 'quit' as const },
				],
			}]
			: []),
		{
			label: 'File',
			submenu: [
				{ label: 'New SQL Console', accelerator: 'CommandOrControl+N', click: () => sendMenuAction('new-sql-console') },
				{ label: 'Close Tab', accelerator: 'CommandOrControl+W', click: () => sendMenuAction('close-tab') },
				{ type: 'separator' },
				{ label: 'Settings', click: () => sendMenuAction('settings') },
				{ type: 'separator' },
				{ role: 'quit' },
			],
		},
		{
			label: 'Edit',
			submenu: [
				{ role: 'undo' },
				{ role: 'redo' },
				{ type: 'separator' },
				{ role: 'cut' },
				{ role: 'copy' },
				{ role: 'paste' },
				{ role: 'selectAll' },
			],
		},
		{
			label: 'View',
			submenu: [
				{ label: 'Toggle Sidebar', accelerator: 'CommandOrControl+B', click: () => sendMenuAction('toggle-sidebar') },
				{ label: 'Command Palette', accelerator: 'CommandOrControl+Shift+P', click: () => sendMenuAction('command-palette') },
				{ type: 'separator' },
				{ label: 'Refresh Data', accelerator: 'F5', click: () => sendMenuAction('refresh-data') },
				{ type: 'separator' },
				{ label: 'Zoom In', accelerator: 'CommandOrControl+=', click: () => sendMenuAction('zoom-in') },
				{ label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: () => sendMenuAction('zoom-out') },
				{ label: 'Reset Zoom', accelerator: 'CommandOrControl+0', click: () => sendMenuAction('zoom-reset') },
				{ type: 'separator' },
				{ role: 'toggleDevTools' },
			],
		},
		{
			label: 'Connection',
			submenu: [
				{ label: 'New Connection', click: () => sendMenuAction('new-connection') },
				{ label: 'Disconnect', click: () => sendMenuAction('disconnect') },
				{ type: 'separator' },
				{ label: 'Reconnect', click: () => sendMenuAction('reconnect') },
			],
		},
		{
			label: 'Query',
			submenu: [
				{ label: 'Run Query', accelerator: 'CommandOrControl+Enter', click: () => sendMenuAction('run-query') },
				{ label: 'Cancel Query', click: () => sendMenuAction('cancel-query') },
				{ type: 'separator' },
				{ label: 'Format SQL', accelerator: 'CommandOrControl+Shift+F', click: () => sendMenuAction('format-sql') },
			],
		},
		{
			label: 'Help',
			submenu: [
				{ label: 'About Dotaz', click: () => sendMenuAction('about') },
			],
		},
	]

	const menu = Menu.buildFromTemplate(template)
	Menu.setApplicationMenu(menu)
}
