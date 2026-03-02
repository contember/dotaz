import type { ConnectionManager } from "../services/connection-manager";
import type { AppDatabase } from "../storage/app-db";
import type { EncryptionService } from "../services/encryption";
import { QueryExecutor } from "../services/query-executor";
import { BackendAdapter } from "./backend-adapter";
import { createHandlers as createSharedHandlers } from "./handlers";

export interface HandlerOptions {
	encryption?: EncryptionService;
	emitMessage?: (channel: string, payload: unknown) => void;
}

function requireAppDb(appDb: AppDatabase | undefined): AppDatabase {
	if (!appDb) throw new Error("AppDatabase is required");
	return appDb;
}

export function createHandlers(cm: ConnectionManager, qe?: QueryExecutor, appDb?: AppDatabase, Utils?: typeof import("electrobun/bun").Utils, opts?: HandlerOptions) {
	const db = requireAppDb(appDb);
	const queryExecutor = qe ?? new QueryExecutor(cm, undefined, db);
	const adapter = new BackendAdapter(cm, queryExecutor, db, {
		encryption: opts?.encryption,
		Utils,
		emitMessage: opts?.emitMessage,
	});
	return createSharedHandlers(adapter);
}
