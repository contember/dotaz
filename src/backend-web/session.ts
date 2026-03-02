// Session management and token registry for the web server
// Extracted from server.ts for testability

import { AppDatabase } from "../backend-shared/storage/app-db";
import { ConnectionManager } from "../backend-shared/services/connection-manager";
import { EncryptionService } from "../backend-shared/services/encryption";
import { QueryExecutor } from "../backend-shared/services/query-executor";
import { createHandlers } from "../backend-shared/rpc/rpc-handlers";
import type { ExportParams } from "../backend-shared/services/export-service";
import type { ImportStreamParams } from "../backend-shared/services/import-service";

export const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// ── Session management ─────────────────────────────────────

export interface Session {
	id: string;
	appDb: AppDatabase;
	connectionManager: ConnectionManager;
	queryExecutor: QueryExecutor;
	handlers: ReturnType<typeof createHandlers>;
	unsubscribe: () => void;
	ws: { send(data: string): void } | null;
	activeStreams: number;
	disconnectedAt: number | null;
	ttlTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, Session>();

export function getSessions(): Map<string, Session> {
	return sessions;
}

export function createSession(
	ws: { send(data: string): void },
	encryptionKey: string,
): Session {
	const id = crypto.randomUUID();
	const appDb = AppDatabase.create(":memory:");
	const connectionManager = new ConnectionManager(appDb);
	const queryExecutor = new QueryExecutor(connectionManager, undefined, appDb);
	const encryption = new EncryptionService(encryptionKey);

	const emitMessage = (channel: string, payload: unknown) => {
		if (session.ws) {
			session.ws.send(JSON.stringify({ type: "message", channel, payload }));
		}
	};

	const handlers = createHandlers(connectionManager, queryExecutor, appDb, undefined, {
		encryption,
		emitMessage,
	});

	const unsubscribe = connectionManager.onStatusChanged((event) => {
		if (session.ws) {
			session.ws.send(JSON.stringify({
				type: "message",
				channel: "connections.statusChanged",
				payload: {
					connectionId: event.connectionId,
					state: event.state,
					error: event.error,
					errorCode: event.errorCode,
					transactionLost: event.transactionLost,
				},
			}));
		}
	});

	const session: Session = {
		id, appDb, connectionManager, queryExecutor, handlers, unsubscribe, ws,
		activeStreams: 0, disconnectedAt: null, ttlTimer: null,
	};
	sessions.set(id, session);
	return session;
}

export async function destroySession(session: Session): Promise<void> {
	sessions.delete(session.id);
	if (session.ttlTimer) {
		clearTimeout(session.ttlTimer);
		session.ttlTimer = null;
	}
	session.unsubscribe();
	for (const queryId of session.queryExecutor.getRunningQueryIds()) {
		await session.queryExecutor.cancelQuery(queryId);
	}
	await session.connectionManager.disconnectAll();
	session.appDb.close();
}

/** Delayed session cleanup: only destroy if no active streams reference it. */
export async function maybeDestroySession(session: Session): Promise<void> {
	session.ws = null;
	session.disconnectedAt = Date.now();
	if (session.activeStreams === 0) {
		await destroySession(session);
	} else {
		session.ttlTimer = setTimeout(async () => {
			if (sessions.has(session.id)) {
				await destroySession(session);
			}
		}, SESSION_TTL_MS);
	}
}

export async function releaseStream(session: Session): Promise<void> {
	session.activeStreams--;
	if (session.ws === null && session.activeStreams === 0) {
		await destroySession(session);
	}
}

// ── Token registry ─────────────────────────────────────────

export interface StreamToken {
	session: Session;
	connectionId: string;
	database?: string;
	params: ExportParams | ImportStreamParams;
	type: "export" | "import";
	createdAt: number;
}

const streamTokens = new Map<string, StreamToken>();

export function getStreamTokens(): Map<string, StreamToken> {
	return streamTokens;
}

export function createStreamToken(
	session: Session,
	type: "export" | "import",
	connectionId: string,
	database: string | undefined,
	params: ExportParams | ImportStreamParams,
): string {
	const token = crypto.randomUUID();
	streamTokens.set(token, { session, connectionId, database, params, type, createdAt: Date.now() });
	return token;
}

export function consumeStreamToken(token: string, expectedType: "export" | "import"): StreamToken | null {
	const entry = streamTokens.get(token);
	if (!entry) return null;
	if (entry.type !== expectedType) return null;
	if (Date.now() - entry.createdAt > TOKEN_EXPIRY_MS) {
		streamTokens.delete(token);
		return null;
	}
	streamTokens.delete(token); // One-time use
	return entry;
}

export function cleanupExpiredTokens(): void {
	const now = Date.now();
	for (const [token, entry] of streamTokens) {
		if (now - entry.createdAt > TOKEN_EXPIRY_MS) {
			streamTokens.delete(token);
		}
	}
}
