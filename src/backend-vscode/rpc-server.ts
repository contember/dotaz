import { DatabaseError } from '@dotaz/shared/types/errors'
import type * as vscode from 'vscode'

type Handlers = Record<string, (params: any) => any>

export class RpcServer {
	private handlers: Handlers
	private panel: vscode.WebviewPanel

	constructor(panel: vscode.WebviewPanel, handlers: Handlers) {
		this.handlers = handlers
		this.panel = panel

		panel.webview.onDidReceiveMessage(async (msg: any) => {
			if (msg.type === 'request') {
				await this.handleRequest(msg)
			}
		})
	}

	emitMessage(channel: string, payload: unknown): void {
		this.panel.webview.postMessage({
			type: 'message',
			channel,
			payload,
		})
	}

	private async handleRequest(msg: { id: number; method: string; params: any }): Promise<void> {
		const handler = this.handlers[msg.method]
		if (!handler) {
			this.panel.webview.postMessage({
				type: 'response',
				id: msg.id,
				success: false,
				error: `Unknown method: ${msg.method}`,
			})
			return
		}

		try {
			const result = await handler(msg.params)
			this.panel.webview.postMessage({
				type: 'response',
				id: msg.id,
				success: true,
				payload: result,
			})
		} catch (err: any) {
			this.panel.webview.postMessage({
				type: 'response',
				id: msg.id,
				success: false,
				error: err?.message ?? String(err),
				errorCode: err instanceof DatabaseError ? err.code : undefined,
			})
		}
	}
}
