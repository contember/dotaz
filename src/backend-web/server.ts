// Standalone web server entry point for Dotaz
// Serves the frontend via HTTP and handles RPC over WebSocket
// Each WebSocket connection gets its own isolated session (AppDatabase, ConnectionManager, handlers)

import { resolve } from "path";
import { AppDatabase } from "../backend-shared/storage/app-db";
import { ConnectionManager } from "../backend-shared/services/connection-manager";
import { EncryptionService } from "../backend-shared/services/encryption";
import { createHandlers } from "../backend-shared/rpc/rpc-handlers";
import { DatabaseError } from "../shared/types/errors";
import { exportToStream } from "../backend-shared/services/export-service";
import { importFromStream } from "../backend-shared/services/import-service";
import type { ExportParams, ExportWriter } from "../backend-shared/services/export-service";
import type { ImportStreamParams } from "../backend-shared/services/import-service";
import type { ExportFormat } from "../shared/types/export";

const PORT = Number(process.env.DOTAZ_PORT) || 4200;
const DIST_DIR = resolve(import.meta.dir, "../../dist");

const ENCRYPTION_KEY = process.env.DOTAZ_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
	console.error("DOTAZ_ENCRYPTION_KEY is required for web mode");
	process.exit(1);
}

// ── Session management ─────────────────────────────────────

interface Session {
	id: string;
	appDb: AppDatabase;
	connectionManager: ConnectionManager;
	handlers: ReturnType<typeof createHandlers>;
	unsubscribe: () => void;
	ws: { send(data: string): void } | null;
	activeStreams: number;
}

const sessions = new Map<string, Session>();

function createSession(ws: { send(data: string): void }): Session {
	const id = crypto.randomUUID();
	const appDb = AppDatabase.create(":memory:");
	const connectionManager = new ConnectionManager(appDb);
	const encryption = new EncryptionService(ENCRYPTION_KEY!);

	const emitMessage = (channel: string, payload: unknown) => {
		if (session.ws) {
			session.ws.send(JSON.stringify({ type: "message", channel, payload }));
		}
	};

	const handlers = createHandlers(connectionManager, undefined, appDb, undefined, {
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
				},
			}));
		}
	});

	const session: Session = { id, appDb, connectionManager, handlers, unsubscribe, ws, activeStreams: 0 };
	sessions.set(id, session);
	return session;
}

async function destroySession(session: Session): Promise<void> {
	sessions.delete(session.id);
	session.unsubscribe();
	await session.connectionManager.disconnectAll();
	session.appDb.close();
}

/** Delayed session cleanup: only destroy if no active streams reference it. */
async function maybeDestroySession(session: Session): Promise<void> {
	session.ws = null;
	if (session.activeStreams === 0) {
		await destroySession(session);
	}
	// If activeStreams > 0, the stream completion handlers will call destroySession
}

async function releaseStream(session: Session): Promise<void> {
	session.activeStreams--;
	if (session.ws === null && session.activeStreams === 0) {
		await destroySession(session);
	}
}

// ── Token registry ─────────────────────────────────────────

interface StreamToken {
	session: Session;
	connectionId: string;
	database?: string;
	params: ExportParams | ImportStreamParams;
	type: "export" | "import";
	createdAt: number;
}

const streamTokens = new Map<string, StreamToken>();

const TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// Clean up expired tokens every 60 seconds
setInterval(() => {
	const now = Date.now();
	for (const [token, entry] of streamTokens) {
		if (now - entry.createdAt > TOKEN_EXPIRY_MS) {
			streamTokens.delete(token);
		}
	}
}, 60_000);

function createStreamToken(session: Session, type: "export" | "import", connectionId: string, database: string | undefined, params: ExportParams | ImportStreamParams): string {
	const token = crypto.randomUUID();
	streamTokens.set(token, { session, connectionId, database, params, type, createdAt: Date.now() });
	return token;
}

function consumeStreamToken(token: string, expectedType: "export" | "import"): StreamToken | null {
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

// ── Content type mapping ───────────────────────────────────

const FORMAT_CONTENT_TYPES: Record<ExportFormat, string> = {
	csv: "text/csv",
	json: "application/json",
	sql: "application/sql",
	markdown: "text/markdown",
	sql_update: "application/sql",
	html: "text/html",
	xml: "application/xml",
};

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
	csv: "csv",
	json: "json",
	sql: "sql",
	markdown: "md",
	sql_update: "sql",
	html: "html",
	xml: "xml",
};

// ── HTTP stream endpoints ──────────────────────────────────

