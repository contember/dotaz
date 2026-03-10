import type { ConnectionManager, StatusChangeEvent } from '@dotaz/backend-shared/services/connection-manager'
import * as vscode from 'vscode'

/**
 * Manages VS Code status bar items for Dotaz:
 * - Active connection indicator
 * - Transaction state indicator
 * - Read-only indicator
 */
export class StatusBar {
	private connectionItem: vscode.StatusBarItem
	private transactionItem: vscode.StatusBarItem
	private readOnlyItem: vscode.StatusBarItem
	private activeConnectionId: string | null = null

	constructor(private connectionManager: ConnectionManager) {
		// Active connection — leftmost
		this.connectionItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100,
		)
		this.connectionItem.command = 'dotaz.switchConnection'
		this.connectionItem.tooltip = 'Dotaz: Click to switch connection'

		// Transaction state
		this.transactionItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			99,
		)
		this.transactionItem.command = 'dotaz.transactionMenu'
		this.transactionItem.tooltip = 'Dotaz: Transaction in progress — click for options'

		// Read-only
		this.readOnlyItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			98,
		)
		this.readOnlyItem.tooltip = 'Dotaz: Connection is read-only'

		this.update()
	}

	/**
	 * Handle a connection status change event.
	 */
	onStatusChanged(event: StatusChangeEvent): void {
		// Auto-select the first connected connection if none active
		if (event.state === 'connected' && !this.activeConnectionId) {
			this.activeConnectionId = event.connectionId
		}

		// If the active connection disconnected, clear it
		if (event.connectionId === this.activeConnectionId && event.state === 'disconnected') {
			// Try to find another connected connection
			const connected = this.connectionManager.listConnections()
				.find((c) => c.state === 'connected' && c.id !== event.connectionId)
			this.activeConnectionId = connected?.id ?? null
		}

		this.update()
	}

	/**
	 * Set the active connection for the status bar display.
	 */
	setActiveConnection(connectionId: string | null): void {
		this.activeConnectionId = connectionId
		this.update()
	}

	getActiveConnectionId(): string | null {
		return this.activeConnectionId
	}

	private update(): void {
		if (!this.activeConnectionId) {
			this.connectionItem.text = '$(plug) No Connection'
			this.connectionItem.show()
			this.transactionItem.hide()
			this.readOnlyItem.hide()
			return
		}

		const connections = this.connectionManager.listConnections()
		const conn = connections.find((c) => c.id === this.activeConnectionId)
		if (!conn) {
			this.connectionItem.text = '$(plug) No Connection'
			this.connectionItem.show()
			this.transactionItem.hide()
			this.readOnlyItem.hide()
			return
		}

		// Connection indicator
		const stateIcon = conn.state === 'connected'
			? '$(database)'
			: conn.state === 'connecting' || conn.state === 'reconnecting'
			? '$(loading~spin)'
			: conn.state === 'error'
			? '$(error)'
			: '$(plug)'

		this.connectionItem.text = `${stateIcon} ${conn.name}`
		this.connectionItem.show()

		// Read-only indicator
		if (conn.readOnly) {
			this.readOnlyItem.text = '$(lock) Read-Only'
			this.readOnlyItem.show()
		} else {
			this.readOnlyItem.hide()
		}

		// Transaction indicator (TODO: integrate with TransactionManager state)
		this.transactionItem.hide()
	}

	dispose(): void {
		this.connectionItem.dispose()
		this.transactionItem.dispose()
		this.readOnlyItem.dispose()
	}
}
