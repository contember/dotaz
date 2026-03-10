import type { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import type { StatusBar } from '../status/status-bar'
import * as vscode from 'vscode'

export function registerTransactionCommands(
	context: vscode.ExtensionContext,
	connectionManager: ConnectionManager,
	statusBar: StatusBar,
): void {
	// ── BEGIN ────────────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.beginTransaction', async () => {
			const connectionId = statusBar.getActiveConnectionId()
			if (!connectionId) {
				vscode.window.showWarningMessage('No active connection.')
				return
			}

			try {
				const driver = connectionManager.getDriver(connectionId)
				await driver.beginTransaction()
				vscode.window.showInformationMessage('Transaction started.')
			} catch (err) {
				vscode.window.showErrorMessage(
					`BEGIN failed: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}),
	)

	// ── COMMIT ──────────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.commitTransaction', async () => {
			const connectionId = statusBar.getActiveConnectionId()
			if (!connectionId) {
				vscode.window.showWarningMessage('No active connection.')
				return
			}

			try {
				const driver = connectionManager.getDriver(connectionId)
				await driver.commit()
				vscode.window.showInformationMessage('Transaction committed.')
			} catch (err) {
				vscode.window.showErrorMessage(
					`COMMIT failed: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}),
	)

	// ── ROLLBACK ────────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.rollbackTransaction', async () => {
			const connectionId = statusBar.getActiveConnectionId()
			if (!connectionId) {
				vscode.window.showWarningMessage('No active connection.')
				return
			}

			try {
				const driver = connectionManager.getDriver(connectionId)
				await driver.rollback()
				vscode.window.showInformationMessage('Transaction rolled back.')
			} catch (err) {
				vscode.window.showErrorMessage(
					`ROLLBACK failed: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}),
	)

	// ── Transaction Menu (status bar click) ─────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.transactionMenu', async () => {
			const picked = await vscode.window.showQuickPick(
				[
					{ label: '$(check) Commit', action: 'commit' },
					{ label: '$(discard) Rollback', action: 'rollback' },
				],
				{ placeHolder: 'Transaction actions' },
			)
			if (!picked) return

			if (picked.action === 'commit') {
				await vscode.commands.executeCommand('dotaz.commitTransaction')
			} else {
				await vscode.commands.executeCommand('dotaz.rollbackTransaction')
			}
		}),
	)
}
