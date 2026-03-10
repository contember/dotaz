import { RpcServer } from '../rpc-server'
import type * as vscode from 'vscode'

type Handlers = Record<string, (params: any) => any>

/**
 * Manages multiple RpcServer instances — one per webview panel.
 * All share the same handler map from createHandlers().
 * Broadcasts async messages (connection status, etc.) to all open panels.
 */
export class WebviewRpcManager {
	private servers = new Map<string, RpcServer>()
	private handlers: Handlers

	constructor(handlers: Handlers) {
		this.handlers = handlers
	}

	/**
	 * Register a webview panel and create an RpcServer for it.
	 * Returns a disposable that cleans up when the panel is disposed.
	 */
	register(panelId: string, panel: vscode.WebviewPanel): vscode.Disposable {
		const server = new RpcServer(panel, this.handlers)
		this.servers.set(panelId, server)

		return panel.onDidDispose(() => {
			this.servers.delete(panelId)
		})
	}

	/**
	 * Broadcast a message to all open webview panels.
	 */
	broadcast(channel: string, payload: unknown): void {
		for (const server of this.servers.values()) {
			server.emitMessage(channel, payload)
		}
	}

	/**
	 * Send a message to a specific panel.
	 */
	send(panelId: string, channel: string, payload: unknown): void {
		this.servers.get(panelId)?.emitMessage(channel, payload)
	}

	/**
	 * Get the number of active webview panels.
	 */
	get size(): number {
		return this.servers.size
	}

	dispose(): void {
		this.servers.clear()
	}
}
