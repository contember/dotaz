// Frontend RPC client — Proxy-based, typed from handler definitions
// Types inferred from createHandlers() via NamespacedRpcClient.

import { transport } from "./transport";
import type { NamespacedRpcClient } from "../../backend-types";
import type { ConnectionState } from "../../shared/types/connection";

export { RpcError, friendlyErrorMessage } from "./rpc-errors";
import { RpcError } from "./rpc-errors";

async function call<T>(method: string, params: unknown): Promise<T> {
	try {
		return await transport.call<T>(method, params);
	} catch (err) {
		throw new RpcError(method, err);
	}
}

export const rpc: NamespacedRpcClient = new Proxy({} as NamespacedRpcClient, {
	get(_, namespace: string) {
		return new Proxy({} as Record<string, unknown>, {
			get(_, method: string) {
				return (params?: unknown) => call(`${namespace}.${method}`, params ?? {});
			},
		});
	},
});

// ── Message listeners ────────────────────────────────────

/** Subscribe to backend → frontend notifications */
export const messages = {
	onConnectionStatusChanged: (
		handler: (event: { connectionId: string; state: ConnectionState; error?: string }) => void,
	) => {
		return transport.addMessageListener("connections.statusChanged", handler);
	},
	onMenuAction: (
		handler: (event: { action: string }) => void,
	) => {
		return transport.addMessageListener("menu.action", handler);
	},
};
