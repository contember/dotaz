import type { BrowserWindow } from "electrobun/bun";
import type { DotazRPC } from "../shared/types/rpc";
import type { ConnectionManager } from "./services/connection-manager";
import type { AppDatabase } from "./storage/app-db";
import type { EncryptionService } from "./services/encryption";
import { QueryExecutor } from "./services/query-executor";
import { BackendAdapter } from "./rpc/backend-adapter";
import { createHandlers as createSharedHandlers } from "../shared/rpc/handlers";

export interface HandlerOptions {
	encryption?: EncryptionService;
}

export function createHandlers(cm: ConnectionManager, qe?: QueryExecutor, appDb?: AppDatabase, Utils?: typeof import("electrobun/bun").Utils, opts?: HandlerOptions) {
	if (!appDb) throw new Error("AppDatabase is required");
	const queryExecutor = qe ?? new QueryExecutor(cm, undefined, appDb);
	const adapter = new BackendAdapter(cm, queryExecutor, appDb, {
		encryption: opts?.encryption,
		Utils,
	});
	return createSharedHandlers(adapter);
}

export function createRPC(cm: ConnectionManager, appDb: AppDatabase | undefined, BrowserView: typeof import("electrobun/bun").BrowserView, Utils?: typeof import("electrobun/bun").Utils) {
	return BrowserView.defineRPC<DotazRPC>({
		maxRequestTime: 30000,
		handlers: {
			requests: createHandlers(cm, undefined, appDb, Utils),
			messages: {},
		},
	});
}

export function setupStatusNotifications(
	window: BrowserWindow,
	cm: ConnectionManager,
): () => void {
	return cm.onStatusChanged((event) => {
		(window as any).webview.rpc.send["connections.statusChanged"]({
			connectionId: event.connectionId,
			state: event.state,
			error: event.error,
		});
	});
}
