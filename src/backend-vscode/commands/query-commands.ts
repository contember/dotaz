import type { QueryExecutor } from '@dotaz/backend-shared/services/query-executor'
import type { ConnectionManager } from '@dotaz/backend-shared/services/connection-manager'
import { formatSql } from '@dotaz/backend-shared/services/sql-formatter'
import type { StatusBar } from '../status/status-bar'
import * as vscode from 'vscode'

export function registerQueryCommands(
	context: vscode.ExtensionContext,
	connectionManager: ConnectionManager,
	queryExecutor: QueryExecutor,
	statusBar: StatusBar,
): void {
	// ── Run Query ────────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.runQuery', async () => {
			const editor = vscode.window.activeTextEditor
			if (!editor) return

			const connectionId = statusBar.getActiveConnectionId()
			if (!connectionId) {
				vscode.window.showWarningMessage('No active connection. Connect to a database first.')
				return
			}

			const state = connectionManager.getConnectionState(connectionId)
			if (state !== 'connected') {
				vscode.window.showWarningMessage('Active connection is not connected.')
				return
			}

			// Get selected text or entire document
			const selection = editor.selection
			const sql = selection.isEmpty
				? editor.document.getText()
				: editor.document.getText(selection)

			if (!sql.trim()) return

			const queryId = crypto.randomUUID()

			try {
				const results = await queryExecutor.executeQuery(
					connectionId,
					sql,
					undefined,
					undefined,
					queryId,
				)

				// Show results in output channel for now
				// (Phase 2 will add a proper WebviewPanel for results)
				const outputChannel = getOutputChannel()
				outputChannel.show(true)

				for (const result of results) {
					if (result.error) {
						outputChannel.appendLine(`Error: ${result.error}`)
					} else {
						outputChannel.appendLine(
							`OK — ${result.rowCount ?? 0} row(s), ${result.durationMs ?? 0}ms`,
						)
						if (result.rows && result.rows.length > 0) {
							// Simple table output
							const columns = result.columns?.map((c) => c.name) ?? Object.keys(result.rows[0])
							outputChannel.appendLine(columns.join('\t'))
							outputChannel.appendLine('-'.repeat(columns.length * 12))
							for (const row of result.rows.slice(0, 100)) {
								outputChannel.appendLine(
									columns.map((col) => String(row[col] ?? 'NULL')).join('\t'),
								)
							}
							if (result.rows.length > 100) {
								outputChannel.appendLine(`... (${result.rows.length - 100} more rows)`)
							}
						}
						outputChannel.appendLine('')
					}
				}
			} catch (err) {
				vscode.window.showErrorMessage(
					`Query failed: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}),
	)

	// ── Cancel Query ────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.cancelQuery', async () => {
			const connectionId = statusBar.getActiveConnectionId()
			if (!connectionId) return

			try {
				await queryExecutor.cancelAllForConnection(connectionId)
				vscode.window.showInformationMessage('Query cancelled.')
			} catch (err) {
				vscode.window.showErrorMessage(
					`Failed to cancel query: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}),
	)

	// ── Explain Query ───────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.explainQuery', async () => {
			const editor = vscode.window.activeTextEditor
			if (!editor) return

			const connectionId = statusBar.getActiveConnectionId()
			if (!connectionId) {
				vscode.window.showWarningMessage('No active connection. Connect to a database first.')
				return
			}

			const state = connectionManager.getConnectionState(connectionId)
			if (state !== 'connected') {
				vscode.window.showWarningMessage('Active connection is not connected.')
				return
			}

			const selection = editor.selection
			const sql = selection.isEmpty
				? editor.document.getText()
				: editor.document.getText(selection)

			if (!sql.trim()) return

			try {
				const result = await queryExecutor.explainQuery(connectionId, sql, false)
				const outputChannel = getOutputChannel()
				outputChannel.show(true)
				outputChannel.appendLine('EXPLAIN:')
				outputChannel.appendLine(result.rawText)
				outputChannel.appendLine('')
			} catch (err) {
				vscode.window.showErrorMessage(
					`EXPLAIN failed: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}),
	)

	// ── Format SQL ──────────────────────────────────────────

	context.subscriptions.push(
		vscode.commands.registerCommand('dotaz.formatSql', async () => {
			const editor = vscode.window.activeTextEditor
			if (!editor) return

			const selection = editor.selection
			const text = selection.isEmpty
				? editor.document.getText()
				: editor.document.getText(selection)

			if (!text.trim()) return

			const formatted = formatSql(text)
			await editor.edit((editBuilder) => {
				if (selection.isEmpty) {
					const fullRange = new vscode.Range(
						editor.document.positionAt(0),
						editor.document.positionAt(editor.document.getText().length),
					)
					editBuilder.replace(fullRange, formatted)
				} else {
					editBuilder.replace(selection, formatted)
				}
			})
		}),
	)
}

let _outputChannel: vscode.OutputChannel | undefined

function getOutputChannel(): vscode.OutputChannel {
	if (!_outputChannel) {
		_outputChannel = vscode.window.createOutputChannel('Dotaz')
	}
	return _outputChannel
}
