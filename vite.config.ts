import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";
import solid from "vite-plugin-solid";

function transportSwapPlugin(): Plugin {
	const electrobunPath = resolve(__dirname, "src/mainview/lib/transport/electrobun.ts");
	const websocketPath = resolve(__dirname, "src/mainview/lib/transport/websocket.ts");
	return {
		name: "dotaz-transport-swap",
		enforce: "pre",
		resolveId(source, importer) {
			if (!importer) return null;
			// When resolving ./electrobun from within the transport directory, redirect to websocket
			if (source.endsWith("/electrobun") || source === "./electrobun") {
				const importerDir = importer.substring(0, importer.lastIndexOf("/"));
				const resolved = resolve(importerDir, source + ".ts");
				if (resolved === electrobunPath) {
					return websocketPath;
				}
			}
			return null;
		},
	};
}

export default defineConfig(({ mode }) => ({
	plugins: [
		...(mode === "web" ? [transportSwapPlugin()] : []),
		solid(),
	],
	root: "src/mainview",
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: mode === "web" ? 4201 : 5173,
		strictPort: true,
		proxy: mode === "web"
			? { "/rpc": { target: "ws://localhost:4200", ws: true } }
			: undefined,
	},
}));
