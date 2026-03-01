import { defineConfig } from "vite";
import { resolve } from "path";
import solid from "vite-plugin-solid";

export default defineConfig(({ mode }) => {
	const isWeb = mode === "web";
	const isDemo = mode === "demo";

	const root = isDemo
		? "src/frontend-demo"
		: isWeb
			? "src/frontend-web"
			: "src/frontend-desktop";

	return {
		plugins: [solid()],
		root,
		build: {
			outDir: resolve(__dirname, "dist"),
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