async function handleExportStream(req: Request, token: string): Promise<Response> {
	const entry = consumeStreamToken(token, "export");
	if (!entry) {
		return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
			status: 403,
			headers: { "Content-Type": "application/json" },
		});
	}

	const { session, connectionId, database, params } = entry;
	const exportParams = params as ExportParams;

	let driver;
	try {
		driver = session.connectionManager.getDriver(connectionId, database);
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err?.message ?? "Failed to get driver" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}

	session.activeStreams++;

	const contentType = FORMAT_CONTENT_TYPES[exportParams.format] ?? "application/octet-stream";
	const ext = FORMAT_EXTENSIONS[exportParams.format] ?? "dat";
	const filename = `${exportParams.table}.${ext}`;

	const abortController = new AbortController();
	// When the client disconnects, abort the export
	req.signal.addEventListener("abort", () => abortController.abort());

	const stream = new ReadableStream({
		async start(controller) {
			const writer: ExportWriter = {
				write(chunk) {
					if (typeof chunk === "string") {
						controller.enqueue(new TextEncoder().encode(chunk));
					} else {
						controller.enqueue(chunk);
					}
				},
				async end() {
					// No-op; we close the controller after exportToStream completes
				},
			};

			try {
				const result = await exportToStream(driver, exportParams, writer, abortController.signal, (rowCount) => {
					// Send progress via WS (parallel channel)
					if (session.ws) {
						session.ws.send(JSON.stringify({
							type: "message",
							channel: "export.progress",
							payload: { rowCount },
						}));
					}
				});

				// Signal completion via WS
				if (session.ws) {
					session.ws.send(JSON.stringify({
						type: "message",
						channel: "export.complete",
						payload: { rowCount: result.rowCount },
					}));
				}

				controller.close();
			} catch (err: any) {
				// If the client disconnected, just close
				if (abortController.signal.aborted) {
					try { controller.close(); } catch { /* already closed */ }
				} else {
					controller.error(err);
				}
			} finally {
				await releaseStream(session);
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": contentType,
			"Content-Disposition": `attachment; filename="${filename}"`,
		},
	});
}

async function handleImportStream(req: Request, token: string): Promise<Response> {
	const entry = consumeStreamToken(token, "import");
	if (!entry) {
		return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
			status: 403,
			headers: { "Content-Type": "application/json" },
		});
	}

	const { session, connectionId, database, params } = entry;
	const importParams = params as ImportStreamParams;

	let driver;
	try {
		driver = session.connectionManager.getDriver(connectionId, database);
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err?.message ?? "Failed to get driver" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (!req.body) {
		return new Response(JSON.stringify({ error: "Request body is required" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	session.activeStreams++;

	const abortController = new AbortController();
	req.signal.addEventListener("abort", () => abortController.abort());

	try {
		const result = await importFromStream(driver, req.body, importParams, abortController.signal, (rowCount) => {
			// Send progress via WS (parallel channel)
			if (session.ws) {
				session.ws.send(JSON.stringify({
					type: "message",
					channel: "import.progress",
					payload: { rowCount },
				}));
			}
		});

		return new Response(JSON.stringify({ rowCount: result.rowCount }), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err?.message ?? "Import failed" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	} finally {
		await releaseStream(session);
	}
}

// ── Server ─────────────────────────────────────────────────

const server = Bun.serve<Session>({
	port: PORT,
	hostname: "localhost",

	async fetch(req, server) {
		const url = new URL(req.url);

		// Upgrade WebSocket requests at /rpc
		if (url.pathname === "/rpc") {
			// Pass an empty data object; real session is created in open()
			if (server.upgrade(req, { data: {} as Session })) {
				return undefined as any;
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		// ── Stream endpoints ──────────────────────────────
		const exportMatch = url.pathname.match(/^\/api\/stream\/export\/([a-f0-9-]+)$/);
		if (exportMatch && req.method === "GET") {
			return handleExportStream(req, exportMatch[1]);
		}

		const importMatch = url.pathname.match(/^\/api\/stream\/import\/([a-f0-9-]+)$/);
		if (importMatch && req.method === "POST") {
			return handleImportStream(req, importMatch[1]);
		}

		// Static file serving from dist/
		let filePath = resolve(DIST_DIR, url.pathname.slice(1));

		// Try exact file first
		let file = Bun.file(filePath);
		if (await file.exists()) {
			return new Response(file);
		}

		// SPA fallback: serve index.html for non-file routes
		filePath = resolve(DIST_DIR, "index.html");
		file = Bun.file(filePath);
		if (await file.exists()) {
			return new Response(file, {
				headers: { "Content-Type": "text/html" },
			});
		}

		return new Response("Not found", { status: 404 });
	},

	websocket: {
		open(ws) {
			const session = createSession(ws);
			// Replace the placeholder data with the real session
			Object.assign(ws.data, session);
		},
		async close(ws) {
			await maybeDestroySession(ws.data);
		},
		async message(ws, data) {
			let msg: any;
			try {
				msg = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
			} catch {
				ws.send(JSON.stringify({ type: "response", id: 0, success: false, error: "Invalid JSON" }));
				return;
			}

			if (msg.type === "request") {
				// ── Web-specific stream token handlers ─────────
				if (msg.method === "stream.createExportToken") {
					const { connectionId, database, ...exportParams } = msg.params;
					const token = createStreamToken(ws.data, "export", connectionId, database, exportParams);
					ws.send(JSON.stringify({ type: "response", id: msg.id, success: true, payload: { token } }));
					return;
				}

				if (msg.method === "stream.createImportToken") {
					const { connectionId, database, ...importParams } = msg.params;
					const token = createStreamToken(ws.data, "import", connectionId, database, importParams);
					ws.send(JSON.stringify({ type: "response", id: msg.id, success: true, payload: { token } }));
					return;
				}

				const handler = (ws.data.handlers as any)[msg.method];
				if (!handler) {
					ws.send(JSON.stringify({
						type: "response",
						id: msg.id,
						success: false,
						error: `Unknown method: ${msg.method}`,
					}));
					return;
				}

				try {
					const result = await handler(msg.params);
					ws.send(JSON.stringify({
						type: "response",
						id: msg.id,
						success: true,
						payload: result,
					}));
				} catch (err: any) {
					ws.send(JSON.stringify({
						type: "response",
						id: msg.id,
						success: false,
						error: err?.message ?? String(err),
						errorCode: err instanceof DatabaseError ? err.code : undefined,
					}));
				}
			}
		},
	},
});

console.log(`Dotaz web server running at http://localhost:${server.port}`);
