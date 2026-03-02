import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import Electrobun from "electrobun/bun";
import { ApplicationMenu, BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import type { DotazRPC } from "../backend-types";
import { AppDatabase, setDefaultDbPath } from "../backend-shared/storage/app-db";
import { ConnectionManager } from "../backend-shared/services/connection-manager";
import { createLocalKey } from "../backend-shared/services/encryption";
import { createHandlers } from "../backend-shared/rpc/rpc-handlers";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

// Configure default DB path before initializing
setDefaultDbPath(() => {
	const dir = Utils.paths.userData;
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return join(dir, "dotaz.db");
});

// Initialize backend services
const appDb = AppDatabase.getInstance();
const localKey = createLocalKey();
if (localKey) {
	appDb.setLocalKey(localKey);
}
const connectionManager = new ConnectionManager(appDb);

// Create RPC handlers with deferred message emitter (set after window creation)
let emitToFrontend: ((channel: string, payload: unknown) => void) | undefined;
const { handlers, sessionManager } = createHandlers(connectionManager, undefined, appDb, Utils, {
	emitMessage: (channel, payload) => emitToFrontend?.(channel, payload),
});
const rpc = BrowserView.defineRPC<DotazRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: handlers,
		messages: {},
	},
});

const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "Dotaz",
	url,
	rpc,
	frame: {
		width: 1280,
		height: 800,
		x: 200,
		y: 200,
	},
});

// Wire up BE→FE message emitter after window creation
emitToFrontend = (channel: string, payload: unknown) => {
	(mainWindow as any).webview.rpc.send[channel](payload);
};

// Wire up BE→FE notifications after window creation
connectionManager.onStatusChanged((event) => {
	emitToFrontend!("connections.statusChanged", {
		connectionId: event.connectionId,
		state: event.state,
		error: event.error,
		errorCode: event.errorCode,
		transactionLost: event.transactionLost,
	});

	// Clean up sessions on disconnect/error and notify frontend
	if (event.state === "disconnected" || event.state === "error") {
		sessionManager.handleConnectionLost(event.connectionId);
		emitToFrontend!("session.changed", {
			connectionId: event.connectionId,
			sessions: [],
		});
	}
});

// ── Application Menu ─────────────────────────────────────
ApplicationMenu.setApplicationMenu([
	{
		// App menu (macOS first submenu becomes app name menu)
		submenu: [
			{ label: "About Dotaz", action: "about" },
			{ type: "separator" },
			{ label: "Quit Dotaz", role: "quit" },
		],
	},
	{
		label: "File",
		submenu: [
			{ label: "New SQL Console", action: "new-sql-console", accelerator: "CommandOrControl+N" },
			{ label: "Close Tab", action: "close-tab", accelerator: "CommandOrControl+W" },
			{ type: "separator" },
			{ label: "Settings", action: "settings" },
			{ type: "separator" },
			{ label: "Quit", role: "quit" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	},
	{
		label: "View",
		submenu: [
			{ label: "Toggle Sidebar", action: "toggle-sidebar", accelerator: "CommandOrControl+B" },
			{ label: "Command Palette", action: "command-palette", accelerator: "CommandOrControl+Shift+P" },
			{ type: "separator" },
			{ label: "Refresh Data", action: "refresh-data", accelerator: "F5" },
			{ type: "separator" },
			{ label: "Zoom In", action: "zoom-in", accelerator: "CommandOrControl+=" },
			{ label: "Zoom Out", action: "zoom-out", accelerator: "CommandOrControl+-" },
			{ label: "Reset Zoom", action: "zoom-reset", accelerator: "CommandOrControl+0" },
		],
	},
	{
		label: "Connection",
		submenu: [
			{ label: "New Connection", action: "new-connection" },
			{ label: "Disconnect", action: "disconnect" },
			{ type: "separator" },
			{ label: "Reconnect", action: "reconnect" },
		],
	},
	{
		label: "Query",
		submenu: [
			{ label: "Run Query", action: "run-query", accelerator: "CommandOrControl+Enter" },
			{ label: "Cancel Query", action: "cancel-query" },
			{ type: "separator" },
			{ label: "Format SQL", action: "format-sql", accelerator: "CommandOrControl+Shift+F" },
		],
	},
	{
		label: "Help",
		submenu: [
			{ label: "About Dotaz", action: "about" },
		],
	},
]);

// Forward menu actions to the frontend via RPC
Electrobun.events.on("application-menu-clicked", (e: any) => {
	const action = e.data?.action;
	if (action) {
		(mainWindow as any).webview.rpc.send["menu.action"]({ action });
	}
});

console.log("Dotaz started!");
