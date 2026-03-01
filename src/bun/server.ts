// Standalone web server entry point for Dotaz
// Serves the frontend via HTTP and handles RPC over WebSocket
// Each WebSocket connection gets its own isolated session (AppDatabase, ConnectionManager, handlers)

import { resolve } from "path";
import { AppDatabase } from "./storage/app-db";
import { ConnectionManager } from "./services/connection-manager";
import { EncryptionService } from "./services/encryption";
import { createHandlers } from "./rpc-handlers";

const PORT = Number(process.env.DOTAZ_PORT) || 4200;
const DIST_DIR = resolve(import.meta.dir, "../../dist");

const ENCRYPTION_KEY = process.env.DOTAZ_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
	console.error("DOTAZ_ENCRYPTION_KEY is required for web mode");
	process.exit(1);
}

interface Session {
	appDb: AppDatabase;
	connectionManager: ConnectionManager;
	handlers: ReturnType<typeof createHandlers>;
	unsubscribe: () => void;
}

function createSession(ws: { send(data: string): void }): Session {
	const appDb = AppDatabase.create(":memory:");
	const connectionManager = new ConnectionManager(appDb);
	const encryption = new EncryptionService(ENCRYPTION_KEY!);
	const handlers = createHandlers(connectionManager, undefined, appDb, undefined, { encryption });

	const unsubscribe = connectionManager.onStatusChanged((event) => {
		ws.send(JSON.stringify({
			type: "message",
			channel: "connections.statusChanged",
			payload: {
				connectionId: event.connectionId,
				state: event.state,
				error: event.error,
			},
		}));
	});

	return { appDb, connectionManager, handlers, unsubscribe };
}

async function destroySession(session: Session): Promise<void> {
	session.unsubscribe();
	await session.connectionManager.disconnectAll();
	session.appDb.close();
}

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
			await destroySession(ws.data);
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
					}));
				}
			}
		},
	},
});

console.log(`Dotaz web server running at http://localhost:${server.port}`);
