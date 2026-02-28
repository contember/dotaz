import Electrobun from "electrobun/bun";
import { ApplicationMenu, BrowserWindow, Updater } from "electrobun/bun";
import { AppDatabase } from "./storage/app-db";
import { ConnectionManager } from "./services/connection-manager";
import { createRPC, setupStatusNotifications } from "./rpc-handlers";

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

// Initialize backend services
const appDb = AppDatabase.getInstance();
const connectionManager = new ConnectionManager(appDb);

// Create RPC handlers
const rpc = createRPC(connectionManager, appDb);

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

// Wire up BE→FE notifications after window creation
setupStatusNotifications(mainWindow, connectionManager);

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
