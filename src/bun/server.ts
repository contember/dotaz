// Standalone web server entry point for Dotaz
// Serves the frontend via HTTP and handles RPC over WebSocket

import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { AppDatabase, setDefaultDbPath } from "./storage/app-db";
import { ConnectionManager } from "./services/connection-manager";
import { createHandlers } from "./rpc-handlers";

const PORT = Number(process.env.DOTAZ_PORT) || 4200;
const DB_PATH = process.env.DOTAZ_DB_PATH || "./dotaz.db";
const DIST_DIR = resolve(import.meta.dir, "../../dist");

// Configure app database path
setDefaultDbPath(() => {
	const dir = join(DB_PATH, "..");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return DB_PATH;
});

const appDb = AppDatabase.getInstance();
const connectionManager = new ConnectionManager(appDb);

// Create RPC handlers without Utils (system dialogs handled client-side)
const handlers = createHandlers(connectionManager, undefined, appDb, undefined);

// Track connected WebSocket clients for broadcasting
const clients = new Set<any>();

// Broadcast connection status changes to all connected clients
connectionManager.onStatusChanged((event) => {
	const msg = JSON.stringify({
		type: "message",
		channel: "connections.statusChanged",
		payload: {
			connectionId: event.connectionId,
			state: event.state,
			error: event.error,
		},
	});
	for (const client of clients) {
		client.send(msg);
	}
});

const server = Bun.serve({
	port: PORT,
	hostname: "localhost",

	async fetch(req, server) {
		const url = new URL(req.url);

		// Upgrade WebSocket requests at /rpc
		if (url.pathname === "/rpc") {
			if (server.upgrade(req)) {
				return undefined as any;
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		// Static file serving from dist/
		let filePath = join(DIST_DIR, url.pathname);

		// Try exact file first
		let file = Bun.file(filePath);
		if (await file.exists()) {
			return new Response(file);
		}

		// SPA fallback: serve index.html for non-file routes
		filePath = join(DIST_DIR, "index.html");
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
			clients.add(ws);
		},
		close(ws) {
			clients.delete(ws);
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
				const handler = (handlers as any)[msg.method];
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
