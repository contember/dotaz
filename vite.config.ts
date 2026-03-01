import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";
import solid from "vite-plugin-solid";

function transportSwapPlugin(target: "websocket" | "inline"): Plugin {
	const electrobunPath = resolve(__dirname, "src/mainview/lib/transport/electrobun.ts");
	const targetPath = resolve(__dirname, `src/mainview/lib/transport/${target}.ts`);
	return {
		name: "dotaz-transport-swap",
		enforce: "pre",
		resolveId(source, importer) {
			if (!importer) return null;
			// When resolving ./electrobun from within the transport directory, redirect to target
			if (source.endsWith("/electrobun") || source === "./electrobun") {
				const importerDir = importer.substring(0, importer.lastIndexOf("/"));
				const resolved = resolve(importerDir, source + ".ts");
				if (resolved === electrobunPath) {
					return targetPath;
				}
			}
			return null;
		},
	};
}

function storageSwapPlugin(): Plugin {
	const rpcPath = resolve(__dirname, "src/mainview/lib/storage/rpc.ts");
	const targetPath = resolve(__dirname, "src/mainview/lib/storage/indexeddb.ts");
	return {
		name: "dotaz-storage-swap",
		enforce: "pre",
		resolveId(source, importer) {
			if (!importer) return null;
			if (source.endsWith("/rpc") || source === "./rpc") {
				const importerDir = importer.substring(0, importer.lastIndexOf("/"));
				const resolved = resolve(importerDir, source + ".ts");
				if (resolved === rpcPath) {
					return targetPath;
				}
			}
			return null;
		},
	};
}

export default defineConfig(({ mode }) => {
	const isWeb = mode === "web";
	const isDemo = mode === "demo";

	return {
		plugins: [
			...(isWeb ? [transportSwapPlugin("websocket"), storageSwapPlugin()] : []),
			...(isDemo ? [transportSwapPlugin("inline")] : []),
			solid(),
		],
		root: "src/mainview",
		build: {
			outDir: "../../dist",
			emptyOutDir: true,
		},
		server: {
			port: isDemo ? 4202 : isWeb ? 4201 : 5173,
			strictPort: true,
			proxy: isWeb
				? { "/rpc": { target: "ws://localhost:4200", ws: true } }
				: undefined,
			headers: isDemo
				? {
					"Cross-Origin-Opener-Policy": "same-origin",
					"Cross-Origin-Embedder-Policy": "require-corp",
				}
				: undefined,
		},
		optimizeDeps: isDemo
			? { exclude: ["@sqlite.org/sqlite-wasm"] }
			: undefined,
		worker: isDemo
			? { format: "es" as const }
			: undefined,
	};
});
